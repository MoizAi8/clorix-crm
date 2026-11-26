from datetime import datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from psycopg.types.json import Jsonb

from clorix.billing_inputs import (
    CatalogInput,
    ChangeDocument,
    GenerateDocument,
    LineInput,
    Payment,
    SaveDocument,
)
from clorix.intelligence import rounded_ratio
from clorix.mutations import audit, json_value, require_version
from clorix.security import ServiceError
from clorix.workflows import _enqueue

AMOUNTS = ("subtotal_minor", "discount_minor", "tax_minor", "total_minor")
MAX_DOC = 9_999_999_999_999_999


def calculate_line(unit: int, quantity_milli: int, discount: int, tax: int) -> dict:
    if not 1 <= quantity_milli <= 1_000_000:
        raise ServiceError(422, "quantity", "Quantity must be between 0.001 and 1000.")
    subtotal = rounded_ratio(unit * quantity_milli, 1000)
    discount_amount = rounded_ratio(subtotal * discount, 10000)
    taxes = rounded_ratio((subtotal - discount_amount) * tax, 10000)
    return dict(
        zip(
            AMOUNTS,
            (subtotal, discount_amount, taxes, subtotal - discount_amount + taxes),
            strict=True,
        )
    )


def totals(lines: list[dict]) -> dict:
    amounts = {key: sum(item[key] for item in lines) for key in AMOUNTS}
    if any(value > MAX_DOC for value in amounts.values()):
        raise ServiceError(422, "document_total", "This document exceeds the supported amount.")
    return amounts


def local_today(tenant):
    return datetime.now(ZoneInfo(tenant.timezone)).date()


def serialize(row, fields=AMOUNTS):
    return row | {
        key: str(row[key]) if row[key] is not None else None for key in fields if key in row
    }


def catalog(conn, tenant):
    rows = conn.execute(
        """
        SELECT id,sku,name,kind,category,description,price_minor,cost_minor,tax_bps,active,version
        FROM catalog_items WHERE workspace_id=%s ORDER BY active DESC,name,id LIMIT 250
        """,
        (tenant.id,),
    ).fetchall()
    return [serialize(row, ("price_minor", "cost_minor")) for row in rows]


def save_catalog(conn, tenant, spec: CatalogInput):
    values = (
        spec.sku,
        spec.name,
        spec.kind,
        spec.category,
        spec.description,
        int(spec.price_minor),
        int(spec.cost_minor) if spec.cost_minor is not None else None,
        spec.tax_bps,
        spec.active,
    )
    if spec.id:
        current = conn.execute(
            "SELECT version FROM catalog_items WHERE workspace_id=%s AND id=%s",
            (tenant.id, spec.id),
        ).fetchone()
        if not current:
            raise ServiceError(404, "catalog", "This catalog item is unavailable.")
        require_version(current["version"], spec.version)
        result = conn.execute(
            """
            UPDATE catalog_items SET sku=%s,name=%s,kind=%s,category=%s,description=%s,price_minor=%s,
              cost_minor=%s,tax_bps=%s,active=%s,version=version+1,updated_at=now()
            WHERE workspace_id=%s AND id=%s RETURNING id,version
            """,
            (*values, tenant.id, spec.id),
        ).fetchone()
    else:
        require_version(0, spec.version)
        limit = 45 if tenant.kind == "sandbox" else 250
        count = conn.execute(
            "SELECT count(*) AS n FROM catalog_items WHERE workspace_id=%s", (tenant.id,)
        ).fetchone()["n"]
        if count >= limit:
            raise ServiceError(
                429, "catalog_limit", "This workspace has reached its catalog limit."
            )
        result = conn.execute(
            """
            INSERT INTO catalog_items(workspace_id,sku,name,kind,category,description,price_minor,cost_minor,tax_bps,active)
            VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id,version
            """,
            (tenant.id, *values),
        ).fetchone()
    audit(conn, tenant, "save_catalog", "catalog_items", result["id"])
    return result


def linked_company(conn, tenant, company_id, contact_id, deal_id):
    company = conn.execute(
        "SELECT name FROM companies WHERE workspace_id=%s AND id=%s AND archived_at IS NULL",
        (tenant.id, company_id),
    ).fetchone()
    if not company:
        raise ServiceError(422, "company", "Choose an active company in this workspace.")
    for table, record in (("contacts", contact_id), ("deals", deal_id)):
        if (
            record
            and not conn.execute(
                f"SELECT 1 FROM {table} WHERE workspace_id=%s AND id=%s AND company_id=%s AND archived_at IS NULL",
                (tenant.id, record, company_id),
            ).fetchone()
        ):
            raise ServiceError(
                422, "relation", "The selected contact or deal must belong to the company."
            )
    return company["name"]


def resolve_line(conn, tenant, spec: LineInput, old: dict | None):
    previous = old if old and old["catalog_id"] == spec.catalog_id else None
    item = None
    if spec.catalog_id and not previous:
        item = conn.execute(
            "SELECT id,name,sku,price_minor,tax_bps FROM catalog_items WHERE workspace_id=%s AND id=%s AND active",
            (tenant.id, spec.catalog_id),
        ).fetchone()
        if not item:
            raise ServiceError(422, "catalog", "Choose an available catalog item.")
    label = spec.label or (previous and previous["label"]) or (item and item["name"])
    unit = (
        int(spec.unit_minor)
        if spec.unit_minor is not None
        else previous["unit_minor"]
        if previous
        else item["price_minor"]
        if item
        else None
    )
    if not label or unit is None:
        raise ServiceError(422, "line", "A custom line needs a description and unit price.")
    qty = int(Decimal(spec.quantity) * 1000)
    tax = spec.tax_bps if spec.tax_bps is not None else (previous or item or {}).get("tax_bps", 0)
    return {
        "catalog_id": spec.catalog_id,
        "label": label,
        "sku": (previous or item or {}).get("sku"),
        "qty_milli": qty,
        "unit_minor": unit,
        "discount_bps": spec.discount_bps,
        "tax_bps": tax,
    } | calculate_line(
        unit,
        qty,
        spec.discount_bps,
        tax,
    )


def get_document(conn, tenant, identifier):
    row = conn.execute(
        """
        SELECT d.*,coalesce((SELECT sum(p.amount_minor)::bigint FROM recorded_payments p
          WHERE p.workspace_id=d.workspace_id AND p.invoice_id=d.id),0) AS paid_minor
        FROM billing_documents d WHERE d.workspace_id=%s AND d.id=%s
        """,
        (tenant.id, identifier),
    ).fetchone()
    if not row:
        raise ServiceError(404, "document", "The document is unavailable.")
    return row


def lines_for(conn, tenant, identifier):
    return conn.execute(
        """
        SELECT position,catalog_id,label,sku,qty_milli,unit_minor,discount_bps,tax_bps,
          subtotal_minor,discount_minor,tax_minor,total_minor
        FROM billing_lines WHERE workspace_id=%s AND document_id=%s ORDER BY position
        """,
        (tenant.id, identifier),
    ).fetchall()


def summarized(row, today):
    prefix = "Q" if row["kind"] == "quotation" else "INV"
    status = row["status"]
    balance = row["total_minor"] - row["paid_minor"]
    if row["kind"] == "quotation" and status == "sent" and row["due_on"] < today:
        status = "expired"
    elif row["kind"] == "invoice" and status == "issued":
        status = (
            "paid"
            if balance == 0
            else "overdue"
            if row["due_on"] < today
            else "partial"
            if row["paid_minor"]
            else "unpaid"
        )
    return serialize(
        row
        | {"number": f"{prefix}-{row['serial']:05d}", "state": status, "balance_minor": balance},
        AMOUNTS + ("paid_minor", "balance_minor"),
    )


def document_detail(conn, tenant, identifier):
    found = get_document(conn, tenant, identifier)
    payments = conn.execute(
        """
        SELECT id,amount_minor::text,received_on,method,reference,notes
        FROM recorded_payments WHERE workspace_id=%s AND invoice_id=%s ORDER BY received_on DESC,created_at DESC
        LIMIT 100
        """,
        (tenant.id, identifier),
    ).fetchall()
    revisions = conn.execute(
        """
        SELECT version,action,created_at FROM billing_revisions
        WHERE workspace_id=%s AND document_id=%s ORDER BY version DESC,created_at DESC LIMIT 30
        """,
        (tenant.id, identifier),
    ).fetchall()
    return {
        "document": summarized(found, local_today(tenant)),
        "lines": [
            serialize(line, AMOUNTS + ("unit_minor",))
            for line in lines_for(conn, tenant, identifier)
        ],
        "payments": payments,
        "history": revisions,
    }


def billing_overview(conn, tenant):
    today = local_today(tenant)
    records = conn.execute(
        """
        SELECT d.id,d.kind,d.serial,d.status,d.currency,d.company_id,d.company_name,d.subject,d.due_on,d.total_minor,
          d.version,d.updated_at,coalesce(p.paid_minor,0)::bigint AS paid_minor
        FROM billing_documents d LEFT JOIN LATERAL (
          SELECT sum(amount_minor) AS paid_minor FROM recorded_payments p WHERE p.workspace_id=d.workspace_id AND p.invoice_id=d.id
        ) p ON true WHERE d.workspace_id=%s ORDER BY d.updated_at DESC,d.id LIMIT 251
        """,
        (tenant.id,),
    ).fetchall()
    amounts = conn.execute(
        """
        WITH paid AS (
          SELECT invoice_id,sum(amount_minor) AS collected FROM recorded_payments WHERE workspace_id=%s
          GROUP BY invoice_id
        )
        SELECT coalesce(sum(d.total_minor),0)::text AS invoiced_minor,
          coalesce(sum(p.collected),0)::text AS collected_minor,
          coalesce(sum(d.total_minor-coalesce(p.collected,0)),0)::text AS outstanding_minor,
          coalesce(sum(d.total_minor-coalesce(p.collected,0)) FILTER(WHERE d.due_on<%s),0)::text AS overdue_minor
        FROM billing_documents d LEFT JOIN paid p ON p.invoice_id=d.id
        WHERE d.workspace_id=%s AND d.kind='invoice' AND d.status='issued'
        """,
        (tenant.id, today, tenant.id),
    ).fetchone()
    return {
        "currency": tenant.currency,
        "today": today,
        "documents": [summarized(row, today) for row in records[:250]],
        "more_documents": len(records) > 250,
        "catalog": catalog(conn, tenant),
        "totals": amounts,
    }


def _revision(conn, tenant, identifier, version, action, data=None):
    conn.execute(
        """
        INSERT INTO billing_revisions(workspace_id,document_id,version,action,actor_member_id,snapshot)
        VALUES(%s,%s,%s,%s,%s,%s)
        """,
        (
            tenant.id,
            identifier,
            version,
            action,
            tenant.member_id,
            Jsonb(json_value(data)) if data else None,
        ),
    )


def _replace_lines(conn, tenant, identifier, lines):
    conn.execute(
        "DELETE FROM billing_lines WHERE workspace_id=%s AND document_id=%s",
        (tenant.id, identifier),
    )
    with conn.cursor() as cursor:
        cursor.executemany(
            """
            INSERT INTO billing_lines(workspace_id,document_id,position,catalog_id,label,sku,qty_milli,
              unit_minor,discount_bps,tax_bps,subtotal_minor,discount_minor,tax_minor,total_minor)
            VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """,
            [
                (
                    tenant.id,
                    identifier,
                    index,
                    *(
                        line[key]
                        for key in (
                            "catalog_id",
                            "label",
                            "sku",
                            "qty_milli",
                            "unit_minor",
                            "discount_bps",
                            "tax_bps",
                            *AMOUNTS,
                        )
                    ),
                )
                for index, line in enumerate(lines, start=1)
            ],
        )


def _create(conn, tenant, data, lines):
    if conn.execute(
        "SELECT count(*) AS n FROM billing_documents WHERE workspace_id=%s", (tenant.id,)
    ).fetchone()["n"] >= (40 if tenant.kind == "sandbox" else 500):
        raise ServiceError(429, "document_limit", "This workspace has reached its document limit.")
    amount = totals(lines)
    serial = conn.execute(
        "SELECT coalesce(max(serial),0)+1 AS next FROM billing_documents WHERE workspace_id=%s AND kind=%s",
        (tenant.id, data["kind"]),
    ).fetchone()["next"]
    columns = (
        "kind",
        "company_id",
        "contact_id",
        "deal_id",
        "source_quote_id",
        "source_deal_id",
        "company_name",
        "subject",
        "due_on",
        "terms",
        "notes",
    )
    record = conn.execute(
        """
        INSERT INTO billing_documents(workspace_id,kind,company_id,contact_id,deal_id,source_quote_id,
          source_deal_id,company_name,subject,due_on,terms,notes,serial,currency,status,
          subtotal_minor,discount_minor,tax_minor,total_minor)
        VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'draft',%s,%s,%s,%s) RETURNING id,version
        """,
        (
            tenant.id,
            *(data.get(key) for key in columns),
            serial,
            tenant.currency,
            *(amount[key] for key in AMOUNTS),
        ),
    ).fetchone()
    _replace_lines(conn, tenant, record["id"], lines)
    _revision(conn, tenant, record["id"], 1, "created")
    audit(conn, tenant, "create_" + data["kind"], "billing_documents", record["id"])
    return record


def save_document(conn, tenant, spec: SaveDocument):
    if spec.due_on < local_today(tenant):
        raise ServiceError(422, "document_date", "Choose a due or validity date on or after today.")
    company_name = linked_company(conn, tenant, spec.company_id, spec.contact_id, spec.deal_id)
    prior = None
    old = []
    if spec.id:
        prior = get_document(conn, tenant, spec.id)
        require_version(prior["version"], spec.version)
        if prior["status"] != "draft" or prior["kind"] != spec.kind:
            raise ServiceError(
                409, "document_state", "Only drafts of the original type can be edited."
            )
        if (prior["source_quote_id"] or prior["source_deal_id"]) and (
            prior["company_id"] != spec.company_id or prior["deal_id"] != spec.deal_id
        ):
            raise ServiceError(
                409,
                "document_source",
                "This draft keeps the customer and opportunity from its source.",
            )
        if spec.version >= 40:
            raise ServiceError(
                409, "revision_limit", "Duplicate this draft to start a new revision series."
            )
        old = lines_for(conn, tenant, spec.id)
    lines = [
        resolve_line(conn, tenant, item, old[index] if index < len(old) else None)
        for index, item in enumerate(spec.lines)
    ]
    if not prior:
        require_version(0, spec.version)
        return _create(conn, tenant, spec.model_dump() | {"company_name": company_name}, lines)
    _revision(
        conn,
        tenant,
        prior["id"],
        prior["version"],
        "draft_snapshot",
        {"document": prior, "lines": old},
    )
    values = totals(lines)
    result = conn.execute(
        """
        UPDATE billing_documents SET company_id=%s,contact_id=%s,deal_id=%s,company_name=%s,subject=%s,
          due_on=%s,terms=%s,notes=%s,subtotal_minor=%s,discount_minor=%s,tax_minor=%s,total_minor=%s,
          version=version+1,updated_at=now() WHERE workspace_id=%s AND id=%s RETURNING id,version
        """,
        (
            spec.company_id,
            spec.contact_id,
            spec.deal_id,
            company_name,
            spec.subject,
            spec.due_on,
            spec.terms,
            spec.notes,
            *(values[key] for key in AMOUNTS),
            tenant.id,
            spec.id,
        ),
    ).fetchone()
    _replace_lines(conn, tenant, result["id"], lines)
    audit(conn, tenant, "edit_draft", "billing_documents", result["id"])
    return result


def change_document(conn, tenant, spec: ChangeDocument):
    prior = get_document(conn, tenant, spec.id)
    require_version(prior["version"], spec.version)
    expected = {
        ("quotation", "draft"): {"sent"},
        ("quotation", "sent"): {"accepted", "rejected"},
        ("invoice", "draft"): {"issued"},
    }
    if spec.status not in expected.get((prior["kind"], prior["status"]), set()):
        raise ServiceError(409, "document_state", "This document cannot enter the selected state.")
    if prior["kind"] == "quotation" and prior["due_on"] < local_today(tenant):
        raise ServiceError(
            409, "expired_quote", "Duplicate the expired quotation and choose a new validity date."
        )
    result = conn.execute(
        """
        UPDATE billing_documents SET status=%s,version=version+1,updated_at=now()
        WHERE workspace_id=%s AND id=%s RETURNING id,version
        """,
        (spec.status, tenant.id, spec.id),
    ).fetchone()
    _revision(conn, tenant, spec.id, result["version"], spec.status)
    audit(conn, tenant, spec.status, "billing_documents", spec.id)
    if (
        prior["kind"] == "quotation"
        and conn.execute(
            "SELECT 1 FROM automation_workflows WHERE workspace_id=%s AND trigger_type='quotation_status_changed' AND enabled LIMIT 1",
            (tenant.id,),
        ).fetchone()
    ):
        _enqueue(
            conn,
            tenant,
            "quotation_status_changed",
            "billing",
            spec.id,
            f"quotation-status:{spec.id}:{result['version']}",
            {"invoice_status": spec.status, "amount_minor": prior["total_minor"]},
        )
    return result


def generate(conn, tenant, spec: GenerateDocument):
    today = local_today(tenant)
    if spec.source == "deal":
        deal = conn.execute(
            """
            SELECT d.id,d.title,d.amount_minor,d.company_id,d.contact_id,d.version,s.kind FROM deals d
            JOIN pipeline_stages s ON s.workspace_id=d.workspace_id AND s.id=d.stage_id
            WHERE d.workspace_id=%s AND d.id=%s AND d.archived_at IS NULL
            """,
            (tenant.id, spec.id),
        ).fetchone()
        if not deal:
            raise ServiceError(404, "deal", "This deal is unavailable.")
        require_version(deal["version"], spec.version)
        if deal["kind"] != "won" or not deal["company_id"]:
            raise ServiceError(422, "deal", "Choose a won deal linked to a company.")
        existing = conn.execute(
            "SELECT id,version FROM billing_documents WHERE workspace_id=%s AND source_deal_id=%s",
            (tenant.id, spec.id),
        ).fetchone()
        if existing:
            return existing
        customer = linked_company(conn, tenant, deal["company_id"], deal["contact_id"], deal["id"])
        data = {
            "kind": "invoice",
            "company_id": deal["company_id"],
            "contact_id": deal["contact_id"],
            "deal_id": deal["id"],
            "source_deal_id": deal["id"],
            "company_name": customer,
            "subject": deal["title"],
            "due_on": today + timedelta(days=30),
            "terms": "",
            "notes": "",
        }
        line = {
            "catalog_id": None,
            "label": deal["title"],
            "sku": None,
            "qty_milli": 1000,
            "unit_minor": deal["amount_minor"],
            "tax_bps": 0,
            "discount_bps": 0,
        } | calculate_line(
            deal["amount_minor"],
            1000,
            0,
            0,
        )
        return _create(conn, tenant, data, [line])
    source = get_document(conn, tenant, spec.id)
    require_version(source["version"], spec.version)
    data = source | {
        "source_deal_id": None,
        "source_quote_id": None,
        "due_on": today + timedelta(days=30),
    }
    if spec.source == "quotation":
        if source["kind"] != "quotation" or source["status"] != "accepted":
            raise ServiceError(422, "quote", "Choose an accepted quotation.")
        existing = conn.execute(
            "SELECT id,version FROM billing_documents WHERE workspace_id=%s AND source_quote_id=%s",
            (tenant.id, spec.id),
        ).fetchone()
        if existing:
            return existing
        data |= {"kind": "invoice", "source_quote_id": spec.id}
    return _create(conn, tenant, data, lines_for(conn, tenant, spec.id))


def record_payment(conn, tenant, spec: Payment):
    found = get_document(conn, tenant, spec.id)
    require_version(found["version"], spec.version)
    if found["kind"] != "invoice" or found["status"] != "issued":
        raise ServiceError(422, "invoice", "Record payments against an issued invoice.")
    if spec.received_on > local_today(tenant):
        raise ServiceError(422, "payment_date", "The received date cannot be in the future.")
    if found["paid_minor"] + int(spec.amount_minor) > found["total_minor"]:
        raise ServiceError(422, "overpayment", "The payment exceeds the outstanding balance.")
    if (
        conn.execute(
            "SELECT count(*) AS n FROM recorded_payments WHERE workspace_id=%s AND invoice_id=%s",
            (tenant.id, spec.id),
        ).fetchone()["n"]
        >= 100
    ):
        raise ServiceError(
            429, "payment_limit", "This invoice has reached its recorded-payment limit."
        )
    record = conn.execute(
        """
        INSERT INTO recorded_payments(workspace_id,invoice_id,actor_member_id,amount_minor,received_on,method,reference,notes)
        VALUES(%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id
        """,
        (
            tenant.id,
            spec.id,
            tenant.member_id,
            int(spec.amount_minor),
            spec.received_on,
            spec.method,
            spec.reference,
            spec.notes,
        ),
    ).fetchone()
    conn.execute(
        "UPDATE billing_documents SET version=version+1,updated_at=now() WHERE workspace_id=%s AND id=%s",
        (tenant.id, spec.id),
    )
    _revision(conn, tenant, spec.id, spec.version + 1, "payment")
    audit(conn, tenant, "record_payment", "billing_documents", spec.id)
    return record

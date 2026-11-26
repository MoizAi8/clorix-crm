import re
from datetime import date
from decimal import Decimal, InvalidOperation

from psycopg import sql
from psycopg.types.json import Jsonb

from clorix.billing import serialize
from clorix.intelligence import rounded_ratio
from clorix.mutations import audit, require_owner, require_version
from clorix.productivity_inputs import (
    Attribution,
    Campaign,
    CustomDefinition,
    DraftRequest,
    EmailTemplate,
    Preset,
    RecordField,
    RecordFieldRequest,
    ReportRequest,
    ViewRequest,
)
from clorix.security import ServiceError

RECORDS = {
    "leads": "lead_id",
    "contacts": "contact_id",
    "companies": "company_id",
    "deals": "deal_id",
}
VARIABLES = {"contact_name", "first_name", "company_name", "deal_title"}
TAG = re.compile(r"(?<!\{)\{\{\s*([a-z_]+)\s*\}\}(?!\})")


def _limit(conn, tenant, table, small, large):
    size = conn.execute(
        sql.SQL("SELECT count(*) AS n FROM {} WHERE workspace_id=%s").format(sql.Identifier(table)),
        (tenant.id,),
    ).fetchone()["n"]
    if size >= (small if tenant.kind == "sandbox" else large):
        raise ServiceError(
            429, "record_limit", "This workspace has reached the limit for these records."
        )


def _find(conn, tenant, table, identifier):
    return conn.execute(
        sql.SQL("SELECT * FROM {} WHERE workspace_id=%s AND id=%s").format(sql.Identifier(table)),
        (tenant.id, identifier),
    ).fetchone()


def _write(conn, tenant, table, identifier, version, values):
    fields = [sql.Identifier(key) for key in values]
    args = tuple(values.values())
    if identifier:
        row = _find(conn, tenant, table, identifier)
        if not row:
            raise ServiceError(404, "record", "This record is unavailable.")
        require_version(row["version"], version)
        assignments = sql.SQL(",").join(sql.Composed([field, sql.SQL("=%s")]) for field in fields)
        update = sql.SQL(
            "UPDATE {} SET {},version=version+1,updated_at=now() WHERE workspace_id=%s AND id=%s RETURNING id,version"
        )
        record = conn.execute(
            update.format(sql.Identifier(table), assignments), (*args, tenant.id, identifier)
        ).fetchone()
    else:
        require_version(0, version)
        insert = sql.SQL("INSERT INTO {}(workspace_id,{}) VALUES(%s,{}) RETURNING id,version")
        record = conn.execute(
            insert.format(
                sql.Identifier(table),
                sql.SQL(",").join(fields),
                sql.SQL(",").join(sql.Placeholder() for _ in fields),
            ),
            (tenant.id, *args),
        ).fetchone()
    audit(conn, tenant, "update" if identifier else "create", table, record["id"])
    return record


def campaigns(conn, tenant):
    rows = conn.execute(
        """
        SELECT c.*,coalesce(t.leads,0) AS leads,coalesce(t.converted,0) AS converted,
          coalesce(t.won,0)::text AS won_minor
        FROM campaigns c LEFT JOIN LATERAL (
          SELECT count(DISTINCT l.id) AS leads,count(DISTINCT l.id) FILTER(WHERE l.status='converted') AS converted,
            sum(d.amount_minor) FILTER(WHERE s.kind='won' AND d.archived_at IS NULL) AS won
          FROM campaign_attribution a JOIN leads l ON l.workspace_id=a.workspace_id AND l.id=a.lead_id
          LEFT JOIN deals d ON d.workspace_id=a.workspace_id AND d.lead_id=l.id
          LEFT JOIN pipeline_stages s ON s.workspace_id=d.workspace_id AND s.id=d.stage_id
          WHERE a.workspace_id=c.workspace_id AND a.campaign_id=c.id
        ) t ON true WHERE c.workspace_id=%s ORDER BY c.starts_on DESC,c.id LIMIT 150
        """,
        (tenant.id,),
    ).fetchall()
    attributed = conn.execute(
        """
        SELECT a.lead_id,a.campaign_id,l.name FROM campaign_attribution a
        JOIN leads l ON l.workspace_id=a.workspace_id AND l.id=a.lead_id
        WHERE a.workspace_id=%s ORDER BY a.attributed_at DESC,l.id LIMIT 500
        """,
        (tenant.id,),
    ).fetchall()
    for row in rows:
        row["conversion_percent"] = (
            rounded_ratio(row["converted"] * 100, row["leads"]) if row["leads"] else None
        )
        row["cost_per_lead_minor"] = (
            str(rounded_ratio(row["cost_minor"], row["leads"])) if row["leads"] else None
        )
    return {
        "campaigns": [serialize(row, ("budget_minor", "cost_minor")) for row in rows],
        "attribution": attributed,
    }


def save_campaign(conn, tenant, spec: Campaign):
    if spec.ends_on < spec.starts_on:
        raise ServiceError(422, "campaign_date", "The end date must be on or after the start date.")
    if not spec.id:
        _limit(conn, tenant, "campaigns", 25, 150)
    fields = spec.model_dump(exclude={"id", "key", "version"})
    fields |= {"budget_minor": int(spec.budget_minor), "cost_minor": int(spec.cost_minor)}
    return _write(conn, tenant, "campaigns", spec.id, spec.version, fields)


def attribute(conn, tenant, spec: Attribution):
    lead = _find(conn, tenant, "leads", spec.lead_id)
    if not lead or lead["archived_at"]:
        raise ServiceError(404, "lead", "Select an active lead.")
    prior = conn.execute(
        "SELECT campaign_id FROM campaign_attribution WHERE workspace_id=%s AND lead_id=%s",
        (tenant.id, spec.lead_id),
    ).fetchone()
    if (prior["campaign_id"] if prior else None) != spec.previous_campaign_id:
        raise ServiceError(
            409, "attribution_changed", "The lead attribution changed. Refresh the campaign."
        )
    if spec.campaign_id:
        if not _find(conn, tenant, "campaigns", spec.campaign_id):
            raise ServiceError(404, "campaign", "This campaign is unavailable.")
        conn.execute(
            """
            INSERT INTO campaign_attribution(workspace_id,campaign_id,lead_id) VALUES(%s,%s,%s)
            ON CONFLICT(workspace_id,lead_id) DO UPDATE SET campaign_id=excluded.campaign_id,attributed_at=now()
            """,
            (tenant.id, spec.campaign_id, spec.lead_id),
        )
    else:
        conn.execute(
            "DELETE FROM campaign_attribution WHERE workspace_id=%s AND lead_id=%s",
            (tenant.id, spec.lead_id),
        )
    audit(conn, tenant, "link_campaign", "leads", spec.lead_id)
    return {"lead_id": spec.lead_id, "campaign_id": spec.campaign_id}


def validate_template(value):
    names = set(TAG.findall(value))
    remainder = TAG.sub("", value)
    if not names.issubset(VARIABLES) or "{{" in remainder or "}}" in remainder:
        raise ServiceError(422, "template_variable", "Use only supported template placeholders.")


def template_data(conn, tenant):
    rows = conn.execute(
        "SELECT * FROM email_templates WHERE workspace_id=%s ORDER BY updated_at DESC,id LIMIT 150",
        (tenant.id,),
    ).fetchall()
    drafts = conn.execute(
        """
        SELECT d.id,t.name AS template,c.name AS contact,d.subject,d.body,d.created_at
        FROM email_drafts d JOIN email_templates t ON t.workspace_id=d.workspace_id AND t.id=d.template_id
        JOIN contacts c ON c.workspace_id=d.workspace_id AND c.id=d.contact_id
        WHERE d.workspace_id=%s ORDER BY d.created_at DESC,d.id LIMIT 80
        """,
        (tenant.id,),
    ).fetchall()
    return {"templates": rows, "drafts": drafts, "variables": sorted(VARIABLES)}


def save_template(conn, tenant, spec: EmailTemplate):
    for value in (spec.subject, spec.body):
        validate_template(value)
    if not spec.id:
        _limit(conn, tenant, "email_templates", 25, 150)
    return _write(
        conn,
        tenant,
        "email_templates",
        spec.id,
        spec.version,
        spec.model_dump(exclude={"id", "key", "version"}),
    )


def replace_template(source, values):
    validate_template(source)
    missing = {name for name in TAG.findall(source) if not values.get(name)}
    if missing:
        raise ServiceError(
            422,
            "draft_data",
            "The selected records do not provide: " + ", ".join(sorted(missing)) + ".",
        )
    return TAG.sub(lambda match: values[match[1]], source)


def draft(conn, tenant, spec: DraftRequest):
    template = _find(conn, tenant, "email_templates", spec.template_id)
    contact = _find(conn, tenant, "contacts", spec.contact_id)
    if not template or not contact or contact["archived_at"]:
        raise ServiceError(404, "template_record", "Select an active contact and a saved template.")
    company = (
        _find(conn, tenant, "companies", contact["company_id"]) if contact["company_id"] else None
    )
    deal = _find(conn, tenant, "deals", spec.deal_id) if spec.deal_id else None
    if spec.deal_id and (
        not deal
        or deal["archived_at"]
        or not (
            deal["contact_id"] == contact["id"]
            or contact["company_id"] is not None
            and deal["company_id"] == contact["company_id"]
        )
    ):
        raise ServiceError(
            422, "draft_deal", "The selected deal must be linked to the contact or their company."
        )
    values = {
        "contact_name": contact["name"],
        "first_name": contact["name"].split()[0],
        "company_name": company["name"] if company else "",
        "deal_title": deal["title"] if deal else "",
    }
    subject = replace_template(template["subject"], values)
    body = replace_template(template["body"], values)
    if len(subject) > 350 or len(body) > 9000:
        raise ServiceError(
            422, "draft_size", "Shorten the template output before creating the draft."
        )
    result = {"subject": subject, "body": body}
    if spec.save:
        _limit(conn, tenant, "email_drafts", 50, 500)
        stored = conn.execute(
            """
            INSERT INTO email_drafts(workspace_id,template_id,contact_id,deal_id,subject,body,actor_member_id)
            VALUES(%s,%s,%s,%s,%s,%s,%s) RETURNING id
            """,
            (
                tenant.id,
                spec.template_id,
                contact["id"],
                spec.deal_id,
                subject,
                body,
                tenant.member_id,
            ),
        ).fetchone()
        audit(conn, tenant, "save_email_draft", "email_drafts", stored["id"])
        result |= stored
    return result


def definitions(conn, tenant):
    return conn.execute(
        "SELECT id,entity,name,data_type,options,active,version FROM custom_field_definitions WHERE workspace_id=%s ORDER BY entity,name,id",
        (tenant.id,),
    ).fetchall()


def define_field(conn, tenant, spec: CustomDefinition):
    require_owner(tenant)
    select = spec.data_type.endswith("_select")
    if select != bool(spec.options) or len(set(spec.options)) != len(spec.options):
        raise ServiceError(
            422,
            "field_options",
            "Select fields require unique options. Other fields cannot have options.",
        )
    if spec.id:
        previous = _find(conn, tenant, "custom_field_definitions", spec.id)
        if not previous:
            raise ServiceError(404, "field", "This custom field is unavailable.")
        require_version(previous["version"], spec.version)
        if spec.entity != previous["entity"] or spec.data_type != previous["data_type"]:
            raise ServiceError(
                409, "field_type", "Existing field types and record types are fixed."
            )
        if not set(previous["options"]).issubset(spec.options):
            raise ServiceError(
                409, "field_options", "Keep existing options to preserve saved values."
            )
        item = conn.execute(
            """
            UPDATE custom_field_definitions SET name=%s,options=%s,active=%s,version=version+1
            WHERE workspace_id=%s AND id=%s RETURNING id,version
            """,
            (spec.name, spec.options, spec.active, tenant.id, spec.id),
        ).fetchone()
    else:
        require_version(0, spec.version)
        _limit(conn, tenant, "custom_field_definitions", 28, 80)
        item = conn.execute(
            """
            INSERT INTO custom_field_definitions(workspace_id,entity,name,data_type,options,active)
            VALUES(%s,%s,%s,%s,%s,%s) RETURNING id,version
            """,
            (tenant.id, spec.entity, spec.name, spec.data_type, spec.options, spec.active),
        ).fetchone()
    audit(conn, tenant, "define_custom_field", "custom_field_definitions", item["id"])
    return item


def record_fields(conn, tenant, spec: RecordFieldRequest):
    if not _find(conn, tenant, spec.entity, spec.record_id):
        raise ServiceError(404, "record", "This record is unavailable.")
    query = sql.SQL("""
        SELECT d.id,d.name,d.data_type,d.options,d.active,v.value,coalesce(v.version,0) AS version
        FROM custom_field_definitions d LEFT JOIN custom_field_values v
          ON v.workspace_id=d.workspace_id AND v.definition_id=d.id AND v.{}=%s
        WHERE d.workspace_id=%s AND d.entity=%s AND (d.active OR v.version IS NOT NULL)
        ORDER BY d.name,d.id
        """).format(sql.Identifier(RECORDS[spec.entity]))
    return conn.execute(query, (spec.record_id, tenant.id, spec.entity)).fetchall()


def field_value(kind, options, value):
    if value is None:
        return None
    if kind == "text" and isinstance(value, str) and len(value) <= 1000:
        return value.strip()
    if kind == "boolean" and isinstance(value, bool):
        return value
    if (
        kind == "number"
        and isinstance(value, str)
        and re.fullmatch(r"-?\d{1,12}(\.\d{1,6})?", value)
    ):
        try:
            return format(Decimal(value).normalize(), "f")
        except InvalidOperation:
            pass
    if kind == "date" and isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        try:
            return date.fromisoformat(value).isoformat()
        except ValueError:
            pass
    if kind == "single_select" and isinstance(value, str) and value in options:
        return value
    if (
        kind == "multi_select"
        and isinstance(value, list)
        and len(value) <= 15
        and set(value).issubset(options)
    ):
        return sorted(set(value))
    raise ServiceError(422, "field_value", "Choose a value that matches the field definition.")


def save_custom_value(conn, tenant, spec: RecordField):
    parent = _find(conn, tenant, spec.entity, spec.record_id)
    if not parent or parent["archived_at"]:
        raise ServiceError(404, "record", "This record is unavailable.")
    prior = next(
        (
            item
            for item in record_fields(
                conn, tenant, RecordFieldRequest(entity=spec.entity, record_id=spec.record_id)
            )
            if item["id"] == spec.definition_id and item["active"]
        ),
        None,
    )
    if not prior:
        raise ServiceError(404, "field", "This field is unavailable.")
    require_version(prior["version"], spec.version)
    value = field_value(prior["data_type"], prior["options"], spec.value)
    query = sql.SQL("""
        INSERT INTO custom_field_values(workspace_id,definition_id,entity,{},value)
        VALUES(%s,%s,%s,%s,%s) ON CONFLICT ON CONSTRAINT unique_custom_value DO UPDATE
          SET value=excluded.value,version=custom_field_values.version+1 RETURNING version
        """).format(sql.Identifier(RECORDS[spec.entity]))
    saved = conn.execute(
        query, (tenant.id, spec.definition_id, spec.entity, spec.record_id, Jsonb(value))
    ).fetchone()
    audit(conn, tenant, "update_custom_value", spec.entity, spec.record_id)
    return {"value": value, **saved}


def presets(conn, tenant):
    return conn.execute(
        """
        SELECT id,kind,name,specification,version FROM saved_workspace_presets
        WHERE workspace_id=%s AND user_id=%s ORDER BY kind,name,id LIMIT 50
        """,
        (tenant.id, tenant.user_id),
    ).fetchall()


def save_preset(conn, tenant, spec: Preset):
    correct = (
        spec.kind == "view"
        and isinstance(spec.specification, ViewRequest)
        or spec.kind == "report"
        and isinstance(spec.specification, ReportRequest)
    )
    if not correct:
        raise ServiceError(422, "preset", "The saved options do not match their type.")
    if isinstance(spec.specification, ReportRequest):
        from clorix.reports import valid_range

        valid_range(spec.specification)
    elif (
        spec.specification.owner
        and not conn.execute(
            "SELECT 1 FROM memberships WHERE workspace_id=%s AND id=%s AND status='active'",
            (tenant.id, spec.specification.owner),
        ).fetchone()
    ):
        raise ServiceError(422, "preset_owner", "Select an active workspace member.")
    if not spec.id and len(presets(conn, tenant)) >= 50:
        raise ServiceError(
            429, "preset_limit", "You have reached the limit for saved views and reports."
        )
    return _write(
        conn,
        tenant,
        "saved_workspace_presets",
        spec.id,
        spec.version,
        {
            "user_id": tenant.user_id,
            "name": spec.name,
            "kind": spec.kind,
            "specification": Jsonb(spec.specification.model_dump(mode="json")),
        },
    )

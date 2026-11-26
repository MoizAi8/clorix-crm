import os
from uuid import uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg.conninfo import conninfo_to_dict
from test_security import KEY, signed

from clorix.app import create_app

pytestmark = pytest.mark.postgres


class _Connections(tuple):
    def __repr__(self):
        return "<isolated PostgreSQL test connections>"


@pytest.fixture
def connections():
    admin = os.getenv("DIRECT_DATABASE_URL")
    runtime = os.getenv("CLORIX_ENGINE_DATABASE_URL")
    if not admin or not runtime:
        pytest.skip("Dedicated PostgreSQL test connections are missing.")
    for dsn in (admin, runtime):
        fields = conninfo_to_dict(dsn)
        assert fields["dbname"] == "clorix_test"
        assert fields["host"] in {"localhost", "127.0.0.1"}
    return _Connections((admin, runtime))


def tenant(conn):
    actor = uuid4()
    conn.execute(
        """
        INSERT INTO "user"(id,name,email,"createdAt","updatedAt")
        VALUES(%s,'Isolated verification',%s,now(),now())
        """,
        (actor, f"{actor}@clorix.example"),
    )
    workspace = conn.execute(
        "SELECT clorix_access.init_workspace(%s,'Engine test','private',null)",
        (actor,),
    ).fetchone()[0]
    conn.execute(
        "INSERT INTO leads(workspace_id,name) VALUES(%s,'Isolated engine lead')", (workspace,)
    )
    return actor, workspace


def test_rechecks_membership_and_never_reuses_tenant_context(connections):
    admin, runtime = connections
    with psycopg.connect(admin, autocommit=True) as owner:
        first, own_workspace = tenant(owner)
        second, other_workspace = tenant(owner)
        try:
            with TestClient(create_app(runtime, KEY)) as client:
                a = signed(sub=str(first), workspace=str(own_workspace))
                forbidden = signed(sub=str(first), workspace=str(other_workspace))
                b = signed(sub=str(second), workspace=str(other_workspace))
                assert client.get("/v2/workspace", headers=a).json()["data"]["currency"] == "USD"
                assert client.get("/v2/workspace", headers=forbidden).status_code == 404
                assert client.get("/v2/workspace", headers=b).status_code == 200
                owner.execute("UPDATE memberships SET status='removed' WHERE user_id=%s", (first,))
                assert client.get("/v2/workspace", headers=a).status_code == 404
        finally:
            owner.execute('DELETE FROM "user" WHERE id IN (%s,%s)', (first, second))


def test_python_login_is_restricted(connections):
    _, runtime = connections
    with psycopg.connect(runtime) as conn:
        assert conn.execute("SELECT count(*) FROM leads").fetchone()[0] == 0
        assert conn.execute(
            """
            SELECT r.rolsuper,r.rolbypassrls,has_schema_privilege(current_user,'public','CREATE'),
              has_table_privilege(current_user,'public.session','SELECT'),
              has_table_privilege(current_user,'public.leads','UPDATE')
            FROM pg_roles r WHERE r.rolname=current_user
            """
        ).fetchone() == (False, False, False, False, False)


def test_billing_snapshots_payments_pdf_and_tenant_scope(connections):
    import json
    from concurrent.futures import ThreadPoolExecutor
    from datetime import datetime, timedelta, timezone
    from io import BytesIO

    from pypdf import PdfReader

    admin, runtime = connections
    with psycopg.connect(admin, autocommit=True) as owner:
        actor, workspace = tenant(owner)
        stranger, other = tenant(owner)
        company = owner.execute(
            "INSERT INTO companies(workspace_id,name) VALUES(%s,'Fictional Billing Company') RETURNING id",
            (workspace,),
        ).fetchone()[0]
        today = datetime.now(timezone.utc).date()
        try:
            with TestClient(create_app(runtime, KEY)) as client:

                def post(path, scope, body, *, tenant_id=workspace, subject=actor):
                    payload = json.dumps(body, default=str, sort_keys=True).encode()
                    return client.post(
                        path,
                        content=payload,
                        headers=signed(
                            target=path,
                            scope=scope,
                            method="POST",
                            body=payload,
                            sub=str(subject),
                            workspace=str(tenant_id),
                        ),
                    )

                def saved(path, scope, body):
                    result = post(path, scope, body)
                    assert result.status_code == 200, result.text
                    return result.json()["data"]

                item_request = {
                    "key": uuid4(),
                    "version": 0,
                    "sku": "FIX-1",
                    "name": "Fictional briefing",
                    "kind": "service",
                    "price_minor": "2501",
                    "tax_bps": 500,
                }
                item = saved("/v2/catalog", "catalog:write", item_request)
                quote = saved(
                    "/v2/billing-document",
                    "billing:write",
                    {
                        "key": uuid4(),
                        "version": 0,
                        "kind": "quotation",
                        "company_id": company,
                        "subject": "Fictional quote",
                        "due_on": today + timedelta(days=20),
                        "lines": [
                            {"catalog_id": item["id"], "quantity": "1.25", "discount_bps": 1000}
                        ],
                    },
                )
                saved(
                    "/v2/catalog",
                    "catalog:write",
                    item_request
                    | {"key": uuid4(), "id": item["id"], "version": 1, "price_minor": "9999"},
                )
                original = saved("/v2/billing-detail", "billing:detail", {"id": quote["id"]})
                assert original["lines"][0]["unit_minor"] == "2501"
                assert original["document"]["total_minor"] == "2954"
                assert (
                    post(
                        "/v2/billing-detail",
                        "billing:detail",
                        {"id": quote["id"]},
                        tenant_id=other,
                        subject=stranger,
                    ).status_code
                    == 404
                )

                version = quote["version"]
                for status in ("sent", "accepted"):
                    saved(
                        "/v2/billing-status",
                        "billing:status",
                        {"key": uuid4(), "id": quote["id"], "version": version, "status": status},
                    )
                    version += 1
                derive = {
                    "key": uuid4(),
                    "id": quote["id"],
                    "version": version,
                    "source": "quotation",
                }
                invoice = saved("/v2/billing-generate", "billing:generate", derive)
                assert (
                    saved("/v2/billing-generate", "billing:generate", derive | {"key": uuid4()})[
                        "id"
                    ]
                    == invoice["id"]
                )
                saved(
                    "/v2/billing-status",
                    "billing:status",
                    {"key": uuid4(), "id": invoice["id"], "version": 1, "status": "issued"},
                )
                payment = {
                    "id": invoice["id"],
                    "version": 2,
                    "amount_minor": "1500",
                    "received_on": today,
                    "method": "bank_transfer",
                    "reference": "synthetic payment",
                }
                assert (
                    post(
                        "/v2/billing-payment",
                        "billing:payment",
                        payment | {"key": uuid4(), "amount_minor": "2955"},
                    ).status_code
                    == 422
                )
                with ThreadPoolExecutor(max_workers=2) as threads:
                    futures = [
                        threads.submit(
                            post,
                            "/v2/billing-payment",
                            "billing:payment",
                            payment | {"key": uuid4()},
                        )
                        for _ in range(2)
                    ]
                    assert sorted(future.result().status_code for future in futures) == [200, 409]
                detail = saved("/v2/billing-detail", "billing:detail", {"id": invoice["id"]})
                assert detail["document"]["balance_minor"] == "1454"
                assert detail["document"]["state"] == "partial"
                assert len(detail["payments"]) == 1
                result = post("/v2/billing-pdf", "billing:pdf", {"id": invoice["id"]})
                assert result.status_code == 200
                assert result.headers["Content-Type"] == "application/pdf"
                assert "USD 14.54" in PdfReader(BytesIO(result.content)).pages[0].extract_text()
        finally:
            owner.execute('DELETE FROM "user" WHERE id IN (%s,%s)', (actor, stranger))


def test_support_events_health_calendar_and_team_targets(connections):
    import json
    from datetime import datetime, timedelta, timezone

    admin, runtime = connections
    with psycopg.connect(admin, autocommit=True) as owner:
        actor, workspace = tenant(owner)
        company = owner.execute(
            "INSERT INTO companies(workspace_id,name) VALUES(%s,'Operations fixture') RETURNING id",
            (workspace,),
        ).fetchone()[0]
        member = owner.execute(
            "SELECT id FROM memberships WHERE workspace_id=%s AND user_id=%s", (workspace, actor)
        ).fetchone()[0]
        today = datetime.now(timezone.utc).date()
        try:
            with TestClient(create_app(runtime, KEY)) as client:

                def req(path, scope, body=None, status=200):
                    method = "POST" if body is not None else "GET"
                    content = (
                        json.dumps(body, default=str, sort_keys=True).encode()
                        if body is not None
                        else b""
                    )
                    result = client.request(
                        method,
                        path,
                        content=content,
                        headers=signed(
                            target=path,
                            scope=scope,
                            method=method,
                            body=content,
                            sub=str(actor),
                            workspace=str(workspace),
                        ),
                    )
                    assert result.status_code == status, result.text
                    return result.json().get("data")

                spec = {
                    "key": uuid4(),
                    "version": 0,
                    "company_id": company,
                    "subject": "Fictional support ticket",
                    "description": "A fictional question",
                    "category": "Implementation",
                    "priority": "high",
                    "assignee_id": member,
                }
                ticket = req("/v2/support", "support:write", spec)
                health = req("/v2/intelligence", "intelligence:read")
                customer = next(item for item in health["customers"] if item["id"] == str(company))
                assert customer["operations_penalty"] == 5
                note = req(
                    "/v2/support-note",
                    "support:note",
                    {
                        "key": uuid4(),
                        "version": 1,
                        "id": ticket["id"],
                        "body": "Fictional internal note",
                    },
                )
                resolved = req(
                    "/v2/support",
                    "support:write",
                    spec
                    | {
                        "key": uuid4(),
                        "id": ticket["id"],
                        "version": note["version"],
                        "status": "resolved",
                        "resolution": "Resolved after checking the fictional request.",
                    },
                )
                assert resolved["version"] == 3
                history = req("/v2/support-detail", "support:detail", {"id": ticket["id"]})
                assert history["ticket"]["resolved_at"]
                assert any(
                    entry["body"] == "Fictional internal note" for entry in history["history"]
                )
                assert req("/v2/support", "support:read")["metrics"]["resolved"] == 1

                start = datetime.now(timezone.utc).replace(
                    hour=10, minute=0, second=0, microsecond=0
                )
                event = {
                    "key": uuid4(),
                    "version": 0,
                    "title": "Fictional calendar event",
                    "kind": "meeting",
                    "assignee_id": member,
                    "company_id": company,
                    "starts_at": start.isoformat(),
                    "ends_at": (start + timedelta(hours=1)).isoformat(),
                }
                made = req("/v2/calendar-event", "calendar:write", event)
                assert (
                    req(
                        "/v2/calendar",
                        "calendar:read",
                        {"date": today, "mode": "month", "kind": "meeting"},
                    )["events"][0]["id"]
                    == made["id"]
                )
                assert (
                    req("/v2/calendar", "calendar:read", {"date": today, "mode": "week"})["zone"]
                    == "UTC"
                )
                req(
                    "/v2/calendar-event",
                    "calendar:write",
                    event | {"key": uuid4(), "id": made["id"], "version": 1, "cancelled": True},
                )
                assert (
                    req(
                        "/v2/calendar",
                        "calendar:read",
                        {"date": today, "mode": "agenda", "kind": "meeting"},
                    )["events"]
                    == []
                )
                req(
                    "/v2/team-member-target",
                    "team-target:write",
                    {
                        "key": uuid4(),
                        "member_id": member,
                        "version": 0,
                        "month": today.replace(day=1),
                        "amount_minor": "120000",
                    },
                )
                profile = req("/v2/team-performance", "team-performance:read")["members"][0]
                assert profile["target_minor"] == "120000"
                assert profile["booked_minor"] == "0"
        finally:
            owner.execute('DELETE FROM "user" WHERE id=%s', (actor,))


def productivity_call(client, actor, workspace, target, scope, body=None, **grants):
    import json

    method = "GET" if body is None else "POST"
    payload = b"" if body is None else json.dumps(body, default=str, sort_keys=True).encode()
    return client.request(
        method,
        "/v2/" + target,
        content=payload,
        headers=signed(
            scope,
            "/v2/" + target,
            method,
            payload,
            sub=str(actor),
            workspace=str(workspace),
            **grants,
        ),
    )


def test_productivity_persistence_attribution_reports_and_owner_audit(connections):
    from datetime import datetime, timezone

    admin, runtime = connections
    with psycopg.connect(admin, autocommit=True) as owner:
        actor, workspace = tenant(owner)
        stranger, foreign = tenant(owner)
        lead = owner.execute("SELECT id FROM leads WHERE workspace_id=%s", (workspace,)).fetchone()[
            0
        ]
        contact = owner.execute(
            "INSERT INTO contacts(workspace_id,name) VALUES(%s,'Fictional Reviewer') RETURNING id",
            (workspace,),
        ).fetchone()[0]
        today = datetime.now(timezone.utc).date().isoformat()
        try:
            with TestClient(create_app(runtime, KEY)) as client:

                def call(target, scope, body=None, subject=actor, space=workspace):
                    return productivity_call(client, subject, space, target, scope, body)

                def write(target, scope, **fields):
                    result = call(target, scope, {"key": uuid4(), "version": 0, **fields})
                    assert result.status_code == 200, result.text
                    return result.json()["data"]

                campaign = write(
                    "campaigns",
                    "campaign:write",
                    name="Partner outreach",
                    channel="partner",
                    status="active",
                    starts_on=today,
                    ends_on=today,
                    budget_minor="15000",
                    cost_minor="5000",
                )
                attribution = {
                    "key": uuid4(),
                    "version": 0,
                    "campaign_id": campaign["id"],
                    "lead_id": lead,
                }
                assert (
                    call("campaign-attribution", "attribution:write", attribution).status_code
                    == 200
                )
                assert (
                    call("campaign-attribution", "attribution:write", attribution).status_code
                    == 200
                )
                assert (
                    call(
                        "campaign-attribution", "attribution:write", {**attribution, "key": uuid4()}
                    ).status_code
                    == 409
                )
                rows = call("campaigns", "productivity:read").json()["data"]["campaigns"]
                assert [(r["leads"], r["converted"], r["cost_per_lead_minor"]) for r in rows] == [
                    (1, 0, "5000")
                ]
                assert (
                    call("campaigns", "productivity:read", subject=stranger, space=foreign).json()[
                        "data"
                    ]["campaigns"]
                    == []
                )
                assert call("campaigns", "productivity:read", subject=stranger).status_code == 404

                template = write(
                    "email-templates",
                    "email-template:write",
                    name="Partner follow-up",
                    category="sales",
                    subject="Hello {{first_name}}",
                    body="Thanks, {{contact_name}}.",
                )
                message = {"key": uuid4(), "template_id": template["id"], "contact_id": contact}
                preview = call("email-draft", "email-draft:render", message)
                assert preview.json()["data"] == {
                    "subject": "Hello Fictional",
                    "body": "Thanks, Fictional Reviewer.",
                }
                assert call("email-templates", "productivity:read").json()["data"]["drafts"] == []
                draft = call("email-draft", "email-draft:render", {**message, "save": True})
                assert draft.status_code == 200, draft.text
                assert (
                    len(call("email-templates", "productivity:read").json()["data"]["drafts"]) == 1
                )

                field = write(
                    "custom-fields",
                    "field-definition:write",
                    name="Renewal confidence",
                    entity="leads",
                    data_type="number",
                )
                write(
                    "record-field",
                    "field-value:write",
                    definition_id=field["id"],
                    entity="leads",
                    record_id=lead,
                    value="3.70",
                )
                fields = call(
                    "record-fields", "productivity:read", {"entity": "leads", "record_id": lead}
                )
                assert fields.json()["data"][0]["value"] == "3.7"
                write(
                    "saved-presets",
                    "preset:write",
                    name="Important leads",
                    kind="view",
                    specification={"entity": "leads", "query": "isolated"},
                )
                assert (
                    call("saved-presets", "productivity:read").json()["data"][0]["name"]
                    == "Important leads"
                )
                for dimension in (
                    "lead_source",
                    "deal_stage",
                    "booked_month",
                    "invoice_status",
                    "payment_month",
                    "support_status",
                    "campaign",
                    "team",
                    "workflow_outcome",
                    "customer_health",
                    "forecast",
                ):
                    result = call(
                        "report-builder",
                        "productivity:read",
                        {"dimension": dimension, "starts_on": today, "ends_on": today},
                    )
                    assert result.status_code == 200, result.text
                    assert result.json()["data"]["dimension"] == dimension
                result = call(
                    "report-builder",
                    "productivity:read",
                    {"dimension": "lead_source", "starts_on": today, "ends_on": today},
                )
                assert sum(int(row["value"]) for row in result.json()["data"]["rows"]) == 1
                result = call("audit-history", "audit:read", {"entity": "campaigns"})
                assert result.status_code == 200, result.text
                assert result.json()["data"][0]["resource_id"] == campaign["id"]
                owner.execute(
                    "UPDATE memberships SET role='member' WHERE workspace_id=%s AND user_id=%s",
                    (workspace, actor),
                )
                assert call("audit-history", "audit:read", {}).status_code == 403
                assert (
                    call(
                        "custom-fields",
                        "field-definition:write",
                        {
                            "key": uuid4(),
                            "version": 0,
                            "entity": "leads",
                            "name": "Restricted",
                            "data_type": "boolean",
                        },
                    ).status_code
                    == 403
                )
        finally:
            owner.execute('DELETE FROM "user" WHERE id IN (%s,%s)', (actor, stranger))


def test_copilot_enforces_region_consent_and_history_with_mocked_provider(connections, monkeypatch):
    from clorix import copilot

    admin, runtime = connections
    answer = {
        "title": "Fictional response",
        "summary": "An example",
        "actions": [],
        "context_refs": ["orchard-pipeline"],
        "draft": "",
    }
    calls = []

    def inference(fixture, action):
        calls.append((fixture, action))
        return answer

    monkeypatch.setattr(copilot, "configured", lambda: True)
    monkeypatch.setattr(copilot, "generate", inference)
    with psycopg.connect(admin, autocommit=True) as owner:
        actor, workspace = tenant(owner)
        owner.execute(
            "INSERT INTO copilot_reviewers(workspace_id,user_id,jurisdiction) VALUES(%s,%s,'PK')",
            (workspace, actor),
        )
        try:
            with TestClient(create_app(runtime, KEY)) as client:

                def call(target, scope, body=None, country="PK"):
                    return productivity_call(
                        client, actor, workspace, target, scope, body, country=country
                    )

                request = {
                    "key": uuid4(),
                    "fixture": "orchard",
                    "action": "pipeline",
                    "consent": True,
                }
                assert call("copilot", "copilot:read", country="GB").status_code == 403
                assert (
                    call("copilot-ask", "copilot:ask", {**request, "consent": False}).status_code
                    == 422
                )
                assert (
                    call(
                        "copilot-ask", "copilot:ask", {**request, "prompt": "private data"}
                    ).status_code
                    == 422
                )
                result = call("copilot-ask", "copilot:ask", request)
                assert result.status_code == 200, result.text
                message = result.json()["data"]
                assert message["response"] == answer
                assert call("copilot-ask", "copilot:ask", request).json()["data"] == message
                assert calls == [("orchard", "pipeline")]
                history = call("copilot", "copilot:read").json()["data"]
                assert history["messages"][0]["response"] == answer
                assert call(
                    "copilot-delete", "copilot:delete", {"id": message["conversation_id"]}
                ).json()["data"]["deleted"]
                assert call("copilot", "copilot:read").json()["data"]["messages"] == []
                owner.execute(
                    "UPDATE copilot_reviewers SET revoked_at=now() WHERE workspace_id=%s AND user_id=%s",
                    (workspace, actor),
                )
                assert call("copilot", "copilot:read").status_code == 403
        finally:
            owner.execute('DELETE FROM "user" WHERE id=%s', (actor,))

from datetime import date
from uuid import UUID

from psycopg import Error as DatabaseError
from psycopg.types.json import Jsonb

from clorix.mutations import audit, require_owner, require_version
from clorix.sales import snapshot
from clorix.security import ServiceError
from clorix.workflow_inputs import Preferences, ReadNotification, Workflow

PREFIXES = {
    "lead": "leads",
    "deal": "deals",
    "task": "tasks",
    "customer": "companies",
    "renewal": "companies",
    "support": "support",
    "quotation": "billing",
    "invoice": "billing",
}
NUMERIC = {"score", "health", "days", "amount_minor"}
TRIGGER_FIELDS = {
    "leads": {"source", "owner_member_id", "priority"},
    "deals": {"amount_minor", "stage", "owner_member_id"},
    "tasks": {"priority", "owner_member_id"},
    "companies": {"health", "days"},
    "support": {"priority", "ticket_status", "owner_member_id"},
    "billing": {"invoice_status", "amount_minor", "days"},
}
CATEGORIES = ["assignment", "deadline", "risk", "lead", "renewal", "workflow", "support", "billing"]


def _kind(trigger_type: str) -> str:
    return PREFIXES[trigger_type.split("_")[0]]


def matches(facts: dict, conditions: list[dict]) -> bool:
    for condition in conditions:
        key, op, target = (condition[part] for part in ("field", "compare", "value"))
        current = facts.get(key)
        if current is None:
            return False
        if key in NUMERIC:
            try:
                left, right = int(current), int(target)
            except (ValueError, TypeError):
                return False
        else:
            left, right = str(current).casefold(), target.casefold()
        if not {"equals": left == right, "at_least": left >= right, "at_most": left <= right}[op]:
            return False
    return True


def get_workflow(conn, tenant, workflow_id):
    item = conn.execute(
        "SELECT * FROM automation_workflows WHERE workspace_id=%s AND id=%s",
        (tenant.id, workflow_id),
    ).fetchone()
    if not item:
        raise ServiceError(404, "workflow", "The workflow is unavailable.")
    return item


def list_workflows(conn, tenant):
    definitions = conn.execute(
        """
        SELECT * FROM automation_workflows WHERE workspace_id=%s ORDER BY updated_at DESC,id
        """,
        (tenant.id,),
    ).fetchall()
    runs = conn.execute(
        """
        SELECT r.id,r.workflow_id,w.name,r.status,r.attempts,r.detail,r.updated_at,e.trigger_type
        FROM automation_runs r JOIN automation_workflows w ON w.id=r.workflow_id AND w.workspace_id=r.workspace_id
        JOIN automation_events e ON e.id=r.event_id AND e.workspace_id=r.workspace_id
        WHERE r.workspace_id=%s ORDER BY r.updated_at DESC,r.id LIMIT 60
        """,
        (tenant.id,),
    ).fetchall()
    totals = conn.execute(
        "SELECT status,count(*) FROM automation_runs WHERE workspace_id=%s GROUP BY status",
        (tenant.id,),
    ).fetchall()
    pending = conn.execute(
        "SELECT count(*) AS count FROM automation_events WHERE workspace_id=%s AND processed_at IS NULL",
        (tenant.id,),
    ).fetchone()["count"]
    return {
        "role": tenant.role,
        "workflows": definitions,
        "runs": runs,
        "totals": totals,
        "pending": pending,
    }


def save_workflow(conn, tenant, spec: Workflow):
    require_owner(tenant)
    entity = _kind(spec.trigger_type)
    permitted = TRIGGER_FIELDS[entity] | (
        {"score"} if spec.trigger_type == "lead_high_score" else set()
    )
    for condition in spec.conditions:
        if condition.field not in permitted:
            raise ServiceError(
                422, "workflow_condition", "That condition is unavailable for this trigger."
            )
        if condition.field in NUMERIC:
            if (
                not condition.value.isascii()
                or not condition.value.isdigit()
                or len(condition.value) > 13
            ):
                raise ServiceError(
                    422, "workflow_condition", "Numeric conditions use whole numbers."
                )
        elif condition.compare != "equals":
            raise ServiceError(422, "workflow_condition", "Text and ID conditions use equality.")
    for action in spec.actions:
        if action.action.startswith("lead_") and entity != "leads":
            raise ServiceError(422, "workflow_action", "Lead actions require a lead trigger.")
        if action.action == "lead_priority" and action.value not in {"low", "normal", "high"}:
            raise ServiceError(422, "workflow_action", "Choose low, normal or high priority.")
        if action.action == "lead_tag":
            if len(action.value) > 32 or not all(
                char.isalnum() or char in " _-" for char in action.value
            ):
                raise ServiceError(
                    422, "workflow_action", "Enter a short tag using letters or numbers."
                )
        if action.action == "assign":
            if entity not in {"leads", "deals"}:
                raise ServiceError(
                    422, "workflow_action", "Assignment requires a lead or deal trigger."
                )
            try:
                assignee = UUID(action.value)
            except ValueError:
                raise ServiceError(
                    422, "workflow_action", "Choose an active member for assignment."
                ) from None
            _member(conn, tenant, assignee)
    values = (
        spec.name,
        spec.trigger_type,
        spec.enabled,
        Jsonb([v.model_dump() for v in spec.conditions]),
        Jsonb([v.model_dump() for v in spec.actions]),
    )
    if spec.workflow_id:
        require_version(get_workflow(conn, tenant, spec.workflow_id)["version"], spec.version)
        item = conn.execute(
            """
            UPDATE automation_workflows SET name=%s,trigger_type=%s,enabled=%s,conditions=%s,actions=%s,
              version=version+1,updated_at=now() WHERE workspace_id=%s AND id=%s RETURNING *
            """,
            (*values, tenant.id, spec.workflow_id),
        ).fetchone()
    else:
        require_version(0, spec.version)
        if len(
            conn.execute(
                "SELECT id FROM automation_workflows WHERE workspace_id=%s LIMIT 30", (tenant.id,)
            ).fetchall()
        ) >= (8 if tenant.kind == "sandbox" else 30):
            raise ServiceError(
                429, "workflow_limit", "This workspace has reached its workflow limit."
            )
        item = conn.execute(
            """
            INSERT INTO automation_workflows(workspace_id,name,trigger_type,enabled,conditions,actions)
            VALUES(%s,%s,%s,%s,%s,%s) RETURNING *
            """,
            (tenant.id, *values),
        ).fetchone()
    audit(conn, tenant, "save_workflow", "automation_workflows", item["id"])
    return item


def _member(conn, tenant, member_id):
    if not conn.execute(
        "SELECT 1 FROM memberships WHERE workspace_id=%s AND id=%s AND status='active'",
        (tenant.id, member_id),
    ).fetchone():
        raise ServiceError(422, "assignee", "The assignee is unavailable.")


def _record_facts(conn, tenant, entity, record_id):
    selects = {
        "leads": """
            SELECT l.source,l.owner_member_id,coalesce(p.priority,'normal') AS priority
            FROM leads l LEFT JOIN lead_profiles p ON p.workspace_id=l.workspace_id AND p.lead_id=l.id
            WHERE l.workspace_id=%s AND l.id=%s AND l.archived_at IS NULL
            """,
        "deals": """
            SELECT d.amount_minor,s.name AS stage,d.owner_member_id FROM deals d
            JOIN pipeline_stages s ON s.workspace_id=d.workspace_id AND s.id=d.stage_id
            WHERE d.workspace_id=%s AND d.id=%s AND d.archived_at IS NULL
            """,
        "tasks": "SELECT priority,owner_member_id FROM tasks WHERE workspace_id=%s AND id=%s AND archived_at IS NULL",
        "companies": "SELECT id FROM companies WHERE workspace_id=%s AND id=%s AND archived_at IS NULL",
        "support": "SELECT priority,status AS ticket_status,assignee_id AS owner_member_id,company_id FROM support_tickets WHERE workspace_id=%s AND id=%s",
        "billing": "SELECT status AS invoice_status,total_minor AS amount_minor,company_id FROM billing_documents WHERE workspace_id=%s AND id=%s",
    }
    return conn.execute(selects[entity], (tenant.id, record_id)).fetchone()


def _check_capacity(conn, tenant):
    if tenant.kind != "sandbox":
        return
    count = conn.execute(
        """
        SELECT (SELECT count(*) FROM leads WHERE workspace_id=%s) +
          (SELECT count(*) FROM contacts WHERE workspace_id=%s) +
          (SELECT count(*) FROM companies WHERE workspace_id=%s) +
          (SELECT count(*) FROM deals WHERE workspace_id=%s) +
          (SELECT count(*) FROM tasks WHERE workspace_id=%s) +
          (SELECT count(*) FROM activities WHERE workspace_id=%s) AS count
        """,
        (tenant.id,) * 6,
    ).fetchone()["count"]
    cap = conn.execute("SELECT clorix_access.record_limit() AS cap").fetchone()["cap"]
    if count >= cap:
        raise ServiceError(429, "record_limit", "The sandbox record quota is full.")


def _notify(conn, tenant, recipient, category, title, entity, record_id, key):
    conn.execute(
        """
        INSERT INTO in_app_notifications(workspace_id,recipient_id,category,title,entity_type,entity_id,dedupe_key)
        SELECT %s,%s,%s,%s,%s,%s,%s
        WHERE coalesce((SELECT %s=ANY(categories) FROM notification_preferences
          WHERE workspace_id=%s AND recipient_id=%s),true)
        AND (SELECT count(*) FROM in_app_notifications WHERE workspace_id=%s AND recipient_id=%s)<350
        ON CONFLICT(workspace_id,recipient_id,dedupe_key) DO NOTHING
        """,
        (
            tenant.id,
            recipient,
            category,
            title,
            entity,
            record_id,
            key,
            category,
            tenant.id,
            recipient,
            tenant.id,
            recipient,
        ),
    )


def _actions(conn, tenant, workflow, event, facts):
    entity, record = event["entity_type"], event["entity_id"]
    owner = facts.get("owner_member_id") or tenant.member_id
    if isinstance(owner, str):
        owner = UUID(owner)
    # Historical owners can have been removed before the batch is evaluated.
    if not conn.execute(
        "SELECT 1 FROM memberships WHERE workspace_id=%s AND id=%s AND status='active'",
        (tenant.id, owner),
    ).fetchone():
        owner = tenant.member_id
    for index, item in enumerate(workflow["actions"]):
        action, value = item["action"], item["value"]
        if action in {"task", "activity"}:
            _check_capacity(conn, tenant)
            refs = [
                record if entity == target else None
                for target in ("leads", "contacts", "companies", "deals")
            ]
            if entity in {"support", "billing"}:
                refs[2] = facts["company_id"]
            if action == "task":
                conn.execute(
                    """
                    INSERT INTO tasks(workspace_id,title,owner_member_id,due_at,lead_id,contact_id,company_id,deal_id)
                    VALUES(%s,%s,%s,now()+interval '1 day',%s,%s,%s,%s)
                    """,
                    (tenant.id, value, owner, *refs),
                )
            else:
                conn.execute(
                    """
                    INSERT INTO activities(workspace_id,kind,summary,actor_member_id,lead_id,contact_id,company_id,deal_id,task_id)
                    VALUES(%s,'note',%s,%s,%s,%s,%s,%s,%s)
                    """,
                    (
                        tenant.id,
                        value,
                        tenant.member_id,
                        *refs,
                        record if entity == "tasks" else None,
                    ),
                )
        elif action == "notification":
            _notify(
                conn,
                tenant,
                owner,
                "workflow",
                value,
                entity,
                record,
                f"{workflow['id']}:{event['id']}:{index}",
            )
        elif action == "assign":
            recipient = UUID(value)
            _member(conn, tenant, recipient)
            conn.execute(
                f"UPDATE {entity} SET owner_member_id=%s,updated_at=now(),version=version+1 WHERE workspace_id=%s AND id=%s",
                (recipient, tenant.id, record),
            )
            _notify(
                conn,
                tenant,
                recipient,
                "assignment",
                "A workflow assigned you a record.",
                entity,
                record,
                f"assign:{workflow['id']}:{event['id']}:{index}",
            )
        elif action == "lead_priority":
            conn.execute(
                """
                INSERT INTO lead_profiles(workspace_id,lead_id,priority) VALUES(%s,%s,%s)
                ON CONFLICT(workspace_id,lead_id) DO UPDATE SET priority=excluded.priority,version=lead_profiles.version+1
                """,
                (tenant.id, record, value),
            )
        elif action == "lead_tag":
            prior = conn.execute(
                "SELECT tags FROM lead_profiles WHERE workspace_id=%s AND lead_id=%s",
                (tenant.id, record),
            ).fetchone()
            tags = sorted(set((prior["tags"] if prior else []) + [value.lower()]))
            if len(tags) > 12:
                raise ServiceError(409, "tag_limit", "The lead has reached its tag limit.")
            conn.execute(
                """
                INSERT INTO lead_profiles(workspace_id,lead_id,tags) VALUES(%s,%s,%s)
                ON CONFLICT(workspace_id,lead_id) DO UPDATE SET tags=excluded.tags,version=lead_profiles.version+1
                """,
                (tenant.id, record, tags),
            )


def _execute(conn, tenant, workflow, event):
    facts = _record_facts(conn, tenant, event["entity_type"], event["entity_id"])
    if facts is None:
        return "skipped", "The record is unavailable."
    facts |= event["facts"]
    if not matches(facts, workflow["conditions"]):
        return "skipped", "Conditions did not match."
    try:
        with conn.transaction():
            conn.execute("SELECT set_config('clorix.automation','1',true)")
            _actions(conn, tenant, workflow, event, facts)
        return "completed", f"{len(workflow['actions'])} action(s) completed."
    except ServiceError as error:
        return "failed", error.message
    except DatabaseError:
        return (
            "failed",
            "An action conflicted with the current record. Review the workflow before retrying.",
        )


def _enqueue(conn, tenant, trigger, entity, record, key, facts):
    conn.execute(
        """
        INSERT INTO automation_events(workspace_id,trigger_type,entity_type,entity_id,event_key,facts)
        VALUES(%s,%s,%s,%s,%s,%s) ON CONFLICT(workspace_id,event_key) DO NOTHING
        """,
        (tenant.id, trigger, entity, record, key, Jsonb(facts)),
    )


def evaluate(conn, tenant):
    require_owner(tenant)
    groups = {}
    for workflow in conn.execute(
        "SELECT * FROM automation_workflows WHERE workspace_id=%s AND enabled ORDER BY created_at,id",
        (tenant.id,),
    ).fetchall():
        groups.setdefault(workflow["trigger_type"], []).append(workflow)
    conn.execute(
        """
        DELETE FROM automation_events WHERE workspace_id=%s AND processed_at<now()-interval '30 days'
        """,
        (tenant.id,),
    )
    conn.execute(
        """
        DELETE FROM in_app_notifications WHERE workspace_id=%s AND created_at<now()-interval '30 days'
        """,
        (tenant.id,),
    )
    if "task_overdue" in groups:
        for task in conn.execute(
            """
            SELECT t.id,t.version,t.priority,t.owner_member_id FROM tasks t
            WHERE t.workspace_id=%s AND t.archived_at IS NULL AND t.status='open' AND t.due_at<now()
              AND NOT EXISTS (SELECT 1 FROM automation_events e WHERE e.workspace_id=t.workspace_id
                AND e.event_key='task_overdue:'||t.id||':'||t.version)
            ORDER BY due_at,id LIMIT 20
            """,
            (tenant.id,),
        ).fetchall():
            _enqueue(
                conn,
                tenant,
                "task_overdue",
                "tasks",
                task["id"],
                f"task_overdue:{task['id']}:{task['version']}",
                {
                    "priority": task["priority"],
                    "owner_member_id": str(task["owner_member_id"])
                    if task["owner_member_id"]
                    else None,
                },
            )
    for task in conn.execute(
        """
        SELECT id,version,owner_member_id,due_at<now() AS overdue FROM tasks
        WHERE workspace_id=%s AND archived_at IS NULL AND status='open' AND due_at<now()+interval '3 days'
        ORDER BY due_at,id LIMIT 30
        """,
        (tenant.id,),
    ).fetchall():
        _notify(
            conn,
            tenant,
            task["owner_member_id"] or tenant.member_id,
            "deadline",
            "A task is overdue." if task["overdue"] else "A task is due soon.",
            "tasks",
            task["id"],
            f"deadline:{task['id']}:{task['version']}:{int(task['overdue'])}",
        )
    intelligence = snapshot(conn, tenant)
    today = intelligence["generated_for"]
    _intelligence_events(conn, tenant, groups, intelligence, today)
    _invoice_events(conn, tenant, groups, today)
    outcomes = {"completed": 0, "failed": 0, "skipped": 0}
    selection = conn.execute(
        """
        SELECT * FROM automation_events WHERE workspace_id=%s AND processed_at IS NULL
        ORDER BY created_at,id LIMIT 10
        """,
        (tenant.id,),
    ).fetchall()
    for event in selection:
        for workflow in groups.get(event["trigger_type"], [])[:8]:
            status, detail = _execute(conn, tenant, workflow, event)
            conn.execute(
                """
                INSERT INTO automation_runs(workspace_id,workflow_id,event_id,status,detail)
                VALUES(%s,%s,%s,%s,%s) ON CONFLICT(workspace_id,workflow_id,event_id) DO NOTHING
                """,
                (tenant.id, workflow["id"], event["id"], status, detail),
            )
            outcomes[status] += 1
        conn.execute(
            "UPDATE automation_events SET processed_at=now() WHERE workspace_id=%s AND id=%s",
            (tenant.id, event["id"]),
        )
    audit(conn, tenant, "evaluate_workflows", "automation", None)
    return {"events": len(selection), **outcomes}


def _invoice_events(conn, tenant, groups, today):
    records = conn.execute(
        """
        SELECT d.id,d.due_on,d.total_minor-paid.amount AS balance
        FROM billing_documents d
        CROSS JOIN LATERAL (SELECT coalesce(sum(p.amount_minor),0)::bigint AS amount
          FROM recorded_payments p WHERE p.workspace_id=d.workspace_id AND p.invoice_id=d.id) paid
        WHERE d.workspace_id=%s AND d.kind='invoice' AND d.status='issued'
          AND d.total_minor>paid.amount AND d.due_on<=%s::date+7
        ORDER BY d.due_on,d.id LIMIT 25
        """,
        (tenant.id, today),
    ).fetchall()
    for invoice in records:
        days = (invoice["due_on"] - today).days
        key = f"invoice-due:{invoice['id']}:{invoice['due_on']}:{int(days < 0)}"
        title = "An invoice balance is overdue." if days < 0 else "An invoice balance is due soon."
        _notify(conn, tenant, tenant.member_id, "billing", title, "billing", invoice["id"], key)
        if "invoice_due" in groups:
            _enqueue(
                conn,
                tenant,
                "invoice_due",
                "billing",
                invoice["id"],
                key,
                {
                    "days": max(days, 0),
                    "invoice_status": "overdue" if days < 0 else "unpaid",
                    "amount_minor": invoice["balance"],
                },
            )


def _intelligence_events(conn, tenant, groups, intelligence, today: date):
    week = f"{today.isocalendar().year}-{today.isocalendar().week}"
    for lead in [item for item in intelligence["leads"] if item["classification"] == "hot"][:15]:
        key = f"hot:{lead['id']}:{week}"
        _notify(
            conn,
            tenant,
            tenant.member_id,
            "lead",
            "A lead reached a hot score.",
            "leads",
            lead["id"],
            key,
        )
        if "lead_high_score" in groups:
            _enqueue(
                conn, tenant, "lead_high_score", "leads", lead["id"], key, {"score": lead["score"]}
            )
    for deal in [item for item in intelligence["risks"] if item["classification"] == "high"][:15]:
        _notify(
            conn,
            tenant,
            tenant.member_id,
            "risk",
            "An open deal needs attention.",
            "deals",
            deal["id"],
            f"risk:{deal['id']}:{week}",
        )
    for company in intelligence["customers"][:30]:
        remaining = company["renewal_days"]
        if remaining is not None and 0 <= remaining <= 30:
            key = f"renewal:{company['id']}:{company['renewal_date']}"
            _notify(
                conn,
                tenant,
                tenant.member_id,
                "renewal",
                "A customer renewal is approaching.",
                "companies",
                company["id"],
                key,
            )
            if "renewal_approaching" in groups:
                _enqueue(
                    conn,
                    tenant,
                    "renewal_approaching",
                    "companies",
                    company["id"],
                    key,
                    {"days": remaining, "health": company["score"]},
                )
        days = company["inactivity_days"]
        if (
            "customer_inactive" in groups
            and company["lifecycle"] in {"active", "renewal"}
            and (days is None or days >= 30)
        ):
            _enqueue(
                conn,
                tenant,
                "customer_inactive",
                "companies",
                company["id"],
                f"inactive:{company['id']}:{week}",
                {"days": days, "health": company["score"]},
            )


def retry(conn, tenant, run_id):
    require_owner(tenant)
    run = conn.execute(
        "SELECT * FROM automation_runs WHERE workspace_id=%s AND id=%s", (tenant.id, run_id)
    ).fetchone()
    if not run or run["status"] != "failed" or run["attempts"] >= 3:
        raise ServiceError(409, "workflow_retry", "This run cannot be retried.")
    workflow = get_workflow(conn, tenant, run["workflow_id"])
    if not workflow["enabled"]:
        raise ServiceError(409, "workflow_retry", "Activate the workflow before retrying.")
    event = conn.execute(
        "SELECT * FROM automation_events WHERE workspace_id=%s AND id=%s",
        (tenant.id, run["event_id"]),
    ).fetchone()
    if workflow["trigger_type"] != event["trigger_type"]:
        raise ServiceError(409, "workflow_retry", "The workflow trigger changed after this run.")
    status, detail = _execute(conn, tenant, workflow, event)
    conn.execute(
        """
        UPDATE automation_runs SET attempts=attempts+1,status=%s,detail=%s,updated_at=now()
        WHERE workspace_id=%s AND id=%s
        """,
        (status, detail, tenant.id, run_id),
    )
    audit(conn, tenant, "retry_workflow", "automation_runs", run_id)
    return {"status": status, "detail": detail}


def test_workflow(conn, tenant, workflow_id, entity_id):
    workflow = get_workflow(conn, tenant, workflow_id)
    entity = _kind(workflow["trigger_type"])
    facts = _record_facts(conn, tenant, entity, entity_id)
    if facts is None:
        raise ServiceError(404, "record", "Choose a matching active record.")
    if any(item["field"] in {"score", "health", "days"} for item in workflow["conditions"]):
        data = snapshot(conn, tenant)
        collection = (
            data["leads"]
            if entity == "leads"
            else data["customers"]
            if entity == "companies"
            else []
        )
        item = next((row for row in collection if row["id"] == entity_id), None)
        if item:
            facts |= {
                "score": item["score"],
                "health": item["score"],
                "days": item.get("renewal_days"),
            }
    matched = matches(facts, workflow["conditions"])
    return {"matches": matched, "actions": workflow["actions"] if matched else []}


def notifications(conn, tenant):
    items = conn.execute(
        """
        SELECT id,category,title,entity_type,entity_id,created_at,read_at
        FROM in_app_notifications WHERE workspace_id=%s AND recipient_id=%s ORDER BY created_at DESC,id LIMIT 80
        """,
        (tenant.id, tenant.member_id),
    ).fetchall()
    unread = conn.execute(
        "SELECT count(*) AS count FROM in_app_notifications WHERE workspace_id=%s AND recipient_id=%s AND read_at IS NULL",
        (tenant.id, tenant.member_id),
    ).fetchone()["count"]
    prefs = conn.execute(
        "SELECT categories,version FROM notification_preferences WHERE workspace_id=%s AND recipient_id=%s",
        (tenant.id, tenant.member_id),
    ).fetchone()
    return {
        "items": items,
        "unread": unread,
        "preferences": prefs or {"categories": CATEGORIES, "version": 0},
    }


def update_read(conn, tenant, spec: ReadNotification):
    if spec.unread and not spec.notification_id:
        raise ServiceError(422, "notification", "Choose a notification to mark unread.")
    result = conn.execute(
        """
        UPDATE in_app_notifications SET read_at=CASE WHEN %s THEN null ELSE coalesce(read_at,now()) END
        WHERE workspace_id=%s AND recipient_id=%s AND (%s::uuid IS NULL OR id=%s)
        """,
        (spec.unread, tenant.id, tenant.member_id, spec.notification_id, spec.notification_id),
    )
    if spec.notification_id and not result.rowcount:
        raise ServiceError(404, "notification", "The notification is unavailable.")
    return {"updated": result.rowcount}


def preferences(conn, tenant, spec: Preferences):
    require_version(notifications(conn, tenant)["preferences"]["version"], spec.version)
    return conn.execute(
        """
        INSERT INTO notification_preferences(workspace_id,recipient_id,categories) VALUES(%s,%s,%s)
        ON CONFLICT(workspace_id,recipient_id) DO UPDATE SET categories=excluded.categories,
          version=notification_preferences.version+1 RETURNING categories,version
        """,
        (tenant.id, tenant.member_id, sorted(set(spec.categories))),
    ).fetchone()

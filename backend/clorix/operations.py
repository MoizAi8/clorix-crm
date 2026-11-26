from datetime import timedelta

from clorix.billing import linked_company, local_today
from clorix.intelligence import rounded_ratio
from clorix.mutations import audit, require_owner, require_version
from clorix.operations_inputs import (
    CalendarEvent,
    CalendarRequest,
    MemberTarget,
    SupportTicket,
    TicketNote,
)
from clorix.sales import add_months
from clorix.security import ServiceError
from clorix.workflows import _enqueue, _member, _notify


def ticket_row(conn, tenant, identifier):
    found = conn.execute(
        """
        SELECT t.*,c.name AS company_name FROM support_tickets t
        JOIN companies c ON c.workspace_id=t.workspace_id AND c.id=t.company_id
        WHERE t.workspace_id=%s AND t.id=%s
        """,
        (tenant.id, identifier),
    ).fetchone()
    if not found:
        raise ServiceError(404, "ticket", "This support ticket is unavailable.")
    return found


def support_overview(conn, tenant):
    rows = conn.execute(
        """
        SELECT t.id,t.serial,t.subject,t.status,t.priority,t.category,t.assignee_id,t.updated_at,c.name AS company_name
        FROM support_tickets t JOIN companies c ON c.workspace_id=t.workspace_id AND c.id=t.company_id
        WHERE t.workspace_id=%s ORDER BY t.updated_at DESC,t.id LIMIT 250
        """,
        (tenant.id,),
    ).fetchall()
    metrics = conn.execute(
        """
        SELECT count(*) FILTER(WHERE status IN ('open','in_progress')) AS open,
          count(*) FILTER(WHERE status IN ('resolved','closed')) AS resolved,
          round(avg(EXTRACT(EPOCH FROM first_response_at-created_at)/60))::int AS response_minutes,
          round(avg(EXTRACT(EPOCH FROM resolved_at-created_at)/60))::int AS resolution_minutes
        FROM support_tickets WHERE workspace_id=%s
        """,
        (tenant.id,),
    ).fetchone()
    return {"tickets": rows, "metrics": metrics}


def ticket_detail(conn, tenant, identifier):
    record = ticket_row(conn, tenant, identifier)
    rows = conn.execute(
        """
        SELECT h.id,h.action,h.body,h.created_at,t.display_name AS actor
        FROM support_history h LEFT JOIN clorix_access.team_directory() t ON t.member_id=h.actor_member_id
        WHERE h.workspace_id=%s AND h.ticket_id=%s ORDER BY h.created_at DESC,h.id LIMIT 100
        """,
        (tenant.id, identifier),
    ).fetchall()
    return {"ticket": record, "history": rows}


def _ticket_history(conn, tenant, identifier, action, body):
    conn.execute(
        """
        INSERT INTO support_history(workspace_id,ticket_id,actor_member_id,action,body)
        VALUES(%s,%s,%s,%s,%s)
        """,
        (tenant.id, identifier, tenant.member_id, action, body),
    )
    audit(conn, tenant, action, "support_tickets", identifier)


def _ticket_notice(conn, tenant, record, recipient, title):
    if recipient:
        _notify(
            conn,
            tenant,
            recipient,
            "support",
            title,
            "support",
            record["id"],
            f"support:{record['id']}:{record['version']}",
        )


def save_ticket(conn, tenant, spec: SupportTicket):
    linked_company(conn, tenant, spec.company_id, spec.contact_id, None)
    if spec.assignee_id:
        _member(conn, tenant, spec.assignee_id)
    data = (
        spec.company_id,
        spec.contact_id,
        spec.assignee_id,
        spec.subject,
        spec.description,
        spec.category,
        spec.priority,
    )
    if not spec.id:
        require_version(0, spec.version)
        if spec.status != "open":
            raise ServiceError(422, "ticket_state", "New tickets open in the Open state.")
        size = conn.execute(
            "SELECT count(*) AS n,coalesce(max(serial),0)+1 AS serial FROM support_tickets WHERE workspace_id=%s",
            (tenant.id,),
        ).fetchone()
        if size["n"] >= (50 if tenant.kind == "sandbox" else 2500):
            raise ServiceError(429, "ticket_limit", "This workspace has reached its ticket limit.")
        found = conn.execute(
            """
            INSERT INTO support_tickets(workspace_id,company_id,contact_id,assignee_id,subject,description,category,priority,serial)
            VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id,version
            """,
            (tenant.id, *data, size["serial"]),
        ).fetchone()
        _ticket_history(conn, tenant, found["id"], "created", "Ticket opened.")
        _ticket_notice(
            conn, tenant, found, spec.assignee_id, "You have a new assigned support ticket."
        )
        if conn.execute(
            "SELECT 1 FROM automation_workflows WHERE workspace_id=%s AND trigger_type='support_created' AND enabled LIMIT 1",
            (tenant.id,),
        ).fetchone():
            _enqueue(
                conn,
                tenant,
                "support_created",
                "support",
                found["id"],
                f"support-created:{found['id']}",
                {"priority": spec.priority, "ticket_status": "open"},
            )
        return found
    previous = ticket_row(conn, tenant, spec.id)
    require_version(previous["version"], spec.version)
    path = {
        "open": {"in_progress", "resolved"},
        "in_progress": {"open", "resolved"},
        "resolved": {"closed", "open"},
        "closed": {"open"},
    }
    if spec.status != previous["status"] and spec.status not in path[previous["status"]]:
        raise ServiceError(409, "ticket_state", "Resolve an active ticket before closing it.")
    if spec.status in {"resolved", "closed"} and not spec.resolution:
        raise ServiceError(422, "resolution", "Add a resolution note before resolving this ticket.")
    item = conn.execute(
        """
        UPDATE support_tickets SET company_id=%s,contact_id=%s,assignee_id=%s,subject=%s,description=%s,
          category=%s,priority=%s,status=%s,resolution=%s,
          first_response_at=CASE WHEN %s<>'open' THEN coalesce(first_response_at,now()) ELSE first_response_at END,
          resolved_at=CASE WHEN %s IN ('resolved','closed') THEN coalesce(resolved_at,now()) ELSE NULL END,
          version=version+1,updated_at=now() WHERE workspace_id=%s AND id=%s RETURNING id,version
        """,
        (*data, spec.status, spec.resolution, spec.status, spec.status, tenant.id, spec.id),
    ).fetchone()
    if spec.status != previous["status"]:
        _ticket_history(
            conn,
            tenant,
            item["id"],
            "status_changed",
            "Status changed from "
            + previous["status"].replace("_", " ")
            + " to "
            + spec.status.replace("_", " ")
            + ".",
        )
    elif spec.assignee_id != previous["assignee_id"]:
        _ticket_history(conn, tenant, item["id"], "assignment", "Ticket assignment changed.")
    else:
        _ticket_history(conn, tenant, item["id"], "updated", "Ticket details updated.")
    _ticket_notice(conn, tenant, item, spec.assignee_id, "An assigned support ticket was updated.")
    return item


def add_ticket_note(conn, tenant, spec: TicketNote):
    previous = ticket_row(conn, tenant, spec.id)
    require_version(previous["version"], spec.version)
    count = conn.execute(
        "SELECT count(*) AS n FROM support_history WHERE workspace_id=%s AND ticket_id=%s",
        (tenant.id, spec.id),
    ).fetchone()["n"]
    if count >= 200:
        raise ServiceError(429, "ticket_history", "This ticket has reached its history limit.")
    _ticket_history(conn, tenant, spec.id, "internal_note", spec.body)
    item = conn.execute(
        """
        UPDATE support_tickets SET first_response_at=coalesce(first_response_at,now()),
          version=version+1,updated_at=now() WHERE workspace_id=%s AND id=%s RETURNING id,version
        """,
        (tenant.id, spec.id),
    ).fetchone()
    return item


def calendar_bounds(anchor, mode):
    if mode == "month":
        first = anchor.replace(day=1)
        return first, add_months(first, 1)
    if mode == "week":
        first = anchor - timedelta(days=anchor.weekday())
        return first, first + timedelta(days=7)
    return anchor, anchor + timedelta(days=30)


def calendar(conn, tenant, spec: CalendarRequest):
    today = local_today(tenant)
    anchor = spec.date or today
    first, end = calendar_bounds(anchor, spec.mode)
    events = conn.execute(
        """
        WITH bounds AS (SELECT %s::date AS first,%s::date AS last,%s::text AS zone), records AS (
            SELECT e.id,e.title,e.kind,e.starts_at,e.ends_at,e.assignee_id AS owner_id,e.company_id,
                e.lead_id,e.deal_id,e.description,e.version,e.cancelled,'calendar' AS entity,
                (e.starts_at AT TIME ZONE b.zone)::date AS day
            FROM calendar_events e,bounds b WHERE e.workspace_id=%s AND NOT e.cancelled
              AND e.starts_at<b.last::timestamp AT TIME ZONE b.zone AND e.ends_at>b.first::timestamp AT TIME ZONE b.zone
            UNION ALL SELECT t.id,t.title,'task',t.due_at,NULL,t.owner_member_id,t.company_id,t.lead_id,t.deal_id,
                t.status,t.version,false,'tasks',(t.due_at AT TIME ZONE b.zone)::date
            FROM tasks t,bounds b WHERE t.workspace_id=%s AND t.archived_at IS NULL
              AND t.due_at>=b.first::timestamp AT TIME ZONE b.zone AND t.due_at<b.last::timestamp AT TIME ZONE b.zone
            UNION ALL SELECT d.id,d.title,'deal',NULL,NULL,d.owner_member_id,d.company_id,d.lead_id,d.id,
                s.name,d.version,false,'deals',d.expected_close_date
            FROM deals d JOIN pipeline_stages s ON s.workspace_id=d.workspace_id AND s.id=d.stage_id,bounds b
            WHERE d.workspace_id=%s AND d.archived_at IS NULL AND s.kind='open'
              AND d.expected_close_date>=b.first AND d.expected_close_date<b.last
            UNION ALL SELECT c.id,'Renewal · '||c.name,'renewal',NULL,NULL,NULL,c.id,NULL,NULL,
                p.lifecycle,p.version,false,'companies',p.renewal_date
            FROM customer_profiles p JOIN companies c ON c.workspace_id=p.workspace_id AND c.id=p.company_id,bounds b
            WHERE p.workspace_id=%s AND c.archived_at IS NULL AND p.renewal_date>=b.first AND p.renewal_date<b.last
        ) SELECT * FROM records WHERE (%s::text IS NULL OR kind=%s)
          ORDER BY day,starts_at NULLS FIRST,id LIMIT 251
        """,
        (
            first,
            end,
            tenant.timezone,
            tenant.id,
            tenant.id,
            tenant.id,
            tenant.id,
            spec.kind,
            spec.kind,
        ),
    ).fetchall()
    return {
        "first": first,
        "end": end,
        "today": today,
        "anchor": anchor,
        "zone": tenant.timezone,
        "events": events[:250],
        "limited": len(events) > 250,
    }


def save_event(conn, tenant, spec: CalendarEvent):
    _member(conn, tenant, spec.assignee_id)
    if not timedelta(0) < spec.ends_at - spec.starts_at <= timedelta(days=1):
        raise ServiceError(
            422, "calendar_time", "The event must last between one second and 24 hours."
        )
    for field, table in (("company_id", "companies"), ("lead_id", "leads"), ("deal_id", "deals")):
        identifier = getattr(spec, field)
        if (
            identifier
            and not conn.execute(
                f"SELECT 1 FROM {table} WHERE workspace_id=%s AND id=%s AND archived_at IS NULL",
                (tenant.id, identifier),
            ).fetchone()
        ):
            raise ServiceError(422, "calendar_relation", "Choose an active linked record.")
    data = (
        spec.title,
        spec.kind,
        spec.starts_at,
        spec.ends_at,
        spec.description,
        spec.assignee_id,
        spec.company_id,
        spec.lead_id,
        spec.deal_id,
        spec.cancelled,
    )
    if spec.id:
        old = conn.execute(
            "SELECT version FROM calendar_events WHERE workspace_id=%s AND id=%s",
            (tenant.id, spec.id),
        ).fetchone()
        if not old:
            raise ServiceError(404, "event", "The calendar event is unavailable.")
        require_version(old["version"], spec.version)
        saved = conn.execute(
            """
            UPDATE calendar_events SET title=%s,kind=%s,starts_at=%s,ends_at=%s,description=%s,
              assignee_id=%s,company_id=%s,lead_id=%s,deal_id=%s,cancelled=%s,
              version=version+1,updated_at=now() WHERE workspace_id=%s AND id=%s RETURNING id,version
            """,
            (*data, tenant.id, spec.id),
        ).fetchone()
    else:
        require_version(0, spec.version)
        if conn.execute(
            "SELECT count(*) AS n FROM calendar_events WHERE workspace_id=%s", (tenant.id,)
        ).fetchone()["n"] >= (100 if tenant.kind == "sandbox" else 2000):
            raise ServiceError(429, "calendar_limit", "The workspace has reached its event limit.")
        saved = conn.execute(
            """
            INSERT INTO calendar_events(workspace_id,title,kind,starts_at,ends_at,description,
              assignee_id,company_id,lead_id,deal_id,cancelled)
            VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id,version
            """,
            (tenant.id, *data),
        ).fetchone()
    audit(conn, tenant, "save_event", "calendar_events", saved["id"])
    return saved


def team_performance(conn, tenant):
    month = local_today(tenant).replace(day=1)
    future = add_months(month, 1)
    roster = conn.execute(
        """
        SELECT d.member_id,d.display_name,d.member_role,
          coalesce(o.open_deals,0) AS open_deals,coalesce(o.booked,0)::text AS booked_minor,
          coalesce(o.won,0) AS won,coalesce(o.lost,0) AS lost,
          coalesce(l.leads,0) AS leads,coalesce(l.converted,0) AS converted,
          coalesce(t.open_tasks,0) AS open_tasks,coalesce(t.overdue,0) AS overdue,
          g.amount_minor::text AS target_minor,coalesce(g.version,0) AS target_version
        FROM clorix_access.team_directory() d
        LEFT JOIN LATERAL (
          SELECT count(*) FILTER(WHERE s.kind='open') AS open_deals,
            sum(x.amount_minor) FILTER(WHERE s.kind='won' AND x.actual_closed_at>=%s::date::timestamp AT TIME ZONE %s
              AND x.actual_closed_at<%s::date::timestamp AT TIME ZONE %s) AS booked,
            count(*) FILTER(WHERE s.kind='won' AND x.actual_closed_at>=%s::date::timestamp AT TIME ZONE %s
              AND x.actual_closed_at<%s::date::timestamp AT TIME ZONE %s) AS won,
            count(*) FILTER(WHERE s.kind='lost' AND x.actual_closed_at>=%s::date::timestamp AT TIME ZONE %s
              AND x.actual_closed_at<%s::date::timestamp AT TIME ZONE %s) AS lost
          FROM deals x JOIN pipeline_stages s ON s.workspace_id=x.workspace_id AND s.id=x.stage_id
          WHERE x.workspace_id=%s AND x.owner_member_id=d.member_id AND x.archived_at IS NULL
        ) o ON true
        LEFT JOIN LATERAL (
          SELECT count(*) AS leads,count(*) FILTER(WHERE status='converted') AS converted FROM leads
          WHERE workspace_id=%s AND owner_member_id=d.member_id AND created_at>=%s::date::timestamp AT TIME ZONE %s
        ) l ON true
        LEFT JOIN LATERAL (
          SELECT count(*) AS open_tasks,count(*) FILTER(WHERE due_at<now()) AS overdue FROM tasks
          WHERE workspace_id=%s AND owner_member_id=d.member_id AND status='open' AND archived_at IS NULL
        ) t ON true
        LEFT JOIN member_sales_targets g ON g.workspace_id=%s AND g.member_id=d.member_id AND g.month=%s
        ORDER BY d.display_name,d.member_id LIMIT 100
        """,
        (
            *(month, tenant.timezone, future, tenant.timezone) * 3,
            tenant.id,
            tenant.id,
            month,
            tenant.timezone,
            tenant.id,
            tenant.id,
            month,
        ),
    ).fetchall()
    for row in roster:
        row["achievement"] = (
            rounded_ratio(int(row["booked_minor"]) * 100, int(row["target_minor"]))
            if row["target_minor"]
            else None
        )
    return {"month": month, "currency": tenant.currency, "role": tenant.role, "members": roster}


def save_member_target(conn, tenant, spec: MemberTarget):
    require_owner(tenant)
    _member(conn, tenant, spec.member_id)
    if spec.month.day != 1:
        raise ServiceError(422, "sales_month", "Choose the first day of the month.")
    old = conn.execute(
        "SELECT version FROM member_sales_targets WHERE workspace_id=%s AND month=%s AND member_id=%s",
        (tenant.id, spec.month, spec.member_id),
    ).fetchone()
    require_version(old["version"] if old else 0, spec.version)
    result = conn.execute(
        """
        INSERT INTO member_sales_targets(workspace_id,member_id,month,amount_minor) VALUES(%s,%s,%s,%s)
        ON CONFLICT(workspace_id,member_id,month) DO UPDATE SET amount_minor=excluded.amount_minor,
          version=member_sales_targets.version+1 RETURNING member_id,month,amount_minor::text,version
        """,
        (tenant.id, spec.member_id, spec.month, int(spec.amount_minor)),
    ).fetchone()
    audit(conn, tenant, "set_team_target", "memberships", spec.member_id)
    return result

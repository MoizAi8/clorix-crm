from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from clorix.mutations import require_owner
from clorix.productivity import campaigns
from clorix.productivity_inputs import ReportRequest
from clorix.sales import snapshot
from clorix.security import ServiceError

# SQL fragments are fixed. Only workspace and time bounds are supplied by the caller.
QUERIES = {
    "lead_source": (
        "count",
        """
        SELECT coalesce(nullif(source,''),'Unspecified') AS label,count(*)::text AS value
        FROM leads WHERE workspace_id=%s AND created_at >= %s AND created_at < %s
          AND archived_at IS NULL GROUP BY 1 ORDER BY count(*) DESC,1 LIMIT 100
    """,
    ),
    "deal_stage": (
        "money",
        """
        SELECT s.name||' · '||p.name AS label,sum(d.amount_minor)::text AS value
        FROM deals d JOIN pipeline_stages s ON s.workspace_id=d.workspace_id AND s.id=d.stage_id
        JOIN sales_pipelines p ON p.workspace_id=s.workspace_id AND p.id=s.pipeline_id
        WHERE d.workspace_id=%s AND d.created_at >= %s AND d.created_at < %s
          AND d.archived_at IS NULL GROUP BY 1 ORDER BY sum(d.amount_minor) DESC,1 LIMIT 100
    """,
    ),
    "booked_month": (
        "money",
        """
        SELECT to_char(timezone(%s, d.actual_closed_at),'YYYY-MM') AS label,sum(d.amount_minor)::text AS value
        FROM deals d JOIN pipeline_stages s ON s.workspace_id=d.workspace_id AND s.id=d.stage_id
        WHERE d.workspace_id=%s AND d.actual_closed_at >= %s AND d.actual_closed_at < %s
          AND s.kind='won' AND d.archived_at IS NULL GROUP BY 1 ORDER BY 1
    """,
    ),
    "invoice_status": (
        "money",
        """
        SELECT status AS label,sum(total_minor)::text AS value FROM billing_documents
        WHERE workspace_id=%s AND created_at >= %s AND created_at < %s AND kind='invoice'
        GROUP BY 1 ORDER BY 1
    """,
    ),
    "support_status": (
        "count",
        """
        SELECT status AS label,count(*)::text AS value FROM support_tickets
        WHERE workspace_id=%s AND created_at >= %s AND created_at < %s GROUP BY 1 ORDER BY 1
    """,
    ),
    "workflow_outcome": (
        "count",
        """
        SELECT status AS label,count(*)::text AS value FROM automation_runs
        WHERE workspace_id=%s AND updated_at >= %s AND updated_at < %s GROUP BY 1 ORDER BY 1
    """,
    ),
    "team": (
        "money",
        """
        SELECT coalesce(t.display_name,'Unassigned') AS label,sum(d.amount_minor)::text AS value
        FROM deals d JOIN pipeline_stages s ON s.workspace_id=d.workspace_id AND s.id=d.stage_id
        LEFT JOIN clorix_access.team_directory() t ON t.member_id=d.owner_member_id
        WHERE d.workspace_id=%s AND d.actual_closed_at >= %s AND d.actual_closed_at < %s
          AND s.kind='won' AND d.archived_at IS NULL
        GROUP BY d.owner_member_id,t.display_name ORDER BY sum(d.amount_minor) DESC,1, d.owner_member_id LIMIT 100
    """,
    ),
}


def valid_range(spec: ReportRequest):
    if (
        spec.starts_on < date(2000, 1, 1)
        or spec.ends_on > date(2100, 12, 31)
        or not (0 <= (spec.ends_on - spec.starts_on).days <= 365)
    ):
        raise ServiceError(
            422,
            "report_dates",
            "Choose an ordered date range of up to 366 days between 2000 and 2100.",
        )


def report(conn, tenant, spec: ReportRequest):
    valid_range(spec)
    zone = ZoneInfo(tenant.timezone)
    start = datetime.combine(spec.starts_on, time.min, zone)
    end = datetime.combine(spec.ends_on + timedelta(days=1), time.min, zone)
    dimension = spec.dimension
    if dimension in QUERIES:
        kind, query = QUERIES[dimension]
        bounds = (tenant.id, start, end)
        params = (tenant.timezone, *bounds) if dimension == "booked_month" else bounds
        rows = conn.execute(query, params).fetchall()
    elif dimension == "payment_month":
        kind = "money"
        rows = conn.execute(
            """
            SELECT to_char(received_on,'YYYY-MM') AS label,sum(amount_minor)::text AS value
            FROM recorded_payments WHERE workspace_id=%s AND received_on BETWEEN %s AND %s GROUP BY 1 ORDER BY 1
            """,
            (tenant.id, spec.starts_on, spec.ends_on),
        ).fetchall()
    elif dimension == "campaign":
        kind = "money"
        rows = [
            {"label": row["name"], "value": row["won_minor"]}
            for row in campaigns(conn, tenant)["campaigns"]
            if row["starts_on"] <= spec.ends_on and row["ends_on"] >= spec.starts_on
        ]
    elif dimension == "forecast":
        kind = "money"
        rows = conn.execute(
            """
            SELECT to_char(d.expected_close_date,'YYYY-MM') AS label,
              round(sum(d.amount_minor::numeric * s.probability / 100))::text AS value
            FROM deals d JOIN pipeline_stages s ON s.workspace_id=d.workspace_id AND s.id=d.stage_id
            WHERE d.workspace_id=%s AND d.expected_close_date BETWEEN %s AND %s
              AND s.kind='open' AND d.archived_at IS NULL GROUP BY 1 ORDER BY 1
            """,
            (tenant.id, spec.starts_on, spec.ends_on),
        ).fetchall()
    else:
        kind = "count"
        today = datetime.now(zone).date()
        # The CRM computes health from current records. It does not reconstruct historical scores.
        if not spec.starts_on <= today <= spec.ends_on:
            raise ServiceError(
                422,
                "report_health_date",
                "Include today to report the current customer health snapshot.",
            )
        counts = {}
        for customer in snapshot(conn, tenant, include_all_health=True)["customers"]:
            band = customer["classification"]
            counts[band] = counts.get(band, 0) + 1
        rows = [{"label": label, "value": str(count)} for label, count in sorted(counts.items())]
    return {
        "rows": rows,
        "dimension": dimension,
        "kind": kind,
        "currency": tenant.currency,
        "starts_on": spec.starts_on,
        "ends_on": spec.ends_on,
    }


def audit_history(conn, tenant, selection):
    require_owner(tenant)
    return conn.execute(
        """
        SELECT e.id,e.event_type,e.resource_type,e.resource_id,e.created_at,
          coalesce(t.display_name,'Former member') AS actor
        FROM audit_events e LEFT JOIN clorix_access.team_directory() t ON t.member_id=e.actor_member_id
        WHERE e.workspace_id=%s AND (%s='' OR e.event_type=%s) AND (%s='' OR e.resource_type=%s)
          AND (%s::uuid IS NULL OR e.resource_id=%s)
        ORDER BY e.created_at DESC,e.id DESC LIMIT 150
        """,
        (
            tenant.id,
            selection.event,
            selection.event,
            selection.entity,
            selection.entity,
            selection.record_id,
            selection.record_id,
        ),
    ).fetchall()

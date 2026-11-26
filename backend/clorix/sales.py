from calendar import monthrange
from collections import Counter, defaultdict
from datetime import date, datetime
from zoneinfo import ZoneInfo

from psycopg.types.json import Jsonb

from clorix.inputs import (
    CustomerProfile,
    LeadProfile,
    PipelineConfig,
    SalesTarget,
    Scoring,
    StagesConfig,
)
from clorix.intelligence import (
    DEFAULT_HEALTH_WEIGHTS,
    DEFAULT_LEAD_WEIGHTS,
    customer_health,
    deal_projection,
    rounded_ratio,
    score_lead,
)
from clorix.mutations import audit, require_owner, require_version
from clorix.security import ServiceError


def add_months(day: date, offset: int) -> date:
    year, month = divmod(day.year * 12 + day.month - 1 + offset, 12)
    return date(year, month + 1, min(day.day, monthrange(year, month + 1)[1]))


def elapsed(value: datetime | None, local_day: date, zone: ZoneInfo) -> int | None:
    return max(0, (local_day - value.astimezone(zone).date()).days) if value else None


def settings(conn, tenant) -> dict:
    record = conn.execute(
        "SELECT version,lead_weights,health_weights FROM scoring_settings WHERE workspace_id=%s",
        (tenant.id,),
    ).fetchone()
    return (
        {
            "version": record["version"],
            "lead": record["lead_weights"],
            "health": record["health_weights"],
        }
        if record
        else {"version": 0, "lead": DEFAULT_LEAD_WEIGHTS, "health": DEFAULT_HEALTH_WEIGHTS}
    )


def save_settings(conn, tenant, spec: Scoring) -> dict:
    require_owner(tenant)
    lead, health = spec.lead.model_dump(), spec.health.model_dump()
    if sum(lead.values()) != 100 or sum(health.values()) != 100:
        raise ServiceError(422, "weight_total", "Each group of scoring weights must total 100.")
    require_version(settings(conn, tenant)["version"], spec.version)
    conn.execute(
        """
        INSERT INTO scoring_settings(workspace_id,lead_weights,health_weights) VALUES (%s,%s,%s)
        ON CONFLICT(workspace_id) DO UPDATE SET lead_weights=excluded.lead_weights,
        health_weights=excluded.health_weights,version=scoring_settings.version+1,modified_at=now()
        """,
        (tenant.id, Jsonb(lead), Jsonb(health)),
    )
    audit(conn, tenant, "update_scoring", "workspace", tenant.id)
    return settings(conn, tenant)


def _profile_parent(conn, tenant, table: str, record_id) -> None:
    # The only callers supply the fixed table identifiers below.
    if not conn.execute(
        f"SELECT 1 FROM {table} WHERE workspace_id=%s AND id=%s AND archived_at IS NULL",
        (tenant.id, record_id),
    ).fetchone():
        raise ServiceError(404, "record", "The record is unavailable.")


def save_lead_profile(conn, tenant, spec: LeadProfile) -> dict:
    _profile_parent(conn, tenant, "leads", spec.lead_id)
    previous = conn.execute(
        "SELECT version FROM lead_profiles WHERE workspace_id=%s AND lead_id=%s",
        (tenant.id, spec.lead_id),
    ).fetchone()
    require_version(previous["version"] if previous else 0, spec.version)
    record = conn.execute(
        """
        INSERT INTO lead_profiles(workspace_id,lead_id,priority,tags) VALUES (%s,%s,%s,%s)
        ON CONFLICT(workspace_id,lead_id) DO UPDATE SET priority=excluded.priority,tags=excluded.tags,
          version=lead_profiles.version+1 RETURNING lead_id,priority,tags,version
        """,
        (tenant.id, spec.lead_id, spec.priority, spec.tags),
    ).fetchone()
    audit(conn, tenant, "update_profile", "leads", spec.lead_id)
    return record


def save_customer_profile(conn, tenant, spec: CustomerProfile) -> dict:
    _profile_parent(conn, tenant, "companies", spec.company_id)
    previous = conn.execute(
        "SELECT version FROM customer_profiles WHERE workspace_id=%s AND company_id=%s",
        (tenant.id, spec.company_id),
    ).fetchone()
    require_version(previous["version"] if previous else 0, spec.version)
    record = conn.execute(
        """
        INSERT INTO customer_profiles(workspace_id,company_id,lifecycle,renewal_date,notes,tags)
        VALUES (%s,%s,%s,%s,%s,%s)
        ON CONFLICT(workspace_id,company_id) DO UPDATE SET lifecycle=excluded.lifecycle,
          renewal_date=excluded.renewal_date,notes=excluded.notes,tags=excluded.tags,
          version=customer_profiles.version+1
        RETURNING company_id,lifecycle,renewal_date,notes,tags,version
        """,
        (tenant.id, spec.company_id, spec.lifecycle, spec.renewal_date, spec.notes, spec.tags),
    ).fetchone()
    audit(conn, tenant, "update_profile", "companies", spec.company_id)
    return record


def save_target(conn, tenant, spec: SalesTarget) -> dict:
    require_owner(tenant)
    if spec.month.day != 1:
        raise ServiceError(422, "sales_month", "Choose the first day of the month.")
    prior = conn.execute(
        "SELECT version FROM sales_targets WHERE workspace_id=%s AND month=%s",
        (tenant.id, spec.month),
    ).fetchone()
    require_version(prior["version"] if prior else 0, spec.version)
    saved = conn.execute(
        """
        INSERT INTO sales_targets(workspace_id,month,amount_minor) VALUES(%s,%s,%s)
        ON CONFLICT(workspace_id,month) DO UPDATE SET amount_minor=excluded.amount_minor,
          version=sales_targets.version+1 RETURNING month,amount_minor::text,version
        """,
        (tenant.id, spec.month, int(spec.amount_minor)),
    ).fetchone()
    audit(conn, tenant, "update_sales_target", "workspace", tenant.id)
    return saved


def pipelines(conn, tenant) -> list[dict]:
    groups = conn.execute(
        "SELECT id,name,version FROM sales_pipelines WHERE workspace_id=%s ORDER BY name,id",
        (tenant.id,),
    ).fetchall()
    stages = conn.execute(
        """
        SELECT id,pipeline_id,name,kind,probability,sort_order,version
        FROM pipeline_stages WHERE workspace_id=%s ORDER BY sort_order,id
        """,
        (tenant.id,),
    ).fetchall()
    grouped = defaultdict(list)
    for stage in stages:
        grouped[stage["pipeline_id"]].append(stage)
    return [
        item | {"stages": grouped[item["id"]]}
        for item in [{"id": None, "name": "Default pipeline", "version": 0}, *groups]
    ]


def save_pipeline(conn, tenant, spec: PipelineConfig) -> dict:
    require_owner(tenant)
    if spec.pipeline_id:
        prior = conn.execute(
            "SELECT version FROM sales_pipelines WHERE workspace_id=%s AND id=%s",
            (tenant.id, spec.pipeline_id),
        ).fetchone()
        if not prior:
            raise ServiceError(404, "pipeline", "The selected pipeline is unavailable.")
        require_version(prior["version"], spec.version)
        result = conn.execute(
            """
            UPDATE sales_pipelines SET name=%s,version=version+1,updated_at=now()
            WHERE workspace_id=%s AND id=%s RETURNING id,name,version
            """,
            (spec.name, tenant.id, spec.pipeline_id),
        ).fetchone()
    else:
        require_version(0, spec.version)
        count = conn.execute(
            "SELECT count(*) AS count FROM sales_pipelines WHERE workspace_id=%s", (tenant.id,)
        ).fetchone()["count"]
        if count >= (3 if tenant.kind == "sandbox" else 20):
            raise ServiceError(
                429, "pipeline_limit", "This workspace has reached its pipeline limit."
            )
        result = conn.execute(
            "INSERT INTO sales_pipelines(workspace_id,name) VALUES(%s,%s) RETURNING id,name,version",
            (tenant.id, spec.name),
        ).fetchone()
        conn.execute(
            """
            INSERT INTO pipeline_stages(workspace_id,pipeline_id,name,kind,sort_order,probability)
            VALUES(%s,%s,'New','open',1,15),(%s,%s,'Proposal','open',2,60),
              (%s,%s,'Closed Won','won',3,100),(%s,%s,'Closed Lost','lost',4,0)
            """,
            (tenant.id, result["id"]) * 4,
        )
    audit(conn, tenant, "save_pipeline", "sales_pipelines", result["id"])
    return result


def save_stages(conn, tenant, spec: StagesConfig) -> dict:
    require_owner(tenant)
    group = next(
        (entry for entry in pipelines(conn, tenant) if entry["id"] == spec.pipeline_id), None
    )
    if not group:
        raise ServiceError(404, "pipeline", "The selected pipeline is unavailable.")
    require_version(group["version"], spec.version)
    kind = Counter(stage.kind for stage in spec.stages)
    names = {stage.name.casefold() for stage in spec.stages}
    if kind["won"] != 1 or kind["lost"] != 1 or not kind["open"] or len(names) != len(spec.stages):
        raise ServiceError(422, "stages", "Use unique names with one won and one lost stage.")
    current = {stage["id"]: stage for stage in group["stages"]}
    specified = [stage.id for stage in spec.stages if stage.id]
    if set(specified) != set(current) or len(specified) != len(current):
        raise ServiceError(409, "stages", "Reload the pipeline and keep its existing stages.")
    conn.execute("SET CONSTRAINTS stage_position DEFERRED")
    for order, stage in enumerate(spec.stages, start=1):
        probability = (
            100 if stage.kind == "won" else 0 if stage.kind == "lost" else stage.probability
        )
        if stage.id:
            old = current[stage.id]
            require_version(old["version"], stage.version)
            if old["kind"] != stage.kind:
                raise ServiceError(422, "stage_kind", "An existing stage keeps its outcome type.")
            conn.execute(
                """
                UPDATE pipeline_stages SET name=%s,probability=%s,sort_order=%s,version=version+1,
                  updated_at=now() WHERE workspace_id=%s AND id=%s
                """,
                (stage.name, probability, order, tenant.id, stage.id),
            )
        else:
            conn.execute(
                """
                INSERT INTO pipeline_stages(workspace_id,pipeline_id,name,kind,probability,sort_order)
                VALUES(%s,%s,%s,%s,%s,%s)
                """,
                (tenant.id, spec.pipeline_id, stage.name, stage.kind, probability, order),
            )
    if spec.pipeline_id:
        conn.execute(
            "UPDATE sales_pipelines SET version=version+1,updated_at=now() WHERE workspace_id=%s AND id=%s",
            (tenant.id, spec.pipeline_id),
        )
    audit(conn, tenant, "save_stages", "sales_pipelines", spec.pipeline_id)
    return next(item for item in pipelines(conn, tenant) if item["id"] == spec.pipeline_id)


def _bounded(rows: list[dict], description: str) -> list[dict]:
    if len(rows) > 2_000:
        raise ServiceError(
            422, "analytics_limit", f"Archive inactive records before analyzing {description}."
        )
    return rows


def snapshot(conn, tenant) -> dict:
    zone = ZoneInfo(tenant.timezone)
    today = datetime.now(zone).date()
    month = today.replace(day=1)
    quarter = month.replace(month=((today.month - 1) // 3) * 3 + 1)
    configuration = settings(conn, tenant)
    leads = _bounded(
        conn.execute(
            """
        SELECT l.id,l.name,l.status,l.source,l.email IS NOT NULL AS has_email,
          l.phone IS NOT NULL AS has_phone,p.version AS profile_version,p.tags,
          coalesce(p.priority,'normal') AS priority,a.last,a.recent
        FROM leads l LEFT JOIN lead_profiles p ON p.workspace_id=l.workspace_id AND p.lead_id=l.id
        LEFT JOIN LATERAL (
          SELECT max(occurred_at) AS last,count(*) FILTER(WHERE occurred_at>=now()-interval '30 days') AS recent
          FROM activities WHERE workspace_id=l.workspace_id AND lead_id=l.id AND kind IN ('call','email','meeting')
        ) a ON true
        WHERE l.workspace_id=%s AND l.archived_at IS NULL AND l.status IN ('new','contacted','qualified')
        ORDER BY l.updated_at DESC,l.id LIMIT 2001
        """,
            (tenant.id,),
        ).fetchall(),
        "active leads",
    )
    customers = _bounded(
        conn.execute(
            """
        SELECT c.id,c.name,coalesce(p.lifecycle,'prospect') AS lifecycle,p.renewal_date,p.tags,
          p.notes,p.version AS profile_version,a.last,a.recent,
          (SELECT count(*) FROM support_tickets t WHERE t.workspace_id=c.workspace_id AND t.company_id=c.id AND t.status IN ('open','in_progress')) AS open_tickets,
          EXISTS (SELECT 1 FROM billing_documents d WHERE d.workspace_id=c.workspace_id AND d.company_id=c.id
            AND d.kind='invoice' AND d.status='issued' AND d.due_on<%s
            AND d.total_minor>coalesce((SELECT sum(paid.amount_minor) FROM recorded_payments paid
              WHERE paid.workspace_id=d.workspace_id AND paid.invoice_id=d.id),0)) AS overdue_balance
        FROM companies c LEFT JOIN customer_profiles p ON p.workspace_id=c.workspace_id AND p.company_id=c.id
        LEFT JOIN LATERAL (
          SELECT max(occurred_at) AS last,count(*) FILTER(WHERE occurred_at>=now()-interval '30 days') AS recent
          FROM activities WHERE workspace_id=c.workspace_id AND company_id=c.id AND kind IN ('call','email','meeting')
        ) a ON true
        WHERE c.workspace_id=%s AND c.archived_at IS NULL
        ORDER BY c.updated_at DESC,c.id LIMIT 2001
        """,
            (today, tenant.id),
        ).fetchall(),
        "customers",
    )
    deals = _bounded(
        conn.execute(
            """
        SELECT d.id,d.title,d.amount_minor,d.expected_close_date,d.created_at,d.lost_reason,
          s.name AS stage,s.kind,s.probability,d.actual_closed_at,p.name AS pipeline,
          (SELECT max(event_at) FROM deal_stage_events WHERE workspace_id=d.workspace_id AND deal_id=d.id) AS stage_changed,
          (SELECT max(occurred_at) FROM activities WHERE workspace_id=d.workspace_id AND deal_id=d.id
            AND kind IN ('call','email','meeting')) AS last
        FROM deals d JOIN pipeline_stages s ON s.workspace_id=d.workspace_id AND s.id=d.stage_id
        LEFT JOIN sales_pipelines p ON p.workspace_id=s.workspace_id AND p.id=s.pipeline_id
        WHERE d.workspace_id=%s AND d.archived_at IS NULL AND (
          s.kind='open' OR d.actual_closed_at>=%s::date::timestamp AT TIME ZONE %s)
        ORDER BY d.updated_at DESC,d.id LIMIT 2001
        """,
            (tenant.id, add_months(month, -12), tenant.timezone),
        ).fetchall(),
        "deals",
    )
    rows = []
    for item in leads:
        detail = score_lead(
            item["status"],
            item["has_email"] + item["has_phone"],
            elapsed(item["last"], today, zone),
            item["recent"],
            item["priority"],
            configuration["lead"],
        )
        rows.append(
            {key: item[key] for key in ("id", "name", "source", "status", "priority", "last")}
            | {"tags": item["tags"] or [], "version": item["profile_version"] or 0}
            | detail
        )
    health = []
    for item in customers:
        detail = customer_health(
            item["lifecycle"],
            elapsed(item["last"], today, zone),
            item["recent"],
            item["renewal_date"],
            today,
            configuration["health"],
        )
        penalty = min(20, item["open_tickets"] * 5) + (10 if item["overdue_balance"] else 0)
        if penalty:
            detail["score"] = max(0, detail["score"] - penalty)
            if detail["classification"] != "review":
                detail["classification"] = (
                    "healthy"
                    if detail["score"] >= 75
                    else "watch"
                    if detail["score"] >= 45
                    else "at_risk"
                )
            detail["recommended"] = (
                "Review outstanding invoices"
                if item["overdue_balance"]
                else "Resolve open support tickets"
            )
        detail |= {
            "open_tickets": item["open_tickets"],
            "overdue_balance": item["overdue_balance"],
            "operations_penalty": penalty,
        }
        health.append(
            {key: item[key] for key in ("id", "name", "lifecycle", "renewal_date", "last")}
            | {
                "tags": item["tags"] or [],
                "notes": item["notes"] or "",
                "version": item["profile_version"] or 0,
                "inactivity_days": elapsed(item["last"], today, zone),
            }
            | detail
        )
    forecast, risk, past, lost, stage_totals = (
        defaultdict(Counter),
        [],
        [],
        Counter(),
        defaultdict(Counter),
    )
    unscheduled = 0
    for item in deals:
        if item["kind"] != "open":
            past.append(
                item
                | {"close_month": item["actual_closed_at"].astimezone(zone).date().replace(day=1)}
            )
            if item["kind"] == "lost":
                lost[item["lost_reason"] or "No reason recorded"] += 1
            continue
        age = elapsed(item["stage_changed"] or item["created_at"], today, zone) or 0
        last = elapsed(item["last"], today, zone)
        projected = deal_projection(
            item["amount_minor"], item["probability"], age, last, item["expected_close_date"], today
        )
        risk.append(
            {key: item[key] for key in ("id", "title", "stage", "pipeline", "expected_close_date")}
            | {
                "stage_age": age,
                "configured_amount_minor": str(item["amount_minor"]),
                "risk": projected["risk"],
                "classification": projected["classification"],
                "factors": projected["factors"],
                "probability": projected["scenario_probabilities"],
            }
        )
        tally = stage_totals[(item["pipeline"] or "Default pipeline", item["stage"])]
        tally.update(count=1, aged=int(age >= 21), value=item["amount_minor"])
        close = item["expected_close_date"]
        if close is None or close < today:
            unscheduled += item["amount_minor"]
        else:
            forecast[close.replace(day=1)].update(projected["amounts"])
    targets = conn.execute(
        "SELECT month,amount_minor::text,version FROM sales_targets WHERE workspace_id=%s AND month BETWEEN %s AND %s",
        (tenant.id, add_months(month, -5), add_months(month, 11)),
    ).fetchall()
    target_by_month = {target["month"]: target for target in targets}
    won_by_month = Counter()
    for deal in past:
        if deal["kind"] == "won":
            won_by_month[deal["close_month"]] += deal["amount_minor"]
    series = []
    for offset in range(-5, 12):
        key = add_months(month, offset)
        target = target_by_month.get(key)
        booked = won_by_month[key]
        scenarios = forecast[key]
        series.append(
            {
                "month": key,
                "closed_won_minor": str(booked),
                "target": target,
                **{
                    key + "_minor": str(scenarios[key])
                    for key in ("expected", "conservative", "best_case")
                },
            }
        )
    first = add_months(month, -5)
    closed = [item for item in past if item["close_month"] >= first]
    won = [item for item in closed if item["kind"] == "won"]
    previous_won = sum(won_by_month[add_months(month, k)] for k in range(-11, -5))
    current_won = sum(item["amount_minor"] for item in won)
    sales_cycle = sum((item["actual_closed_at"] - item["created_at"]).days for item in won)
    source = conn.execute(
        """
        SELECT coalesce(nullif(trim(source),''),'Unspecified') AS source,count(*)::int AS leads,
          count(*) FILTER(WHERE status='converted')::int AS conversions
        FROM leads WHERE workspace_id=%s AND created_at>=%s::date::timestamp AT TIME ZONE %s
        GROUP BY 1 ORDER BY conversions DESC,leads DESC,source LIMIT 30
        """,
        (tenant.id, first, tenant.timezone),
    ).fetchall()
    return {
        "generated_for": today,
        "currency": tenant.currency,
        "settings": configuration,
        "role": tenant.role,
        "leads": sorted(rows, key=lambda row: (-row["score"], str(row["id"])))[:100],
        "customers": sorted(health, key=lambda row: (row["score"], str(row["id"])))[:100],
        "risks": sorted(risk, key=lambda row: (-row["risk"], str(row["id"])))[:100],
        "source_performance": source,
        "lost_reasons": [{"reason": k, "count": v} for k, v in lost.most_common(10)],
        "bottlenecks": [
            {
                "pipeline": k[0],
                "stage": k[1],
                "count": v["count"],
                "stalled": v["aged"],
                "amount_minor": str(v["value"]),
            }
            for k, v in sorted(stage_totals.items(), key=lambda item: (-item[1]["aged"], item[0]))
        ],
        "series": series,
        "unscheduled_minor": str(unscheduled),
        "insights": {
            "closed_won_minor": str(current_won),
            "won_count": len(won),
            "lost_count": len(closed) - len(won),
            "average_deal_minor": str(rounded_ratio(current_won, len(won))) if won else None,
            "average_sales_days": rounded_ratio(sales_cycle, len(won)) if won else None,
            "growth_percent": rounded_ratio(100 * (current_won - previous_won), previous_won)
            if previous_won
            else None,
            "win_rate": rounded_ratio(100 * len(won), len(closed)) if closed else None,
            "month_expected_minor": str(forecast[month]["expected"]),
            "quarter_expected_minor": str(
                sum(forecast[add_months(quarter, k)]["expected"] for k in range(3))
            ),
        },
    }

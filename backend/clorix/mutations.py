from collections.abc import Callable
from datetime import date, datetime
from uuid import UUID

from psycopg import Connection
from psycopg.rows import DictRow
from psycopg.types.json import Jsonb

from clorix.db import Tenant
from clorix.security import Call, ServiceError


def require_owner(tenant: Tenant) -> None:
    if tenant.role != "owner":
        raise ServiceError(403, "workspace_role", "A workspace owner must make this change.")


def require_version(actual: int, submitted: int) -> None:
    if actual != submitted:
        raise ServiceError(409, "stale", "This record changed. Refresh before editing it.")


def json_value(value):
    if isinstance(value, (UUID, date, datetime)):
        return value.isoformat() if not isinstance(value, UUID) else str(value)
    if isinstance(value, list):
        return [json_value(item) for item in value]
    if isinstance(value, dict):
        return {key: json_value(item) for key, item in value.items()}
    return value


def once(
    conn: Connection[DictRow],
    tenant: Tenant,
    call: Call,
    key: UUID,
    operation: str,
    change: Callable[[], dict],
) -> dict:
    params = (tenant.id, tenant.user_id, operation, key)
    saved = conn.execute(
        """
        SELECT request_hash,result FROM engine_mutations
        WHERE workspace_id=%s AND actor_id=%s AND operation=%s AND request_key=%s
        """,
        params,
    ).fetchone()
    if saved:
        if saved["request_hash"] != call.grant.digest:
            raise ServiceError(
                409, "idempotency", "This request key already records another change."
            )
        return saved["result"]
    result = json_value(change())
    conn.execute(
        """
        DELETE FROM engine_mutations WHERE workspace_id=%s AND created_at<now()-interval '7 days'
        """,
        (tenant.id,),
    )
    conn.execute(
        """
        INSERT INTO engine_mutations(workspace_id,actor_id,operation,request_key,request_hash,result)
        VALUES (%s,%s,%s,%s,%s,%s)
        """,
        (*params, call.grant.digest, Jsonb(result)),
    )
    return result


def audit(
    conn: Connection[DictRow], tenant: Tenant, event: str, entity: str, entity_id: UUID | None
) -> None:
    conn.execute(
        """
        INSERT INTO audit_events(workspace_id,actor_member_id,event_type,resource_type,resource_id)
        VALUES(%s,%s,%s,%s,%s)
        """,
        (tenant.id, tenant.member_id, event, entity, entity_id),
    )

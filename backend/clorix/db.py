from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from uuid import UUID

from psycopg import Connection
from psycopg.rows import DictRow, dict_row
from psycopg_pool import ConnectionPool

from clorix.security import Call, ServiceError


@dataclass(frozen=True, slots=True)
class Tenant:
    id: UUID
    user_id: UUID
    member_id: UUID
    role: str
    currency: str
    timezone: str
    kind: str


class Database:
    def __init__(self, dsn: str):
        self.pool = (
            ConnectionPool(
                conninfo=dsn,
                min_size=0,
                max_size=3,
                timeout=4,
                max_idle=30,
                open=False,
                kwargs={
                    "connect_timeout": 4,
                    "prepare_threshold": None,
                    "row_factory": dict_row,
                },
            )
            if dsn
            else None
        )

    def open(self) -> None:
        if self.pool:
            self.pool.open()

    def close(self) -> None:
        if self.pool:
            self.pool.close()

    @contextmanager
    def context(
        self, call: Call, *, write: bool = False
    ) -> Iterator[tuple[Connection[DictRow], Tenant]]:
        if not self.pool:
            raise ServiceError(503, "engine_db", "Advanced data services are unavailable.")
        grant = call.grant
        with self.pool.connection() as conn, conn.transaction():
            if not write:
                conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            conn.execute("SET LOCAL statement_timeout = '5s'")
            conn.execute("SET LOCAL lock_timeout = '2s'")
            conn.execute("SET LOCAL TIME ZONE 'UTC'")
            conn.execute(
                """
                SELECT set_config('clorix.actor', %s, true), set_config('clorix.tenant', %s, true)
                """,
                (str(grant.sub), str(grant.workspace)),
            )
            if write:
                # Shared with Next.js so mutations cannot race an ownership or access change.
                conn.execute(
                    "SELECT pg_advisory_xact_lock(hashtextextended(%s, 620102546))",
                    (str(grant.workspace),),
                )
            matched = conn.execute(
                """
                SELECT w.id, m.user_id, m.id AS member_id, m.role, w.currency, w.timezone, w.kind
                FROM workspaces w JOIN memberships m ON m.workspace_id=w.id
                WHERE w.id=%s AND m.user_id=%s AND m.status='active'
                  AND (w.expires_at IS NULL OR w.expires_at>now())
                """,
                (grant.workspace, grant.sub),
            ).fetchone()
            if not matched:
                raise ServiceError(404, "workspace", "This workspace is unavailable.")
            yield conn, Tenant(**matched)

import os
from uuid import uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg.conninfo import conninfo_to_dict
from test_security import KEY, signed

from clorix.app import create_app

pytestmark = pytest.mark.postgres


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
    return admin, runtime


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
    conn.execute("INSERT INTO leads(workspace_id,name) VALUES(%s,'Isolated engine lead')",
                 (workspace,))
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

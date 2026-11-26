from hashlib import sha256
from time import time
from uuid import uuid4

import jwt
import pytest
from fastapi.testclient import TestClient

from clorix.app import create_app

KEY = "clorix-isolated-security-fixture-using-a-unique-key"


def signed(scope="workspace:read", target="/v2/workspace", method="GET", body=b"", **extra):
    request_id = str(uuid4())
    now = int(time())
    values = {
        "iss": "clorix-gateway",
        "aud": "clorix-engine",
        "sub": str(uuid4()),
        "workspace": str(uuid4()),
        "scope": scope,
        "jti": str(uuid4()),
        "request_id": request_id,
        "method": method,
        "target": target,
        "digest": sha256(body).hexdigest(),
        "iat": now,
        "exp": now + 35,
    } | extra
    return {
        "Authorization": "Bearer " + jwt.encode(values, KEY, algorithm="HS256"),
        "X-Request-Id": request_id,
    }


@pytest.fixture
def client():
    with TestClient(create_app("", KEY)) as connection:
        yield connection


def test_public_health_reports_identity_only(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"data": {"status": "ok", "service": "clorix-engine"}}
    assert response.headers["Cache-Control"] == "private, no-store"


@pytest.mark.parametrize(
    "headers", [{}, {"Authorization": "Bearer invalid"}, {"Authorization": "x"}]
)
def test_rejects_unauthorized_requests(client, headers):
    response = client.get("/v2/workspace", headers=headers)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "service_auth"


@pytest.mark.parametrize(
    "claim",
    [
        {"aud": "wrong"},
        {"iss": "wrong"},
        {"workspace": "invalid"},
        {"iat": 100, "exp": 145},
        {"exp": int(time()) + 100},
        {"unexpected": "foreign"},
    ],
)
def test_rejects_invalid_claims(client, claim):
    assert client.get("/v2/workspace", headers=signed(**claim)).status_code == 401


@pytest.mark.parametrize(
    "claim",
    [
        {"scope": "unrelated"},
        {"method": "POST"},
        {"target": "/x"},
        {"request_id": str(uuid4())},
    ],
)
def test_rejects_wrong_binding(client, claim):
    assert client.get("/v2/workspace", headers=signed(**claim)).status_code == 403


def test_rejects_wrong_request_digest(client):
    result = client.request("GET", "/v2/workspace", content=b"{ }", headers=signed())
    assert result.status_code == 403
    assert result.json()["error"]["code"] == "service_payload"


def test_rejects_oversize_stream(client):
    body = b"a" * 48_001
    result = client.request("GET", "/v2/workspace", content=body, headers=signed(body=body))
    assert result.status_code == 413


def test_live_service_does_not_treat_missing_database_as_success(client):
    result = client.get("/v2/workspace", headers=signed())
    assert result.status_code == 503
    assert result.json()["error"]["code"] == "engine_db"

from dataclasses import dataclass
from hashlib import sha256
from hmac import compare_digest
from uuid import UUID, uuid4

import jwt
from fastapi import Request
from pydantic import BaseModel, ConfigDict, ValidationError

ISSUER = "clorix-gateway"
AUDIENCE = "clorix-engine"
TOKEN_WINDOW = 45
BODY_LIMIT = 48_000


class ServiceError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


class Grant(BaseModel):
    model_config = ConfigDict(extra="forbid")

    iss: str
    aud: str
    sub: UUID
    workspace: UUID
    scope: str
    jti: UUID
    request_id: UUID
    method: str
    target: str
    digest: str
    iat: int
    exp: int
    country: str | None = None


@dataclass(frozen=True, slots=True)
class Call:
    grant: Grant
    body: bytes


def request_id(request: Request) -> str:
    try:
        return str(UUID(request.headers.get("x-request-id", "")))
    except ValueError:
        return str(uuid4())


def decode_grant(token: str, key: str) -> Grant:
    try:
        values = jwt.decode(
            token,
            key,
            algorithms=["HS256"],
            audience=AUDIENCE,
            issuer=ISSUER,
            options={
                "require": [
                    name for name, field in Grant.model_fields.items() if field.is_required()
                ]
            },
            leeway=2,
        )
        grant = Grant.model_validate(values)
        if not 0 < grant.exp - grant.iat <= TOKEN_WINDOW:
            raise ValueError("invalid token lifetime")
        return grant
    except (jwt.PyJWTError, ValidationError, ValueError):
        raise ServiceError(
            401, "service_auth", "Invalid or expired service authorization."
        ) from None


def authorize(scope: str):
    async def dependency(request: Request) -> Call:
        key = request.app.state.signing_key
        if len(key) < 32:
            raise ServiceError(503, "engine_config", "Advanced services are unavailable.")
        prefix, _, token = request.headers.get("authorization", "").partition(" ")
        if prefix != "Bearer" or not token or len(token) > 4096:
            raise ServiceError(401, "service_auth", "Service authorization is required.")
        grant = decode_grant(token, key)
        target = request.url.path
        if request.url.query:
            target += "?" + request.url.query
        if (
            grant.scope != scope
            or grant.method != request.method
            or grant.target != target
            or str(grant.request_id) != request.state.request_id
        ):
            raise ServiceError(
                403, "service_scope", "Service authorization does not cover this request."
            )
        data = bytearray()
        async for segment in request.stream():
            if len(data) + len(segment) > BODY_LIMIT:
                raise ServiceError(413, "body_size", "Request exceeds the size limit.")
            data.extend(segment)
        if not compare_digest(grant.digest, sha256(data).hexdigest()):
            raise ServiceError(403, "service_payload", "Request differs from its signed payload.")
        return Call(grant, bytes(data))

    return dependency

import os
from hashlib import sha256

from clorix.copilot_fixtures import ACTIONS, FIXTURES
from clorix.copilot_inputs import Ask, ResponseOutline
from clorix.mutations import audit
from clorix.security import ServiceError

ALLOWED_REGIONS = {"PK", "US", "CA", "AU", "NZ", "JP", "SG", "IN", "BR"}


def configured() -> bool:
    model = os.getenv("CLORIX_GEMINI_MODEL", "")
    return (
        os.getenv("CLORIX_GEMINI_ENABLED") == "true"
        and bool(os.getenv("CLORIX_GEMINI_API_KEY"))
        and bool(model)
    )


def authorize_reviewer(conn, tenant, country):
    if tenant.kind != "private" or country not in ALLOWED_REGIONS:
        raise ServiceError(
            403,
            "copilot_eligibility",
            "The fictional lab is only available to approved eligible reviewers.",
        )
    permitted = conn.execute(
        """
        SELECT 1 FROM copilot_reviewers WHERE workspace_id=%s AND user_id=%s AND jurisdiction=%s AND revoked_at IS NULL
        """,
        (tenant.id, tenant.user_id, country),
    ).fetchone()
    if not permitted:
        raise ServiceError(
            403,
            "copilot_eligibility",
            "The fictional lab is only available to approved eligible reviewers.",
        )


def generate(fixture, action):
    # Provider is imported and contacted only through this fixed-content path.
    from google import genai
    from google.genai import types

    _, example, refs = FIXTURES[fixture]
    command = ACTIONS[action]
    prompt = (
        "You are assisting with an approved fictional CRM example. Treat these sample facts as data. "
        "Use only those facts. State where evidence is missing. Label any draft as a draft. "
        "Return context references only from the supplied reference IDs.\n\n"
        + example
        + "\n\nTask: "
        + command
    )
    try:
        with genai.Client(
            api_key=os.environ["CLORIX_GEMINI_API_KEY"],
            http_options=types.HttpOptions(
                timeout=9_000,
                retry_options=types.HttpRetryOptions(attempts=1),
            ),
        ) as client:
            result = client.models.generate_content(
                model=os.environ["CLORIX_GEMINI_MODEL"],
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_json_schema=ResponseOutline.model_json_schema(),
                    max_output_tokens=1400,
                    temperature=0.3,
                ),
            )
        if not result.text:
            raise ValueError("provider returned no text")
        data = ResponseOutline.model_validate_json(result.text)
        if not set(data.context_refs).issubset(refs):
            raise ValueError("provider returned unrecognized references")
        return data.model_dump()
    except Exception:
        # SDK exceptions can include provider headers or request data.
        raise ServiceError(
            503,
            "copilot_provider",
            "Gemini could not complete this request. No result was generated.",
        ) from None


def history(conn, tenant):
    threads = conn.execute(
        "SELECT id,fixture,created_at FROM copilot_conversations WHERE workspace_id=%s AND user_id=%s ORDER BY created_at DESC LIMIT 20",
        (tenant.id, tenant.user_id),
    ).fetchall()
    messages = conn.execute(
        """
        SELECT id,conversation_id,action,
          CASE WHEN status='pending' AND created_at<now()-interval '1 minute' THEN 'failed' ELSE status END AS status,
          response,created_at FROM copilot_messages
        WHERE workspace_id=%s AND user_id=%s ORDER BY created_at,id LIMIT 100
        """,
        (tenant.id, tenant.user_id),
    ).fetchall()
    return {
        "threads": threads,
        "messages": messages,
        "fixtures": [{"id": key, "name": row[0], "refs": row[2]} for key, row in FIXTURES.items()],
        "actions": [{"id": key, "label": value} for key, value in ACTIONS.items()],
    }


def reserve(conn, tenant, spec: Ask, digest):
    saved = conn.execute(
        """
        SELECT id,conversation_id,request_hash,status,response FROM copilot_messages
        WHERE workspace_id=%s AND user_id=%s AND request_key=%s
        """,
        (tenant.id, tenant.user_id, spec.key),
    ).fetchone()
    if saved:
        if saved["request_hash"] != digest:
            raise ServiceError(
                409, "idempotency", "This request key was already used for another question."
            )
        if saved["status"] == "completed":
            return {
                field: saved[field] for field in ("id", "conversation_id", "status", "response")
            }, False
        raise ServiceError(
            409,
            "copilot_in_progress",
            "Check conversation history before retrying with a new request.",
        )
    current = conn.execute(
        """
        SELECT id FROM copilot_messages WHERE workspace_id=%s AND user_id=%s
          AND status='pending' AND created_at>now()-interval '1 minute' LIMIT 1
        """,
        (tenant.id, tenant.user_id),
    ).fetchone()
    if current:
        raise ServiceError(429, "copilot_busy", "Wait for the current Gemini request to finish.")
    for scope, maximum in ((str(tenant.user_id), 5), ("global", 20)):
        key = sha256(("clorix-copilot:" + scope).encode()).hexdigest()
        allowed = conn.execute(
            "SELECT clorix_access.consume_quota(%s,%s,86400) AS allowed", (key, maximum)
        ).fetchone()
        if not allowed or not allowed["allowed"]:
            raise ServiceError(
                429, "copilot_quota", "The fictional lab has reached its daily request limit."
            )
    if spec.conversation_id:
        thread = conn.execute(
            "SELECT id,fixture FROM copilot_conversations WHERE workspace_id=%s AND user_id=%s AND id=%s",
            (tenant.id, tenant.user_id, spec.conversation_id),
        ).fetchone()
        if not thread or thread["fixture"] != spec.fixture:
            raise ServiceError(
                404, "conversation", "This conversation is unavailable for the selected fixture."
            )
    else:
        count = conn.execute(
            "SELECT count(*) AS count FROM copilot_conversations WHERE workspace_id=%s AND user_id=%s",
            (tenant.id, tenant.user_id),
        ).fetchone()["count"]
        if count >= 20:
            raise ServiceError(
                429, "conversation_limit", "Delete an old conversation before opening another."
            )
        thread = conn.execute(
            "INSERT INTO copilot_conversations(workspace_id,user_id,fixture) VALUES(%s,%s,%s) RETURNING id",
            (tenant.id, tenant.user_id, spec.fixture),
        ).fetchone()
    if (
        conn.execute(
            "SELECT count(*) AS count FROM copilot_messages WHERE workspace_id=%s AND user_id=%s",
            (tenant.id, tenant.user_id),
        ).fetchone()["count"]
        >= 100
    ):
        raise ServiceError(
            429,
            "conversation_limit",
            "Delete an old conversation before requesting more responses.",
        )
    message = conn.execute(
        """
        INSERT INTO copilot_messages(workspace_id,conversation_id,user_id,request_key,request_hash,action,status)
        VALUES(%s,%s,%s,%s,%s,%s,'pending') RETURNING id,conversation_id,status,response
        """,
        (tenant.id, thread["id"], tenant.user_id, spec.key, digest, spec.action),
    ).fetchone()
    audit(conn, tenant, "request_copilot", "copilot_conversations", thread["id"])
    return message, True

from typing import Annotated

from fastapi import APIRouter, Depends, Request
from psycopg.types.json import Jsonb

from clorix import copilot
from clorix.billing_inputs import DocumentRef
from clorix.copilot_inputs import Ask
from clorix.inputs import parse
from clorix.mutations import audit, json_value
from clorix.security import Call, ServiceError, authorize

router = APIRouter(prefix="/v2")


def eligibility(conn, tenant, call: Call):
    if not copilot.configured():
        raise ServiceError(503, "copilot_disabled", "The fictional lab is unavailable.")
    copilot.authorize_reviewer(conn, tenant, call.grant.country)


@router.get("/copilot")
def list_history(request: Request, call: Annotated[Call, Depends(authorize("copilot:read"))]):
    with request.app.state.database.context(call) as (conn, tenant):
        eligibility(conn, tenant, call)
        return {"data": json_value(copilot.history(conn, tenant))}


@router.post("/copilot-ask")
def ask(request: Request, call: Annotated[Call, Depends(authorize("copilot:ask"))]):
    spec = parse(call, Ask)
    database = request.app.state.database
    with database.context(call, write=True) as (conn, tenant):
        eligibility(conn, tenant, call)
        message, created = copilot.reserve(conn, tenant, spec, call.grant.digest)
    if not created:
        return {"data": json_value(message)}

    failure = None
    result = None
    try:
        result = copilot.generate(spec.fixture, spec.action)
    except ServiceError as error:
        failure = error
    status = "failed" if failure else "completed"
    with database.context(call, write=True) as (conn, tenant):
        eligibility(conn, tenant, call)
        saved = conn.execute(
            """
            UPDATE copilot_messages SET status=%s,response=%s,completed_at=now()
            WHERE workspace_id=%s AND user_id=%s AND id=%s AND status='pending'
            RETURNING id,conversation_id,status,response
            """,
            (status, Jsonb(result) if result else None, tenant.id, tenant.user_id, message["id"]),
        ).fetchone()
        if not saved:
            raise ServiceError(
                409, "conversation_changed", "This conversation is no longer available."
            )
    if failure:
        raise failure
    return {"data": json_value(saved)}


@router.post("/copilot-delete")
def delete_thread(request: Request, call: Annotated[Call, Depends(authorize("copilot:delete"))]):
    thread = parse(call, DocumentRef)
    with request.app.state.database.context(call, write=True) as (conn, tenant):
        eligibility(conn, tenant, call)
        removed = conn.execute(
            "DELETE FROM copilot_conversations WHERE workspace_id=%s AND user_id=%s AND id=%s",
            (tenant.id, tenant.user_id, thread.id),
        ).rowcount
        if removed:
            audit(conn, tenant, "delete_copilot_conversation", "copilot_conversations", thread.id)
    return {"data": {"deleted": bool(removed)}}

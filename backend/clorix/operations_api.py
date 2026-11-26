from typing import Annotated

from fastapi import APIRouter, Depends, Request

from clorix.billing_inputs import DocumentRef
from clorix.inputs import parse
from clorix.mutations import json_value
from clorix.operations import (
    add_ticket_note,
    calendar,
    save_event,
    save_member_target,
    save_ticket,
    support_overview,
    team_performance,
    ticket_detail,
)
from clorix.operations_inputs import (
    CalendarEvent,
    CalendarRequest,
    MemberTarget,
    SupportTicket,
    TicketNote,
)
from clorix.sales_api import execute
from clorix.security import Call, authorize

router = APIRouter(prefix="/v2")


@router.get("/support")
def support(request: Request, call: Annotated[Call, Depends(authorize("support:read"))]):
    with request.app.state.database.context(call) as (conn, tenant):
        return {"data": json_value(support_overview(conn, tenant))}


@router.post("/support-detail")
def read_ticket(request: Request, call: Annotated[Call, Depends(authorize("support:detail"))]):
    identifier = parse(call, DocumentRef).id
    with request.app.state.database.context(call) as (conn, tenant):
        return {"data": json_value(ticket_detail(conn, tenant, identifier))}


@router.post("/support")
def write_ticket(request: Request, call: Annotated[Call, Depends(authorize("support:write"))]):
    return execute(request, call, SupportTicket, save_ticket)


@router.post("/support-note")
def note(request: Request, call: Annotated[Call, Depends(authorize("support:note"))]):
    return execute(request, call, TicketNote, add_ticket_note)


@router.post("/calendar")
def view_calendar(request: Request, call: Annotated[Call, Depends(authorize("calendar:read"))]):
    spec = parse(call, CalendarRequest)
    with request.app.state.database.context(call) as (conn, tenant):
        return {"data": json_value(calendar(conn, tenant, spec))}


@router.post("/calendar-event")
def event(request: Request, call: Annotated[Call, Depends(authorize("calendar:write"))]):
    return execute(request, call, CalendarEvent, save_event)


@router.get("/team-performance")
def performance(
    request: Request, call: Annotated[Call, Depends(authorize("team-performance:read"))]
):
    with request.app.state.database.context(call) as (conn, tenant):
        return {"data": json_value(team_performance(conn, tenant))}


@router.post("/team-member-target")
def target(request: Request, call: Annotated[Call, Depends(authorize("team-target:write"))]):
    return execute(request, call, MemberTarget, save_member_target)

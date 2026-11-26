from datetime import date as CalendarDate
from typing import Annotated, Literal
from uuid import UUID

from pydantic import AwareDatetime, StringConstraints

from clorix.inputs import Input, Label, Mutation, Title

TicketState = Literal["open", "in_progress", "resolved", "closed"]
TicketPriority = Literal["low", "normal", "high", "urgent"]


class SupportTicket(Mutation):
    id: UUID | None = None
    company_id: UUID
    contact_id: UUID | None = None
    assignee_id: UUID | None = None
    subject: Title
    category: Label
    description: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2500)
    ]
    priority: TicketPriority
    status: TicketState = "open"
    resolution: Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)] = ""


class TicketNote(Mutation):
    id: UUID
    body: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]


class CalendarRequest(Input):
    date: CalendarDate | None = None
    mode: Literal["month", "week", "agenda"] = "month"
    kind: Literal["meeting", "call", "follow_up", "task", "deal", "renewal"] | None = None


class CalendarEvent(Mutation):
    id: UUID | None = None
    title: Title
    kind: Literal["meeting", "call", "follow_up"]
    starts_at: AwareDatetime
    ends_at: AwareDatetime
    description: Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)] = ""
    cancelled: bool = False
    assignee_id: UUID
    company_id: UUID | None = None
    deal_id: UUID | None = None
    lead_id: UUID | None = None


class MemberTarget(Mutation):
    member_id: UUID
    month: CalendarDate
    amount_minor: Annotated[str, StringConstraints(pattern=r"^[1-9][0-9]{0,12}$")]

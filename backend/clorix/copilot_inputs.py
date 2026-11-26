from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, StringConstraints

from clorix.inputs import Input

Fixture = Literal["orchard", "paper"]
Action = Literal[
    "pipeline",
    "history",
    "strategy",
    "outreach",
    "follow_up",
    "meeting",
    "health",
    "recommendations",
]
Brief = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=240)]
Paragraph = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1200)]


class Ask(Input):
    key: UUID
    conversation_id: UUID | None = None
    fixture: Fixture
    action: Action
    consent: Literal[True]


class ResponseOutline(Input):
    title: Brief
    summary: Paragraph
    actions: Annotated[list[Brief], Field(max_length=6)]
    context_refs: Annotated[list[Brief], Field(max_length=3)]
    draft: Annotated[str, StringConstraints(max_length=2500)] = ""

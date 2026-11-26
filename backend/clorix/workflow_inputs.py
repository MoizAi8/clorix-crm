from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, StringConstraints

from clorix.inputs import Input, Mutation

Trigger = Literal[
    "lead_created",
    "lead_qualified",
    "lead_high_score",
    "deal_created",
    "deal_stage_changed",
    "deal_won",
    "deal_lost",
    "task_completed",
    "task_overdue",
    "customer_inactive",
    "renewal_approaching",
    "quotation_status_changed",
    "invoice_due",
    "support_created",
]
FieldName = Literal[
    "source",
    "score",
    "amount_minor",
    "stage",
    "owner_member_id",
    "priority",
    "health",
    "days",
    "invoice_status",
    "ticket_status",
]
Category = Literal[
    "assignment", "deadline", "risk", "lead", "renewal", "workflow", "support", "billing"
]


class Condition(Input):
    field: FieldName
    compare: Literal["equals", "at_least", "at_most"]
    value: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class Action(Input):
    action: Literal["task", "notification", "activity", "lead_priority", "lead_tag", "assign"]
    value: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]


class Workflow(Mutation):
    workflow_id: UUID | None = None
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
    trigger_type: Trigger
    enabled: bool
    conditions: Annotated[list[Condition], Field(max_length=6)]
    actions: Annotated[list[Action], Field(min_length=1, max_length=5)]


class Evaluate(Input):
    key: UUID


class Retry(Evaluate):
    run_id: UUID


class TestWorkflow(Input):
    workflow_id: UUID
    entity_id: UUID


class ReadNotification(Evaluate):
    notification_id: UUID | None = None
    unread: bool = False


class Preferences(Mutation):
    categories: Annotated[list[Category], Field(max_length=8)]

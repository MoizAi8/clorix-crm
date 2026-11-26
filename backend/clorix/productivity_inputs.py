from datetime import date
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, StringConstraints

from clorix.billing_inputs import Minor
from clorix.inputs import Input, Label, Mutation, Title

Entity = Literal["leads", "contacts", "companies", "deals"]
Dimension = Literal[
    "lead_source",
    "deal_stage",
    "booked_month",
    "invoice_status",
    "payment_month",
    "support_status",
    "campaign",
    "team",
    "workflow_outcome",
    "customer_health",
    "forecast",
]


class Campaign(Mutation):
    id: UUID | None = None
    name: Title
    channel: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
    objective: Annotated[str, StringConstraints(strip_whitespace=True, max_length=1200)] = ""
    starts_on: date
    ends_on: date
    status: Literal["planned", "active", "completed", "cancelled"]
    budget_minor: Minor
    cost_minor: Minor


class Attribution(Mutation):
    previous_campaign_id: UUID | None = None
    campaign_id: UUID | None = None
    lead_id: UUID


class EmailTemplate(Mutation):
    id: UUID | None = None
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
    category: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
    subject: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    body: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=5000)]


class DraftRequest(Input):
    key: UUID
    template_id: UUID
    contact_id: UUID
    deal_id: UUID | None = None
    save: bool = False


class CustomDefinition(Mutation):
    id: UUID | None = None
    entity: Entity
    name: Label
    data_type: Literal["text", "number", "date", "boolean", "single_select", "multi_select"]
    options: Annotated[list[Label], Field(max_length=15)] = []
    active: bool = True


class RecordFieldRequest(Input):
    entity: Entity
    record_id: UUID


class RecordField(Mutation):
    definition_id: UUID
    entity: Entity
    record_id: UUID
    value: str | bool | list[str] | None


class ReportRequest(Input):
    dimension: Dimension
    starts_on: date
    ends_on: date


class ViewRequest(Input):
    entity: Entity | Literal["tasks"]
    query: Annotated[str, StringConstraints(max_length=100)] = ""
    status: Annotated[str, StringConstraints(max_length=40)] = ""
    source: Annotated[str, StringConstraints(max_length=80)] = ""
    owner: UUID | None = None
    sort: Literal["recent", "oldest", "name"] = "recent"
    archived: bool = False


class Preset(Mutation):
    id: UUID | None = None
    name: Label
    kind: Literal["view", "report"]
    specification: ViewRequest | ReportRequest


class AuditRequest(Input):
    event: Annotated[str, StringConstraints(max_length=80)] = ""
    entity: Annotated[str, StringConstraints(max_length=80)] = ""
    record_id: UUID | None = None

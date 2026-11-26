from datetime import date
from typing import Annotated, Literal
from uuid import UUID

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    ValidationError,
)

from clorix.security import Call, ServiceError

Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Label = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
Tag = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True, to_lower=True, min_length=1, max_length=32, pattern=r"^[\w -]+$"
    ),
]
Priority = Literal["low", "normal", "high"]
Lifecycle = Literal["prospect", "onboarding", "active", "renewal", "former"]


def unique_tags(values: list[str]) -> list[str]:
    return sorted(set(values))


Tags = Annotated[list[Tag], Field(max_length=12), AfterValidator(unique_tags)]
Version = Annotated[int, Field(ge=0, le=2_147_483_647, strict=True)]
Weight = Annotated[int, Field(ge=0, le=100, strict=True)]


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Mutation(Input):
    key: UUID
    version: Version


class LeadProfile(Mutation):
    lead_id: UUID
    priority: Priority
    tags: Tags


class CustomerProfile(Mutation):
    company_id: UUID
    lifecycle: Lifecycle
    renewal_date: date | None = None
    notes: Annotated[str, StringConstraints(strip_whitespace=True, max_length=1500)] = ""
    tags: Tags


class LeadWeights(Input):
    stage: Weight
    reachability: Weight
    recency: Weight
    engagement: Weight
    priority: Weight


class HealthWeights(Input):
    recency: Weight
    engagement: Weight
    lifecycle: Weight
    renewal: Weight


class Scoring(Mutation):
    lead: LeadWeights
    health: HealthWeights


class SalesTarget(Mutation):
    month: date
    amount_minor: Annotated[str, StringConstraints(pattern=r"^[1-9][0-9]{0,12}$")]


class PipelineConfig(Mutation):
    pipeline_id: UUID | None = None
    name: Label


class StageConfig(Input):
    id: UUID | None = None
    name: Label
    probability: Weight
    kind: Literal["open", "won", "lost"]
    version: Version = 0


class StagesConfig(Mutation):
    pipeline_id: UUID | None = None
    stages: Annotated[list[StageConfig], Field(min_length=3, max_length=14)]


def parse[Model: Input](call: Call, model: type[Model]) -> Model:
    try:
        return model.model_validate_json(call.body)
    except ValidationError as error:
        first = error.errors(include_url=False, include_context=False, include_input=False)[0]
        field = ".".join(map(str, first["loc"]))
        suffix = f" ({field})" if field else ""
        raise ServiceError(422, "validation", "Check the submitted fields" + suffix + ".") from None

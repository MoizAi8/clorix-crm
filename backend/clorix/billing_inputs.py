from datetime import date
from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, StringConstraints

from clorix.inputs import Input, Mutation, Title

Minor = Annotated[str, StringConstraints(pattern=r"^[0-9]{1,13}$")]
PaymentAmount = Annotated[str, StringConstraints(pattern=r"^[1-9][0-9]{0,15}$")]
Bps = Annotated[int, Field(ge=0, le=10000, strict=True)]
DocumentKind = Literal["quotation", "invoice"]


class CatalogInput(Mutation):
    id: UUID | None = None
    sku: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50)]
    name: Title
    kind: Literal["product", "service"]
    category: Annotated[str, StringConstraints(strip_whitespace=True, max_length=80)] = ""
    description: Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000)] = ""
    price_minor: Minor
    cost_minor: Minor | None = None
    tax_bps: Bps = 0
    active: bool = True


class LineInput(Input):
    catalog_id: UUID | None = None
    label: Title | None = None
    quantity: Annotated[str, StringConstraints(pattern=r"^[0-9]{1,4}(\.[0-9]{1,3})?$")]
    unit_minor: Minor | None = None
    discount_bps: Bps = 0
    tax_bps: Bps | None = None


class SaveDocument(Mutation):
    id: UUID | None = None
    kind: DocumentKind
    company_id: UUID
    contact_id: UUID | None = None
    deal_id: UUID | None = None
    subject: Title
    due_on: date
    terms: Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)] = ""
    notes: Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)] = ""
    lines: Annotated[list[LineInput], Field(min_length=1, max_length=25)]


class DocumentRef(Input):
    id: UUID


class GenerateDocument(Mutation):
    id: UUID
    source: Literal["duplicate", "quotation", "deal"]


class ChangeDocument(Mutation):
    id: UUID
    status: Literal["sent", "accepted", "rejected", "issued"]


class Payment(Mutation):
    id: UUID
    amount_minor: PaymentAmount
    received_on: date
    method: Literal["bank_transfer", "cash", "card", "other"]
    reference: Annotated[str, StringConstraints(strip_whitespace=True, max_length=100)] = ""
    notes: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] = ""

from typing import Annotated

from fastapi import APIRouter, Depends, Request

from clorix import productivity, reports
from clorix.commercial_search import SearchSpec, search
from clorix.inputs import parse
from clorix.mutations import json_value
from clorix.productivity_inputs import (
    Attribution,
    AuditRequest,
    Campaign,
    CustomDefinition,
    DraftRequest,
    EmailTemplate,
    Preset,
    RecordField,
    RecordFieldRequest,
    ReportRequest,
    ReportSelection,
)
from clorix.sales_api import execute
from clorix.security import Call, authorize

router = APIRouter(prefix="/v2")
Read = Annotated[Call, Depends(authorize("productivity:read"))]
CampaignWrite = Annotated[Call, Depends(authorize("campaign:write"))]
AttributionWrite = Annotated[Call, Depends(authorize("attribution:write"))]
TemplateWrite = Annotated[Call, Depends(authorize("email-template:write"))]
FieldWrite = Annotated[Call, Depends(authorize("field-definition:write"))]
ValueWrite = Annotated[Call, Depends(authorize("field-value:write"))]
PresetWrite = Annotated[Call, Depends(authorize("preset:write"))]
Draft = Annotated[Call, Depends(authorize("email-draft:render"))]
Audit = Annotated[Call, Depends(authorize("audit:read"))]


def read(request, call, handler, spec=None):
    with request.app.state.database.context(call) as (conn, tenant):
        data = handler(conn, tenant) if spec is None else handler(conn, tenant, spec)
        return {"data": json_value(data)}


@router.get("/campaigns")
def list_campaigns(request: Request, call: Read):
    return read(request, call, productivity.campaigns)


@router.post("/campaigns")
def change_campaign(request: Request, call: CampaignWrite):
    return execute(request, call, Campaign, productivity.save_campaign)


@router.post("/campaign-attribution")
def change_attribution(request: Request, call: AttributionWrite):
    return execute(request, call, Attribution, productivity.attribute)


@router.get("/email-templates")
def list_templates(request: Request, call: Read):
    return read(request, call, productivity.template_data)


@router.post("/email-templates")
def change_template(request: Request, call: TemplateWrite):
    return execute(request, call, EmailTemplate, productivity.save_template)


@router.post("/email-draft")
def render_draft(request: Request, call: Draft):
    spec = parse(call, DraftRequest)
    if not spec.save:
        return read(request, call, productivity.draft, spec)
    return execute(request, call, DraftRequest, productivity.draft)


@router.get("/custom-fields")
def list_definitions(request: Request, call: Read):
    return read(request, call, productivity.definitions)


@router.post("/custom-fields")
def change_definition(request: Request, call: FieldWrite):
    return execute(request, call, CustomDefinition, productivity.define_field)


@router.post("/record-fields")
def list_values(request: Request, call: Read):
    return read(request, call, productivity.record_fields, parse(call, RecordFieldRequest))


@router.post("/record-field")
def change_value(request: Request, call: ValueWrite):
    return execute(request, call, RecordField, productivity.save_custom_value)


@router.get("/saved-presets")
def list_presets(request: Request, call: Read):
    return read(request, call, productivity.presets)


@router.post("/saved-presets")
def change_preset(request: Request, call: PresetWrite):
    return execute(request, call, Preset, productivity.save_preset)


@router.post("/report-builder")
def run_report(request: Request, call: Read):
    return read(request, call, reports.report, parse(call, ReportRequest))


@router.post("/audit-history")
def audit_history(request: Request, call: Audit):
    return read(request, call, reports.audit_history, parse(call, AuditRequest))


@router.post("/commercial-search")
def search_operations(request: Request, call: Read):
    return read(request, call, search, parse(call, SearchSpec))


@router.post("/report-records")
def report_records(request: Request, call: Read):
    return read(request, call, reports.report_records, parse(call, ReportSelection))

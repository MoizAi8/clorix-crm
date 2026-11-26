from typing import Annotated

from fastapi import APIRouter, Depends, Request

from clorix.inputs import (
    CustomerProfile,
    LeadProfile,
    PipelineConfig,
    SalesTarget,
    Scoring,
    StagesConfig,
    parse,
)
from clorix.mutations import json_value, once
from clorix.sales import (
    pipelines,
    save_customer_profile,
    save_lead_profile,
    save_pipeline,
    save_settings,
    save_stages,
    save_target,
    snapshot,
)
from clorix.security import Call, authorize

router = APIRouter(prefix="/v2")
Analytics = Annotated[Call, Depends(authorize("intelligence:read"))]
LeadWrite = Annotated[Call, Depends(authorize("lead-profile:write"))]
CustomerWrite = Annotated[Call, Depends(authorize("customer-profile:write"))]
SettingsWrite = Annotated[Call, Depends(authorize("scoring:write"))]
TargetWrite = Annotated[Call, Depends(authorize("target:write"))]
PipelineRead = Annotated[Call, Depends(authorize("pipeline:read"))]
PipelineWrite = Annotated[Call, Depends(authorize("pipeline:write"))]
StageWrite = Annotated[Call, Depends(authorize("stage-config:write"))]


@router.get("/intelligence")
def intelligence(request: Request, call: Analytics):
    with request.app.state.database.context(call) as (conn, tenant):
        return {"data": json_value(snapshot(conn, tenant))}


@router.get("/pipelines")
def list_pipelines(request: Request, call: PipelineRead):
    with request.app.state.database.context(call) as (conn, tenant):
        return {"data": {"role": tenant.role, "pipelines": json_value(pipelines(conn, tenant))}}


def execute(request, call, schema, handler):
    spec = parse(call, schema)
    with request.app.state.database.context(call, write=True) as (conn, tenant):
        return {
            "data": once(
                conn, tenant, call, spec.key, call.grant.scope, lambda: handler(conn, tenant, spec)
            )
        }


@router.post("/lead-profile")
def lead_profile(request: Request, call: LeadWrite):
    return execute(request, call, LeadProfile, save_lead_profile)


@router.post("/customer-profile")
def customer_profile(request: Request, call: CustomerWrite):
    return execute(request, call, CustomerProfile, save_customer_profile)


@router.post("/scoring")
def scoring(request: Request, call: SettingsWrite):
    return execute(request, call, Scoring, save_settings)


@router.post("/sales-target")
def sales_target(request: Request, call: TargetWrite):
    return execute(request, call, SalesTarget, save_target)


@router.post("/pipelines")
def pipeline(request: Request, call: PipelineWrite):
    return execute(request, call, PipelineConfig, save_pipeline)


@router.post("/stages")
def configure_stages(request: Request, call: StageWrite):
    return execute(request, call, StagesConfig, save_stages)

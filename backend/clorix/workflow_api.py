from typing import Annotated

from fastapi import APIRouter, Depends, Request

from clorix.inputs import parse
from clorix.mutations import json_value
from clorix.sales_api import execute
from clorix.security import Call, authorize
from clorix.workflow_inputs import (
    Evaluate,
    Preferences,
    ReadNotification,
    Retry,
    TestWorkflow,
    Workflow,
)
from clorix.workflows import (
    evaluate,
    list_workflows,
    notifications,
    preferences,
    retry,
    save_workflow,
    test_workflow,
    update_read,
)

router = APIRouter(prefix="/v2")


@router.get("/workflows")
def list_rules(request: Request, call: Annotated[Call, Depends(authorize("workflow:read"))]):
    with request.app.state.database.context(call) as (conn, tenant):
        return {"data": json_value(list_workflows(conn, tenant))}


@router.post("/workflows")
def save_rule(request: Request, call: Annotated[Call, Depends(authorize("workflow:write"))]):
    return execute(request, call, Workflow, save_workflow)


@router.post("/workflow-evaluate")
def run_rules(request: Request, call: Annotated[Call, Depends(authorize("workflow:evaluate"))]):
    return execute(request, call, Evaluate, lambda conn, tenant, _spec: evaluate(conn, tenant))


@router.post("/workflow-retry")
def retry_rule(request: Request, call: Annotated[Call, Depends(authorize("workflow:retry"))]):
    return execute(
        request, call, Retry, lambda conn, tenant, spec: retry(conn, tenant, spec.run_id)
    )


@router.post("/workflow-test")
def preview_rule(request: Request, call: Annotated[Call, Depends(authorize("workflow:test"))]):
    spec = parse(call, TestWorkflow)
    with request.app.state.database.context(call) as (conn, tenant):
        return {"data": test_workflow(conn, tenant, spec.workflow_id, spec.entity_id)}


@router.get("/notifications")
def inbox(request: Request, call: Annotated[Call, Depends(authorize("notification:read"))]):
    with request.app.state.database.context(call) as (conn, tenant):
        return {"data": json_value(notifications(conn, tenant))}


@router.post("/notification-read")
def mark(request: Request, call: Annotated[Call, Depends(authorize("notification:write"))]):
    return execute(request, call, ReadNotification, update_read)


@router.post("/notification-preferences")
def save_preferences(
    request: Request, call: Annotated[Call, Depends(authorize("notification:preferences"))]
):
    return execute(request, call, Preferences, preferences)

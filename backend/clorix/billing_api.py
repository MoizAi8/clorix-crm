from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response

from clorix.billing import (
    billing_overview,
    change_document,
    document_detail,
    generate,
    record_payment,
    save_catalog,
    save_document,
)
from clorix.billing_inputs import (
    CatalogInput,
    ChangeDocument,
    DocumentRef,
    GenerateDocument,
    Payment,
    SaveDocument,
)
from clorix.inputs import parse
from clorix.mutations import json_value
from clorix.pdf_documents import render_document
from clorix.sales_api import execute
from clorix.security import Call, authorize

router = APIRouter(prefix="/v2")


@router.get("/billing")
def overview(request: Request, call: Annotated[Call, Depends(authorize("billing:read"))]):
    with request.app.state.database.context(call) as (conn, tenant):
        return {"data": json_value(billing_overview(conn, tenant))}


@router.post("/billing-detail")
def detail(request: Request, call: Annotated[Call, Depends(authorize("billing:detail"))]):
    identifier = parse(call, DocumentRef).id
    with request.app.state.database.context(call) as (conn, tenant):
        return {"data": json_value(document_detail(conn, tenant, identifier))}


@router.post("/catalog")
def catalog_item(request: Request, call: Annotated[Call, Depends(authorize("catalog:write"))]):
    return execute(request, call, CatalogInput, save_catalog)


@router.post("/billing-document")
def save(request: Request, call: Annotated[Call, Depends(authorize("billing:write"))]):
    return execute(request, call, SaveDocument, save_document)


@router.post("/billing-status")
def state(request: Request, call: Annotated[Call, Depends(authorize("billing:status"))]):
    return execute(request, call, ChangeDocument, change_document)


@router.post("/billing-generate")
def derive(request: Request, call: Annotated[Call, Depends(authorize("billing:generate"))]):
    return execute(request, call, GenerateDocument, generate)


@router.post("/billing-payment")
def payment(request: Request, call: Annotated[Call, Depends(authorize("billing:payment"))]):
    return execute(request, call, Payment, record_payment)


@router.post("/billing-pdf")
def pdf(request: Request, call: Annotated[Call, Depends(authorize("billing:pdf"))]):
    identifier = parse(call, DocumentRef).id
    with request.app.state.database.context(call) as (conn, tenant):
        content = document_detail(conn, tenant, identifier)
    data = render_document(content)
    name = content["document"]["number"].lower()
    return Response(
        data,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="clorix-{name}.pdf"',
        },
    )

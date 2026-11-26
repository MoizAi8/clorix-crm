import logging
import os
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from psycopg import Error as DatabaseError
from psycopg_pool import PoolTimeout

from clorix.db import Database
from clorix.sales_api import router as sales_router
from clorix.security import Call, ServiceError, authorize, request_id
from clorix.workflow_api import router as workflow_router

logger = logging.getLogger(__name__)


def create_app(dsn: str | None = None, signing_key: str | None = None) -> FastAPI:
    database = Database(os.environ.get("CLORIX_ENGINE_DATABASE_URL", "") if dsn is None else dsn)

    @asynccontextmanager
    async def lifespan(_app):
        database.open()
        try:
            yield
        finally:
            database.close()

    app = FastAPI(
        title="Clorix Engine",
        version="2.0.0",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )
    app.state.signing_key = (
        os.environ.get("CLORIX_ENGINE_SIGNING_KEY", "") if signing_key is None else signing_key
    )
    app.state.database = database

    @app.middleware("http")
    async def identify(request: Request, call_next):
        request.state.request_id = request_id(request)
        response = await call_next(request)
        response.headers["X-Request-Id"] = request.state.request_id
        response.headers["Cache-Control"] = "private, no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.exception_handler(ServiceError)
    async def service_error(request: Request, exc: ServiceError):
        return error_response(request, exc.status, exc.code, exc.message)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, _exc: RequestValidationError):
        return error_response(request, 422, "validation", "Check the submitted fields.")

    @app.exception_handler(DatabaseError)
    @app.exception_handler(PoolTimeout)
    async def database_error(request: Request, exc: Exception):
        if isinstance(exc, DatabaseError) and exc.sqlstate in {"23505", "23503", "23514"}:
            return error_response(
                request, 409, "record_conflict", "The change conflicts with an existing record."
            )
        logger.warning(
            "Database operation failed request_id=%s type=%s",
            request.state.request_id,
            type(exc).__name__,
        )
        return error_response(request, 503, "engine_db", "Advanced data services are unavailable.")

    @app.get("/health")
    def health():
        return {"data": {"status": "ok", "service": "clorix-engine"}}

    @app.get("/v2/workspace")
    def workspace(call: Annotated[Call, Depends(authorize("workspace:read"))]):
        with database.context(call) as (_conn, tenant):
            return {
                "data": {
                    "currency": tenant.currency,
                    "timezone": tenant.timezone,
                    "role": tenant.role,
                    "kind": tenant.kind,
                }
            }

    app.include_router(sales_router)
    app.include_router(workflow_router)
    return app


def error_response(request: Request, status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={
            "error": {"code": code, "message": message, "requestId": request.state.request_id}
        },
    )

import base64
import binascii
import re
import unicodedata
from io import BytesIO
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response
from PIL import Image, UnidentifiedImageError
from psycopg import sql
from pydantic import StringConstraints

from clorix.inputs import Input, parse
from clorix.mutations import audit
from clorix.productivity import RECORDS, _find
from clorix.productivity_api import read
from clorix.productivity_inputs import RecordFieldRequest
from clorix.sales_api import execute
from clorix.security import Call, ServiceError, authorize

MAX_BYTES = 262_144
BODY_LIMIT = 351_000
SUFFIXES = {
    "application/pdf": ".pdf",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "text/plain": ".txt",
}
router = APIRouter(prefix="/v2")
Read = Annotated[Call, Depends(authorize("attachment:read"))]
Upload = Annotated[Call, Depends(authorize("attachment:upload", body_limit=BODY_LIMIT))]
Delete = Annotated[Call, Depends(authorize("attachment:delete"))]


class UploadRequest(RecordFieldRequest):
    key: UUID
    filename: Annotated[str, StringConstraints(min_length=1, max_length=200)]
    media_type: Literal["application/pdf", "image/png", "image/jpeg", "text/plain"]
    contents: Annotated[str, StringConstraints(min_length=1, max_length=349528)]


class AttachmentRef(Input):
    id: UUID


class AttachmentDelete(AttachmentRef):
    key: UUID


def ensure_private(tenant):
    if tenant.kind != "private":
        raise ServiceError(403, "attachment_private", "Attachments require a private workspace.")


def normalized_filename(name, media_type):
    suffix = SUFFIXES[media_type]
    stem = name.replace("\\", "/").split("/")[-1].rsplit(".", 1)[0]
    stem = re.sub(r"[^a-zA-Z0-9 _-]", "_", unicodedata.normalize("NFKC", stem)).strip(" _-")
    return (stem[:95] or "attachment") + suffix


def matches_type(contents, media_type):
    if media_type == "application/pdf":
        return bool(re.match(rb"%PDF-[12]\.[0-9][\r\n]", contents)) and contents.rstrip().endswith(
            b"%%EOF"
        )
    if media_type == "text/plain":
        try:
            return all(char in "\t\r\n" or char.isprintable() for char in contents.decode("utf-8"))
        except UnicodeDecodeError:
            return False
    expected = {"image/png": "PNG", "image/jpeg": "JPEG"}[media_type]
    try:
        with Image.open(BytesIO(contents), formats=[expected]) as image:
            if image.width * image.height > 4_000_000 or getattr(image, "n_frames", 1) != 1:
                return False
            image.verify()
            return True
    except (UnidentifiedImageError, ValueError, OSError, SyntaxError, Image.DecompressionBombError):
        return False


def check_contents(encoded, media_type):
    try:
        contents = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error):
        raise ServiceError(422, "attachment_content", "The file data is invalid.") from None
    if not 1 <= len(contents) <= MAX_BYTES:
        raise ServiceError(413, "attachment_size", "Choose a file between 1 byte and 256 KB.")
    if not matches_type(contents, media_type):
        raise ServiceError(
            422, "attachment_type", "The file contents do not match a supported type."
        )
    return contents


def metadata(conn, tenant, spec):
    ensure_private(tenant)
    if not _find(conn, tenant, spec.entity, spec.record_id):
        raise ServiceError(404, "record", "This record is unavailable.")
    statement = sql.SQL("""
        SELECT id,filename,media_type,size_bytes,created_at,
          (%s OR uploader_member_id=%s) AS can_delete
        FROM record_attachments WHERE workspace_id=%s AND {}=%s
        ORDER BY created_at DESC,id LIMIT 40
    """).format(sql.Identifier(RECORDS[spec.entity]))
    return conn.execute(
        statement, (tenant.role == "owner", tenant.member_id, tenant.id, spec.record_id)
    ).fetchall()


def add(conn, tenant, spec):
    ensure_private(tenant)
    parent = _find(conn, tenant, spec.entity, spec.record_id)
    if not parent or parent["archived_at"]:
        raise ServiceError(404, "record", "Select an active record.")
    contents = check_contents(spec.contents, spec.media_type)
    quota = conn.execute(
        "SELECT count(*) AS count,coalesce(sum(size_bytes),0) AS bytes FROM record_attachments WHERE workspace_id=%s",
        (tenant.id,),
    ).fetchone()
    if quota["count"] >= 40 or quota["bytes"] + len(contents) > 2_097_152:
        raise ServiceError(
            429, "attachment_limit", "This workspace has reached its attachment limit."
        )
    statement = sql.SQL("""
        INSERT INTO record_attachments(workspace_id,entity,{},filename,media_type,contents,uploader_member_id)
        VALUES(%s,%s,%s,%s,%s,%s,%s) RETURNING id
    """).format(sql.Identifier(RECORDS[spec.entity]))
    saved = conn.execute(
        statement,
        (
            tenant.id,
            spec.entity,
            spec.record_id,
            normalized_filename(spec.filename, spec.media_type),
            spec.media_type,
            contents,
            tenant.member_id,
        ),
    ).fetchone()
    audit(conn, tenant, "upload_attachment", "record_attachments", saved["id"])
    return saved


def remove(conn, tenant, spec):
    ensure_private(tenant)
    deleted = conn.execute(
        "DELETE FROM record_attachments WHERE workspace_id=%s AND id=%s RETURNING id",
        (tenant.id, spec.id),
    ).fetchone()
    if not deleted:
        raise ServiceError(404, "attachment", "This attachment is unavailable.")
    audit(conn, tenant, "delete_attachment", "record_attachments", spec.id)
    return {"deleted": True}


@router.post("/attachments-list")
def list_files(request: Request, call: Read):
    return read(request, call, metadata, parse(call, RecordFieldRequest))


@router.post("/attachment-upload")
def upload(request: Request, call: Upload):
    return execute(request, call, UploadRequest, add)


@router.post("/attachment-delete")
def delete(request: Request, call: Delete):
    return execute(request, call, AttachmentDelete, remove)


@router.post("/attachment-download")
def fetch_file(request: Request, call: Read):
    spec = parse(call, AttachmentRef)
    with request.app.state.database.context(call) as (conn, tenant):
        ensure_private(tenant)
        row = conn.execute(
            "SELECT contents FROM record_attachments WHERE workspace_id=%s AND id=%s",
            (tenant.id, spec.id),
        ).fetchone()
    if not row:
        raise ServiceError(404, "attachment", "This attachment is unavailable.")
    return Response(
        row["contents"],
        media_type="application/octet-stream",
        headers={"Content-Disposition": 'attachment; filename="clorix-attachment"'},
    )

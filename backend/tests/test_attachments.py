from base64 import b64encode
from io import BytesIO

import pytest
from PIL import Image

from clorix.attachments import MAX_BYTES, check_contents, matches_type, normalized_filename
from clorix.security import ServiceError


@pytest.mark.parametrize(
    ("original", "media", "name"),
    [
        ("../../factual update.txt", "text/plain", "factual update.txt"),
        ("..\\..\\quotation.pdf", "application/pdf", "quotation.pdf"),
        ("clinical:data..png", "image/png", "clinical_data.png"),
        ("📄.pdf", "application/pdf", "attachment.pdf"),
        (".JPG", "image/jpeg", "attachment.jpg"),
        ("a" * 140 + ".pdf", "application/pdf", "a" * 95 + ".pdf"),
        ("fullwidth Ａ.txt", "text/plain", "fullwidth A.txt"),
    ],
)
def test_names_are_safe_for_downloads(original, media, name):
    assert normalized_filename(original, media) == name


@pytest.mark.parametrize(
    ("contents", "media", "valid"),
    [
        (b"Normal text", "text/plain", True),
        (b"Text\r\n\twith whitespace", "text/plain", True),
        ("Fictional Résumé".encode(), "text/plain", True),
        (b"Text\x00data", "text/plain", False),
        (b"\xff\xa5", "text/plain", False),
        (b"%PDF-1.5\n%%EOF\n", "application/pdf", True),
        (b"%PDF-1.5\nExtra text", "application/pdf", False),
        (b"%PDF-1.5\n%%EOF\nExtra text", "application/pdf", False),
        (b"Plain text", "image/png", False),
        (b"Plain text", "image/jpeg", False),
    ],
)
def test_content_type_matches_allowed_file_type(contents, media, valid):
    assert matches_type(contents, media) is valid


@pytest.mark.parametrize(("image_format", "media"), [("PNG", "image/png"), ("JPEG", "image/jpeg")])
def test_decodable_images_match_only_their_actual_format(image_format, media):
    buffer = BytesIO()
    Image.new("RGB", (10, 10), (20, 34, 55)).save(buffer, image_format)
    contents = buffer.getvalue()
    assert matches_type(contents, media)
    assert not matches_type(contents, "image/png" if media == "image/jpeg" else "image/jpeg")


@pytest.mark.parametrize(
    ("encoded", "status"),
    [("@@@@@@", 422), ("", 413), (b64encode(b"a" * (MAX_BYTES + 1)).decode(), 413)],
)
def test_rejects_invalid_encoding_and_enforces_size(encoded, status):
    with pytest.raises(ServiceError) as error:
        check_contents(encoded, "text/plain")
    assert error.value.status == status

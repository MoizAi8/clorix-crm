from datetime import date
from io import BytesIO

import pytest
from pypdf import PdfReader

from clorix.billing import calculate_line, summarized, totals
from clorix.pdf_documents import render_document
from clorix.security import ServiceError


@pytest.mark.parametrize(
    ("unit", "quantity", "discount", "tax", "expected"),
    [
        (1000, 1000, 0, 0, (1000, 0, 0, 1000)),
        (2501, 1250, 1000, 500, (3126, 313, 141, 2954)),
        (1, 500, 0, 0, (1, 0, 0, 1)),
        (150, 1333, 3333, 800, (200, 67, 11, 144)),
        (400, 1000, 10000, 10000, (400, 400, 0, 0)),
        (0, 1000000, 0, 10000, (0, 0, 0, 0)),
    ],
)
def test_exact_minor_unit_calculation(unit, quantity, discount, tax, expected):
    result = calculate_line(unit, quantity, discount, tax)
    assert tuple(result.values()) == expected


@pytest.mark.parametrize("quantity", [0, -1, 1_000_001])
def test_out_of_range_quantity_fails_before_writes(quantity):
    with pytest.raises(ServiceError) as error:
        calculate_line(100, quantity, 0, 0)
    assert error.value.code == "quantity"


def test_max_total_is_bounded():
    line = calculate_line(9_999_999_999_999, 1_000_000, 0, 10_000)
    with pytest.raises(ServiceError) as error:
        totals([line])
    assert error.value.code == "document_total"


@pytest.mark.parametrize(
    ("kind", "status", "due", "paid", "expected"),
    [
        ("quotation", "draft", date(2026, 4, 1), 0, "draft"),
        ("quotation", "sent", date(2026, 4, 1), 0, "expired"),
        ("quotation", "sent", date(2026, 4, 6), 0, "sent"),
        ("quotation", "accepted", date(2026, 4, 1), 0, "accepted"),
        ("invoice", "issued", date(2026, 4, 1), 0, "overdue"),
        ("invoice", "issued", date(2026, 4, 6), 0, "unpaid"),
        ("invoice", "issued", date(2026, 4, 6), 300, "partial"),
        ("invoice", "issued", date(2026, 4, 1), 1000, "paid"),
    ],
)
def test_document_state_uses_real_balance(kind, status, due, paid, expected):
    row = {
        "kind": kind,
        "serial": 3,
        "status": status,
        "due_on": due,
        "total_minor": 1000,
        "paid_minor": paid,
    }
    result = summarized(row, date(2026, 4, 5))
    assert result["state"] == expected
    assert result["balance_minor"] == str(1000 - paid)


def sample_invoice(n=1):
    subtotal = 2954 * n
    data = {
        "document": {
            "kind": "invoice",
            "subject": "Fictional launch package",
            "company_name": "Example & Co.",
            "currency": "USD",
            "number": "INV-00007",
            "due_on": date(2026, 5, 1),
            "state": "partial",
            "subtotal_minor": 3126 * n,
            "discount_minor": 313 * n,
            "tax_minor": 141 * n,
            "total_minor": subtotal,
            "paid_minor": 1000,
            "balance_minor": subtotal - 1000,
            "terms": "Payment is due within 30 days.",
            "notes": "Synthetic evaluation only.",
        }
    }
    data["lines"] = [
        {
            "label": f"Planning and evaluation session {i + 1}",
            "sku": "CLX-TEST",
            "qty_milli": 1250,
            "unit_minor": 2501,
            "discount_minor": 313,
            "tax_minor": 141,
            "total_minor": 2954,
        }
        for i in range(n)
    ]
    return data


def test_pdf_has_real_content_and_escapes_markup():
    source = sample_invoice()
    source["document"]["subject"] = "Fictional <scope> & plan"
    pdf = PdfReader(BytesIO(render_document(source)))
    text = pdf.pages[0].extract_text()
    for expected in [
        "Clorix.",
        "INV-00007",
        "Fictional <scope> & plan",
        "Example & Co.",
        "USD 29.54",
        "USD 19.54",
    ]:
        assert expected in text


def test_large_pdf_repeats_header_and_retains_final_line():
    pdf = PdfReader(BytesIO(render_document(sample_invoice(25))))
    assert len(pdf.pages) >= 2
    assert "INV-00007" in pdf.pages[-1].extract_text()
    assert "session 25" in "".join(page.extract_text() for page in pdf.pages)

from datetime import date

import pytest

from clorix.productivity import field_value, replace_template, validate_template
from clorix.productivity_inputs import ReportRequest
from clorix.reports import valid_range
from clorix.security import ServiceError


@pytest.mark.parametrize(
    ("kind", "options", "value", "expected"),
    [
        ("text", [], "  Retail  ", "Retail"),
        ("text", [], None, None),
        ("number", [], "-999999999999.123456", "-999999999999.123456"),
        ("number", [], "001.1000", "1.1"),
        ("number", [], "000", "0"),
        ("date", [], "2028-02-29", "2028-02-29"),
        ("boolean", [], False, False),
        ("boolean", [], True, True),
        ("single_select", ["On hold"], "On hold", "On hold"),
        ("multi_select", ["B", "A"], ["B", "B", "A"], ["A", "B"]),
    ],
)
def test_custom_field_types(kind, options, value, expected):
    assert field_value(kind, options, value) == expected


@pytest.mark.parametrize(
    ("kind", "options", "value"),
    [
        ("text", [], "x" * 1001),
        ("text", [], ["x"]),
        ("number", [], "1e3"),
        ("number", [], "3.1234567"),
        ("number", [], "1000000000000"),
        ("date", [], "2027-02-29"),
        ("date", [], "20270101"),
        ("boolean", [], "false"),
        ("single_select", ["A"], "a"),
        ("multi_select", ["A"], ["A", "B"]),
        ("multi_select", ["A"], ["A"] * 16),
    ],
)
def test_invalid_custom_field_values_are_rejected(kind, options, value):
    with pytest.raises(ServiceError, match="matches the field definition"):
        field_value(kind, options, value)


@pytest.mark.parametrize(
    "source",
    [
        "{{passwd}}",
        "{{ contact_name",
        "contact_name }}",
        "{{user.email}}",
        "{{{ contact_name }}}",
    ],
)
def test_only_allowlisted_complete_tags_can_be_stored(source):
    with pytest.raises(ServiceError, match="supported template"):
        validate_template(source)


def test_template_values_are_plain_text_and_not_rendered_twice():
    assert (
        replace_template(
            "Hi {{first_name}} at {{ company_name }}",
            {
                "first_name": "<Ada>",
                "company_name": "{{deal_title}}",
            },
        )
        == "Hi <Ada> at {{deal_title}}"
    )


def test_template_reports_missing_context():
    with pytest.raises(ServiceError, match="deal_title"):
        replace_template("Review {{deal_title}}", {"deal_title": ""})


@pytest.mark.parametrize(
    ("starts", "ends", "allowed"),
    [
        ("2028-01-01", "2028-12-31", True),
        ("2028-01-01", "2029-01-01", False),
        ("2028-11-30", "2028-11-30", True),
        ("2028-12-01", "2028-11-30", False),
        ("1999-12-31", "2000-01-01", False),
        ("2100-12-31", "2101-01-01", False),
    ],
)
def test_report_date_bounds(starts, ends, allowed):
    spec = ReportRequest(
        dimension="lead_source",
        starts_on=date.fromisoformat(starts),
        ends_on=date.fromisoformat(ends),
    )
    if allowed:
        valid_range(spec)
    else:
        with pytest.raises(ServiceError, match="366 days"):
            valid_range(spec)

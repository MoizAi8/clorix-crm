from datetime import date

import pytest

from clorix.intelligence import (
    DEFAULT_HEALTH_WEIGHTS,
    DEFAULT_LEAD_WEIGHTS,
    customer_health,
    deal_projection,
    recency,
    rounded_ratio,
    score_lead,
)
from clorix.sales import add_months
from clorix.workflows import matches


@pytest.mark.parametrize(
    ("days", "expected"),
    [
        (None, 0),
        (0, 100),
        (7, 100),
        (8, 75),
        (14, 75),
        (15, 45),
        (31, 20),
        (61, 0),
    ],
)
def test_recency(days, expected):
    assert recency(days) == expected


@pytest.mark.parametrize(
    ("numerator", "denominator", "expected"),
    [
        (1, 2, 1),
        (2, 3, 1),
        (-1, 2, -1),
        (12345678901235, 10, 1234567890124),
    ],
)
def test_rounding_uses_exact_half_up(numerator, denominator, expected):
    assert rounded_ratio(numerator, denominator) == expected


@pytest.mark.parametrize(
    ("state", "expected"),
    [
        ("new", "warm"),
        ("qualified", "hot"),
        ("converted", "inactive"),
        ("disqualified", "inactive"),
    ],
)
def test_classification_uses_actual_signals(state, expected):
    report = score_lead(state, 2, 1, 3, "normal", DEFAULT_LEAD_WEIGHTS)
    assert report["classification"] == expected
    assert report["coverage"] == 100


def test_missing_inputs_reduce_coverage():
    report = score_lead("qualified", 0, None, 0, "high", DEFAULT_LEAD_WEIGHTS)
    assert report["classification"] == "cold"
    assert report["coverage"] == 55
    assert {row["factor"] for row in report["factors"] if row["missing"]} == {
        "recency",
        "reachability",
    }


def test_risk_scenarios_explain_stalled_and_overdue_deals():
    result = deal_projection(1001, 70, 21, 17, date(2026, 5, 1), date(2026, 5, 2))
    assert result["risk"] == 75
    assert result["classification"] == "high"
    assert result["scenario_probabilities"] == {"conservative": 3, "expected": 18, "best_case": 80}
    assert result["amounts"] == {"conservative": 30, "expected": 180, "best_case": 801}


@pytest.mark.parametrize(
    ("due", "status"),
    [
        (date(2026, 7, 1), "healthy"),
        (date(2026, 5, 1), "healthy"),
        (None, "healthy"),
    ],
)
def test_health_completion_and_renewal_coverage(due, status):
    result = customer_health("active", 1, 4, due, date(2026, 4, 20), DEFAULT_HEALTH_WEIGHTS)
    assert result["classification"] == status
    assert result["coverage"] == (80 if due is None else 100)


def test_empty_customer_history_remains_a_review_candidate():
    result = customer_health("prospect", None, 0, None, date(2026, 4, 20), DEFAULT_HEALTH_WEIGHTS)
    assert result["classification"] == "review"
    assert result["recommended"] == "Schedule a relationship check-in"


def test_month_rollover_and_leap_day():
    assert add_months(date(2024, 1, 31), 1) == date(2024, 2, 29)
    assert add_months(date(2026, 12, 1), 1) == date(2027, 1, 1)


@pytest.mark.parametrize(
    ("facts", "conditions", "expected"),
    [
        (
            {"source": "Referral"},
            [{"field": "source", "compare": "equals", "value": "referral"}],
            True,
        ),
        ({"score": 75}, [{"field": "score", "compare": "at_least", "value": "75"}], True),
        ({"score": 74}, [{"field": "score", "compare": "at_least", "value": "75"}], False),
        ({}, [{"field": "score", "compare": "equals", "value": "0"}], False),
        (
            {"amount_minor": 1001},
            [{"field": "amount_minor", "compare": "at_most", "value": "1000"}],
            False,
        ),
    ],
)
def test_workflow_conditions(facts, conditions, expected):
    assert matches(facts, conditions) is expected

from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

DEFAULT_LEAD_WEIGHTS = {
    "stage": 30,
    "reachability": 20,
    "recency": 25,
    "engagement": 15,
    "priority": 10,
}
DEFAULT_HEALTH_WEIGHTS = {"recency": 35, "engagement": 25, "lifecycle": 20, "renewal": 20}


def rounded_ratio(numerator: int, denominator: int) -> int:
    return int((Decimal(numerator) / denominator).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def recency(days: int | None) -> int:
    if days is None:
        return 0
    if days <= 7:
        return 100
    if days <= 14:
        return 75
    if days <= 30:
        return 45
    if days <= 60:
        return 20
    return 0


@dataclass(frozen=True)
class Factor:
    percent: int
    explanation: str
    missing: bool = False


def explain(weights: dict[str, int], factors: dict[str, Factor]) -> dict:
    parts = []
    weighted = 0
    known = 0
    for key, weight in weights.items():
        factor = factors[key]
        weighted += factor.percent * weight
        known += weight * int(not factor.missing)
        parts.append(
            {
                "factor": key,
                "weight": weight,
                "signal": factor.percent,
                "explanation": factor.explanation,
                "missing": factor.missing,
            }
        )
    return {"score": rounded_ratio(weighted, 100), "coverage": known, "factors": parts}


def score_lead(
    status: str,
    reachable_by: int,
    days: int | None,
    interactions: int,
    priority: str,
    weights: dict[str, int],
) -> dict:
    score = explain(
        weights,
        {
            "stage": Factor({"new": 20, "contacted": 55, "qualified": 100}.get(status, 0), status),
            "reachability": Factor(
                min(reachable_by, 2) * 50,
                f"{reachable_by} saved contact methods",
                reachable_by == 0,
            ),
            "recency": Factor(
                recency(days),
                "No recorded outreach" if days is None else f"Last outreach {days} days ago",
                days is None,
            ),
            "engagement": Factor(
                min(100, interactions * 25), f"{interactions} interactions in 30 days"
            ),
            "priority": Factor({"low": 20, "normal": 50, "high": 100}[priority], priority),
        },
    )
    if status in {"disqualified", "converted"}:
        return score | {"classification": "inactive", "recommended": "Review record history"}
    band = "hot" if score["score"] >= 75 else "warm" if score["score"] >= 45 else "cold"
    action = (
        "Log the first outreach"
        if days is None
        else "Follow up on this inactive lead"
        if days >= 14
        else "Agree the next step"
        if status == "qualified"
        else "Confirm fit and timeline"
    )
    return score | {"classification": band, "recommended": action}


def customer_health(
    lifecycle: str,
    days: int | None,
    interactions: int,
    renewal: date | None,
    today: date,
    weights: dict[str, int],
) -> dict:
    remaining = (renewal - today).days if renewal else None
    renewal_score = (
        0
        if remaining is None or remaining < 0
        else 35
        if remaining <= 14
        else 65
        if remaining <= 30
        else 100
    )
    score = explain(
        weights,
        {
            "recency": Factor(
                recency(days),
                "No recorded engagement" if days is None else f"Last engagement {days} days ago",
                days is None,
            ),
            "engagement": Factor(
                min(100, interactions * 25), f"{interactions} interactions in 30 days"
            ),
            "lifecycle": Factor(
                {"prospect": 40, "onboarding": 65, "active": 100, "renewal": 75, "former": 0}[
                    lifecycle
                ],
                lifecycle,
            ),
            "renewal": Factor(
                renewal_score,
                "Renewal date is missing"
                if remaining is None
                else f"Renewal is {abs(remaining)} days "
                + ("past due" if remaining < 0 else "away"),
                remaining is None,
            ),
        },
    )
    status = (
        "review"
        if score["coverage"] < 55
        else "healthy"
        if score["score"] >= 75
        else "watch"
        if score["score"] >= 45
        else "at_risk"
    )
    recommendation = (
        "Confirm a renewal plan"
        if remaining is not None and remaining <= 30
        else "Schedule a relationship check-in"
        if days is None or days >= 30
        else "Review expansion needs"
        if status == "healthy" and interactions >= 3
        else "Record the next customer touchpoint"
    )
    return score | {
        "classification": status,
        "recommended": recommendation,
        "renewal_days": remaining,
    }


def deal_projection(
    amount: int,
    probability: int,
    stage_age: int,
    inactivity: int | None,
    expected_close: date | None,
    today: date,
) -> dict:
    factors = []
    if expected_close is None:
        factors.append(("No expected close date", 15))
    elif expected_close < today:
        factors.append(("Expected close date has passed", 30))
    if inactivity is None:
        factors.append(("No recorded deal activity", 20))
    elif inactivity >= 14:
        factors.append((f"No recorded deal activity for {inactivity} days", 25))
    if stage_age >= 21:
        factors.append((f"In this stage for {stage_age} days", 20))
    risk = sum(points for _, points in factors)
    expected = rounded_ratio(probability * (100 - risk), 100)
    scenarios = {
        "conservative": max(0, expected - 15),
        "expected": expected,
        "best_case": min(100, max(expected, probability) + 10),
    }
    if amount == 0:
        factors.append(("Deal amount is zero", 0))
    return {
        "risk": risk,
        "classification": "high" if risk >= 50 else "watch" if risk >= 25 else "low",
        "factors": [{"reason": name, "points": points} for name, points in factors],
        "configured_probability": probability,
        "scenario_probabilities": scenarios,
        "amounts": {key: rounded_ratio(amount * value, 100) for key, value in scenarios.items()},
    }

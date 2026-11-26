from types import MappingProxyType

# Static examples maintained in source. No database record or submitted text is used here.
FIXTURES = MappingProxyType(
    {
        "orchard": (
            "Orchard Observatory",
            """Fictional company: Orchard Observatory, a studio selling training for plant observatories.
        Four fictional leads started this cycle. Two completed discovery. One booked a fictional 900-unit
        workshop. One explicitly postponed due to scheduling. Opportunity A has a proposal, a date next
        month, and two recorded discussions. Opportunity B has no close date and no recent outreach.
        Example contact: Morgan Example, project coordinator. Context reference IDs:
        orchard-pipeline, orchard-discovery, orchard-morgan. No real contact information.""",
            ("orchard-pipeline", "orchard-discovery", "orchard-morgan"),
        ),
        "paper": (
            "Paper Bureau",
            """Fictional company: Paper Bureau, a stationery process advisory. Fictional customer profile:
        renewal in 21 days, one open fictional support request about printing, and three internal
        planning conversations in 30 days. Example contact: Avery Example, purchasing lead.
        Customer explicitly asked about a training add-on. Context reference IDs:
        paper-renewal, paper-support, paper-training. Use only these fictional facts.""",
            ("paper-renewal", "paper-support", "paper-training"),
        ),
    }
)

ACTIONS = MappingProxyType(
    {
        "pipeline": "Explain the sales performance and identify a bottleneck if the sample supports it.",
        "history": "Summarize the fictional customer history and identify missing information.",
        "strategy": "Recommend specific follow-up steps grounded in the fictional situation.",
        "outreach": "Create an editable outreach draft with subject and body using the fictional details.",
        "follow_up": "Create an editable follow-up email draft with subject and body using the fictional details.",
        "meeting": "Create a short meeting preparation plan with suggested questions.",
        "health": "Explain customer health signals and which evidence remains uncertain.",
        "recommendations": "Summarize the most important actions and limitations in the fictional records.",
    }
)

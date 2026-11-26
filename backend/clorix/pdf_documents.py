from decimal import Decimal
from io import BytesIO
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.platypus import (
    KeepTogether,
    LongTable,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    TableStyle,
)

NAVY = colors.HexColor("#111A2E")
FOREST = colors.HexColor("#12352B")
LIME = colors.HexColor("#C7FF4D")
MUTED = colors.HexColor("#53665E")
BORDER = colors.HexColor("#DCE5E0")
WASH = colors.HexColor("#EAF8F0")


def money(minor, currency):
    return f"{currency} {Decimal(minor) / 100:,.2f}"


def render_document(detail: dict) -> bytes:
    data = detail["document"]
    page = BytesIO()
    width, height = A4
    kind = "Quotation" if data["kind"] == "quotation" else "Invoice"
    number = data["number"]
    document = SimpleDocTemplate(
        page,
        pagesize=A4,
        rightMargin=43,
        leftMargin=43,
        topMargin=115,
        bottomMargin=68,
        title=f"{kind} {number}",
        author="Clorix",
    )
    styles = getSampleStyleSheet()
    styles.add(
        ParagraphStyle(
            name="DocH",
            fontName="Helvetica-Bold",
            fontSize=19,
            leading=22,
            textColor=NAVY,
            spaceAfter=10,
            splitLongWords=True,
        )
    )
    styles.add(
        ParagraphStyle(
            name="DocBody",
            fontName="Helvetica",
            fontSize=9,
            leading=13,
            textColor=NAVY,
            spaceAfter=4,
            splitLongWords=True,
        )
    )
    styles.add(
        ParagraphStyle(
            name="DocName",
            parent=styles["DocBody"],
            fontSize=11,
            leading=14,
            fontName="Helvetica-Bold",
            textColor=FOREST,
        )
    )
    styles.add(
        ParagraphStyle(
            name="DocTable", parent=styles["DocBody"], fontSize=8, leading=11, spaceAfter=0
        )
    )
    styles.add(ParagraphStyle(name="DocTableNum", parent=styles["DocTable"], alignment=TA_RIGHT))
    styles.add(
        ParagraphStyle(
            name="DocColumn",
            parent=styles["DocTable"],
            fontName="Helvetica-Bold",
            textColor=colors.white,
        )
    )

    def p(text, style="DocBody"):
        return Paragraph(escape(str(text)).replace("\n", "<br/>"), styles[style])

    currency = data["currency"]

    def amount(value):
        return money(value, currency)

    story = [
        p(data["subject"], "DocH"),
        p("Prepared for", "DocBody"),
        p(data["company_name"], "DocName"),
        p(("Valid through " if kind == "Quotation" else "Due on ") + str(data["due_on"])),
        p("Recorded status: " + data["state"].replace("_", " ").title()),
        Spacer(1, 16),
    ]
    table_rows = [
        [
            p(item, "DocColumn")
            for item in ("Item", "Qty", "Unit price", "Discount", "Tax", "Line total")
        ]
    ]
    for line in detail["lines"]:
        label = line["label"] + ("\n" + line["sku"] if line["sku"] else "")
        qty = format((Decimal(line["qty_milli"]) / 1000).normalize(), "f")
        values = [
            qty,
            amount(line["unit_minor"]),
            amount(line["discount_minor"]),
            amount(line["tax_minor"]),
            amount(line["total_minor"]),
        ]
        table_rows.append([p(label, "DocTable"), *[p(value, "DocTableNum") for value in values]])
    table = LongTable(table_rows, colWidths=[140, 32, 81, 73, 73, 97], repeatRows=1, hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), FOREST),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, WASH]),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                ("LINEBELOW", (0, 0), (-1, -1), 0.4, BORDER),
            ]
        )
    )
    story.extend([table, Spacer(1, 15)])
    total_rows = [
        ["Subtotal", data["subtotal_minor"]],
        ["Discounts", data["discount_minor"]],
        ["Tax", data["tax_minor"]],
        ["Total", data["total_minor"]],
    ]
    if kind == "Invoice":
        total_rows.extend(
            [
                ["Recorded payments", data["paid_minor"]],
                ["Outstanding balance", data["balance_minor"]],
            ]
        )
    summary = LongTable(
        [[p(label, "DocTable"), p(amount(value), "DocTableNum")] for label, value in total_rows],
        colWidths=[130, 125],
        hAlign="RIGHT",
    )
    summary.setStyle(
        TableStyle(
            [
                ("LINEBELOW", (0, 0), (-1, -1), 0.4, BORDER),
                ("BACKGROUND", (0, -1), (-1, -1), WASH),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    story.extend([KeepTogether([summary]), Spacer(1, 16)])
    for title, field in (("Terms", "terms"), ("Notes", "notes")):
        if data[field]:
            story.extend([p(title, "DocName"), p(data[field]), Spacer(1, 7)])

    def page_chrome(canvas, frame):
        canvas.saveState()
        canvas.setFillColor(NAVY)
        canvas.rect(0, height - 90, width, 90, fill=1, stroke=0)
        canvas.setFillColor(LIME)
        canvas.setFont("Helvetica-Bold", 22)
        canvas.drawString(43, height - 40, "Clorix.")
        canvas.setFillColor(colors.white)
        canvas.setFont("Helvetica", 9)
        canvas.drawString(43, height - 61, "From lead to loyalty.")
        canvas.setFont("Helvetica-Bold", 14)
        canvas.drawRightString(width - 43, height - 40, kind)
        canvas.setFont("Helvetica", 10)
        canvas.drawRightString(width - 43, height - 62, number)
        canvas.setStrokeColor(BORDER)
        canvas.line(43, 50, width - 43, 50)
        canvas.setFillColor(MUTED)
        canvas.setFont("Helvetica", 8)
        canvas.drawString(43, 35, "Generated from recorded Clorix workspace data")
        canvas.drawRightString(width - 43, 35, f"{number}  |  Page {frame.page}")
        canvas.restoreState()

    document.build(story, onFirstPage=page_chrome, onLaterPages=page_chrome)
    return page.getvalue()

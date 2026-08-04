from datetime import datetime, timezone

from fpdf import FPDF
from fpdf.enums import XPos, YPos

from app.schemas.chat import MessageOut

_ROLE_LABELS = {"user": "User", "assistant": "Assistant", "system": "System"}


def _exported_at() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def _message_header(message: MessageOut) -> str:
    header = _ROLE_LABELS.get(message.role, message.role)
    if message.role == "assistant":
        header += f" · {message.mode_used}"
        if message.reasoning_lens:
            header += f" ({message.reasoning_lens.replace('_', '-')})"
        if message.confidence_band is not None:
            score = round(message.confidence_score) if message.confidence_score is not None else "?"
            header += f" — {message.confidence_band} · {score}"
    return header


def build_markdown_export(conversation_title: str | None, messages: list[MessageOut]) -> str:
    lines: list[str] = [
        f"# {conversation_title or 'Conversation'}",
        "",
        f"_Exported {_exported_at()}_",
        "",
        "---",
        "",
    ]

    for m in messages:
        lines.append(f"## {_message_header(m)}")
        lines.append(f"_{m.created_at.strftime('%Y-%m-%d %H:%M UTC')}_")
        lines.append("")
        lines.append(m.content or "")
        lines.append("")

        if m.claims:
            lines.append("**Claims & Evidence**")
            lines.append("")
            for c in m.claims:
                score_part = f" — score {round(c.claim_score)}" if c.claim_score is not None else ""
                label_part = f" ({c.entailment_label})" if c.entailment_label else ""
                lines.append(f"{c.claim_index}. {c.claim_text}{score_part}{label_part}")
                if c.distortion_flag:
                    bias = c.bias_name or c.distortion_flag.replace("_", " ")
                    domain = f" [{c.bias_category_name}]" if c.bias_category_name else ""
                    lines.append(f"   - ⚠️ Possible bias: **{bias}**{domain}")
                    if c.bias_definition:
                        lines.append(f"     - {c.bias_definition}")
                    if c.distortion_explanation:
                        lines.append(f"     - In this claim: {c.distortion_explanation}")
                for e in c.evidence:
                    support = f"support {e.support_score:.2f}" if e.support_score is not None else "support n/a"
                    relevance = (
                        f"relevance {e.relevance_score:.2f}" if e.relevance_score is not None else "relevance n/a"
                    )
                    lines.append(
                        f'   - [{e.citation_marker}] {e.document_filename}: '
                        f'"{e.excerpt}" ({support}, {relevance}, {e.entailment_label or "n/a"})'
                    )
            lines.append("")

        lines.append("---")
        lines.append("")

    return "\n".join(lines)


_PDF_TRANSLATIONS = {
    "—": "-",  # em dash
    "–": "-",  # en dash
    "‘": "'",
    "’": "'",
    "“": '"',
    "”": '"',
    "…": "...",
    "·": "-",  # middot, used as a separator in labels throughout the UI
}


def _pdf_safe(text: str) -> str:
    # Core PDF fonts (Helvetica) only support Latin-1 - LLM output and this
    # app's own labels routinely use smart quotes/dashes/middots outside
    # that range. Translate the common ones to ASCII look-alikes first, then
    # degrade anything else (emoji, etc.) instead of crashing the export.
    for char, replacement in _PDF_TRANSLATIONS.items():
        text = text.replace(char, replacement)
    return text.encode("latin-1", "replace").decode("latin-1")


def _line(pdf: FPDF, h: float, text: str) -> None:
    # fpdf2's multi_cell defaults to new_x=RIGHT, which leaves the cursor
    # pinned at the right margin - the next w=0 call then has zero width
    # left and raises FPDFException. Force a reset back to the left margin.
    pdf.multi_cell(0, h, _pdf_safe(text), new_x=XPos.LMARGIN, new_y=YPos.NEXT)


def build_pdf_export(conversation_title: str | None, messages: list[MessageOut]) -> bytes:
    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()

    pdf.set_font("Helvetica", "B", 16)
    _line(pdf, 10, conversation_title or "Conversation")
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(120, 120, 120)
    _line(pdf, 6, f"Exported {_exported_at()}")
    pdf.set_text_color(0, 0, 0)
    pdf.ln(4)

    for m in messages:
        pdf.set_font("Helvetica", "B", 12)
        _line(pdf, 7, _message_header(m))

        pdf.set_font("Helvetica", "I", 8)
        pdf.set_text_color(120, 120, 120)
        _line(pdf, 5, m.created_at.strftime("%Y-%m-%d %H:%M UTC"))
        pdf.set_text_color(0, 0, 0)

        pdf.set_font("Helvetica", "", 10)
        _line(pdf, 6, m.content or "")
        pdf.ln(1)

        if m.claims:
            pdf.set_font("Helvetica", "B", 9)
            _line(pdf, 6, "Claims & Evidence")
            pdf.set_font("Helvetica", "", 8)
            for c in m.claims:
                score_part = f" - score {round(c.claim_score)}" if c.claim_score is not None else ""
                label_part = f" ({c.entailment_label})" if c.entailment_label else ""
                _line(pdf, 5, f"{c.claim_index}. {c.claim_text}{score_part}{label_part}")
                if c.distortion_flag:
                    bias = c.bias_name or c.distortion_flag.replace("_", " ")
                    domain = f" [{c.bias_category_name}]" if c.bias_category_name else ""
                    _line(pdf, 5, f"   Possible bias: {bias}{domain}")
                    if c.bias_definition:
                        _line(pdf, 5, f"      {c.bias_definition}")
                    if c.distortion_explanation:
                        _line(pdf, 5, f"      In this claim: {c.distortion_explanation}")
                for e in c.evidence:
                    support = f"support {e.support_score:.2f}" if e.support_score is not None else "support n/a"
                    relevance = (
                        f"relevance {e.relevance_score:.2f}" if e.relevance_score is not None else "relevance n/a"
                    )
                    _line(
                        pdf,
                        5,
                        f'   [{e.citation_marker}] {e.document_filename}: '
                        f'"{e.excerpt}" ({support}, {relevance}, {e.entailment_label or "n/a"})',
                    )
            pdf.ln(1)

        pdf.ln(3)

    return bytes(pdf.output())

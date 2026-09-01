"""The renderers only - build_outline needs a real model call, so it's
exercised live rather than mocked here (see the other production-only
findings this session - a mocked structured-output call proves the mock
schema is self-consistent, not that the real model fills it usefully)."""

import io

from docx import Document
from openpyxl import load_workbook
from pptx import Presentation

from app.services.office_export import render_docx, render_pptx, render_xlsx


class TestRenderDocx:
    def test_title_and_sections_round_trip(self):
        outline = {
            "title": "Q3 Report",
            "sections": [
                {"heading": "Summary", "body": "Revenue grew."},
                {"heading": None, "body": "No heading here."},
            ],
        }
        doc = Document(io.BytesIO(render_docx(outline)))
        text = "\n".join(p.text for p in doc.paragraphs)
        assert "Q3 Report" in text
        assert "Summary" in text
        assert "Revenue grew." in text
        assert "No heading here." in text

    def test_empty_sections_still_produce_a_valid_file(self):
        doc = Document(io.BytesIO(render_docx({"title": "Empty", "sections": []})))
        assert any("Empty" in p.text for p in doc.paragraphs)


class TestRenderPptx:
    def test_title_slide_and_bullet_slides(self):
        outline = {
            "title": "Launch Plan",
            "slides": [
                {"heading": "Timeline", "bullets": ["Week 1", "Week 2"]},
                {"heading": "Risks", "bullets": ["Budget"]},
            ],
        }
        prs = Presentation(io.BytesIO(render_pptx(outline)))
        assert len(prs.slides) == 3  # title slide + 2 content slides
        assert prs.slides[0].shapes.title.text == "Launch Plan"
        assert prs.slides[1].shapes.title.text == "Timeline"

    def test_a_slide_with_no_bullets_does_not_crash(self):
        outline = {"title": "T", "slides": [{"heading": "Empty slide", "bullets": []}]}
        prs = Presentation(io.BytesIO(render_pptx(outline)))
        assert len(prs.slides) == 2


class TestRenderXlsx:
    def test_headers_and_rows(self):
        outline = {
            "title": "Budget",
            "table": {
                "headers": ["Item", "Cost"],
                "rows": [["Rent", "1200"], ["Food", "400"]],
            },
        }
        wb = load_workbook(io.BytesIO(render_xlsx(outline)))
        sheet = wb.active
        rows = list(sheet.iter_rows(values_only=True))
        assert rows[0] == ("Item", "Cost")
        assert rows[1] == ("Rent", "1200")
        assert rows[2] == ("Food", "400")

    def test_a_long_title_is_truncated_to_the_sheet_name_limit(self):
        # Excel sheet names cap at 31 characters - openpyxl raises on anything
        # longer, which would turn "the title was too long" into a 500.
        outline = {"title": "X" * 60, "table": {"headers": [], "rows": []}}
        wb = load_workbook(io.BytesIO(render_xlsx(outline)))
        assert len(wb.active.title) <= 31

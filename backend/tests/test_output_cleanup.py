"""Output cleanup.

Two of these encode bugs that shipped to production: the dash table being
broken by a repo-wide literal-character sweep (twice), and answers ending
paragraphs with a bare "Unsupported." because the prompt named the label.
"""

from app.services.output_cleanup import clean_output, replace_dashes, strip_markup


class TestDashes:
    def test_em_and_en_dashes_become_spaced_hyphens(self):
        # Spaced, not bare: "Great goal—Spanish" -> "Great goal-Spanish" reads
        # as a hyphenated compound word.
        assert replace_dashes("Great goal—Spanish") == "Great goal - Spanish"
        assert replace_dashes("28–35%") == "28 - 35%"

    def test_the_replacement_table_still_contains_dashes(self):
        # Guards the actual regression: a sweep that replaced every literal
        # em dash in the repo also replaced the ones inside this module's own
        # lookup table, quietly turning it into a no-op.
        for dash in ("—", "–", "‒", "―"):
            assert "—" not in replace_dashes(f"a{dash}b")
            assert dash not in replace_dashes(f"a{dash}b")

    def test_plain_hyphens_are_untouched(self):
        assert replace_dashes("well-known") == "well-known"


class TestMarkup:
    def test_strips_markdown_emphasis_and_headings(self):
        assert "**" not in strip_markup("**bold**")
        assert "#" not in strip_markup("# Heading")

    def test_strips_html_tags(self):
        assert strip_markup("<strong>hi</strong>") == "hi"

    def test_decodes_entities(self):
        assert strip_markup("a &amp; b") == "a & b"


class TestSelfLabels:
    def test_strips_a_trailing_verdict_word(self):
        assert clean_output("I cannot control the vehicle. Unsupported.") == (
            "I cannot control the vehicle."
        )

    def test_strips_it_on_every_paragraph(self):
        out = clean_output("One thing. Unsupported.\nAnother thing. Unsupported.")
        assert "Unsupported" not in out
        assert "One thing." in out and "Another thing." in out

    def test_keeps_legitimate_mid_sentence_use(self):
        text = "The claim is unsupported by the available data."
        assert clean_output(text) == text
        text2 = "That reading is unverified, though the trend is clear."
        assert clean_output(text2) == text2

    def test_leaves_ordinary_prose_alone(self):
        text = "Normal sentence with no label at all."
        assert clean_output(text) == text

    def test_collapses_the_gap_a_removed_label_leaves(self):
        assert "\n\n\n" not in clean_output("A.\n\nUnsupported.\n\nB.")

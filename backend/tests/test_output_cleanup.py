"""Output cleanup.

Two of these encode bugs that shipped to production: the dash table being
broken by a repo-wide literal-character sweep (twice), and answers ending
paragraphs with a bare "Unsupported." because the prompt named the label.
"""

from app.services.output_cleanup import (
    clean_output,
    replace_dashes,
    strip_markup,
    strip_opinion_preface,
)


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
    def test_keeps_the_rendered_set_and_normalises_the_rest(self):
        # Bold, italic, code, bullets and tables render in the bubble; they
        # are kept, in one canonical syntax each.
        assert strip_markup("**bold**") == "**bold**"
        assert strip_markup("__bold__ and _it_ and `x`") == "**bold** and *it* and `x`"
        assert strip_markup("* one\n+ two\n• three") == "- one\n- two\n- three"
        assert strip_markup("A | B\n---|---\n1 | 2") == "A | B\n---|---\n1 | 2"

    def test_headings_become_bold_lines_and_rules_go(self):
        assert strip_markup("# Heading\ntext") == "**Heading**\ntext"
        assert "---" not in strip_markup("above\n---\nbelow")

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


class TestOpinionPreface:
    """Belt-and-suspenders for prompt_builder's opinion-framing instruction -
    the model is asked not to write this boilerplate at all (tagging the
    claim instead), but the instruction is a strong default, not a
    guarantee."""

    def test_strips_the_exact_boilerplate_and_recapitalizes(self):
        text = "It is the opinion of Clardentity AI that hybrid work wins."
        assert strip_opinion_preface(text) == "Hybrid work wins."

    def test_strips_the_also_variant(self):
        text = "It is also the opinion of Clardentity AI that this is risky."
        assert strip_opinion_preface(text) == "This is risky."

    def test_is_case_insensitive(self):
        text = "it IS THE opinion of clardentity ai that X follows."
        assert strip_opinion_preface(text) == "X follows."

    def test_strips_it_mid_paragraph_not_just_at_the_start(self):
        text = "First point stands. It is the opinion of Clardentity AI that the second does too."
        out = strip_opinion_preface(text)
        assert "opinion of Clardentity AI" not in out
        assert out == "First point stands. The second does too."

    def test_leaves_ordinary_prose_alone(self):
        text = "Hybrid work will likely remain common in five years."
        assert strip_opinion_preface(text) == text

    def test_runs_as_part_of_clean_output(self):
        text = "It is the opinion of Clardentity AI that hybrid work wins."
        assert clean_output(text) == "Hybrid work wins."

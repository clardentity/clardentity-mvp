"""Naming your companion.

A display label the user chose, so the guards are about what reaches the mode
switcher and the system prompt - not about rejecting input hard enough to lose
somebody's profile save.
"""

import pytest

from app.services.companion_names import MAX_NAME_CHARS, clean_names, name_for
from app.services.prompt_builder import IDENTITY, build_system_instructions


class TestCleanNames:
    def test_keeps_known_modes(self):
        assert clean_names({"learning": "Nick", "knowing": "Gale"}) == {
            "learning": "Nick",
            "knowing": "Gale",
        }

    def test_drops_unknown_modes_rather_than_failing(self):
        # A fifth mode in the payload should not cost the user the save.
        assert clean_names({"learning": "Nick", "astrology": "Mystic"}) == {"learning": "Nick"}

    def test_blank_and_whitespace_names_are_dropped(self):
        assert clean_names({"learning": "   ", "knowing": ""}) == {}

    def test_internal_whitespace_is_collapsed(self):
        # Otherwise a name can be padded into a fake layout in the pill row.
        assert clean_names({"learning": "Nick   the\n\nGuide"}) == {"learning": "Nick the Guide"}

    def test_long_names_are_truncated_not_rejected(self):
        out = clean_names({"learning": "N" * 200})
        assert len(out["learning"]) == MAX_NAME_CHARS

    @pytest.mark.parametrize("bad", [None, [], "Nick", 42])
    def test_non_objects_become_empty(self, bad):
        assert clean_names(bad) == {}

    def test_non_string_values_are_dropped(self):
        assert clean_names({"learning": 42, "knowing": "Gale"}) == {"knowing": "Gale"}


class TestNameFor:
    def test_returns_none_when_unnamed(self):
        assert name_for({}, "learning") is None
        assert name_for(None, "learning") is None

    def test_returns_the_name(self):
        assert name_for({"learning": "Nick"}, "learning") == "Nick"


class TestPromptWiring:
    def test_the_name_reaches_the_system_prompt(self):
        out = build_system_instructions("learning", companion_name="Nick")
        assert '"Nick"' in out

    def test_a_name_does_not_displace_the_identity_rules(self):
        # The nickname is what they call it, not permission to be something
        # else - the whole identity block has to survive alongside it.
        out = build_system_instructions("learning", companion_name="Nick")
        assert IDENTITY in out
        assert "still Clardentity AI" in out

    def test_no_name_leaves_the_prompt_untouched(self):
        assert build_system_instructions("learning") == build_system_instructions(
            "learning", companion_name=None
        )

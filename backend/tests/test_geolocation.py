"""Sign-in location.

No network here - the lookup is verified by hand against a live address. What
these cover is the filter in front of it and the hedging around the output,
which are the parts that decide whether we send a useless request or state
a guess as fact.
"""

from app.services.geolocation import is_resolvable, location_prompt_line


class TestResolvableFilter:
    def test_rejects_addresses_a_lookup_cannot_place(self):
        # Every developer machine and a fair number of misconfigured proxies
        # report one of these; sending them upstream burns quota to learn
        # nothing.
        for ip in ("127.0.0.1", "::1", "192.168.1.5", "10.0.0.1", "172.16.0.1", "169.254.1.1"):
            assert is_resolvable(ip) is False, ip

    def test_rejects_junk(self):
        for ip in (None, "", "unknown", "not-an-ip", "999.999.999.999"):
            assert is_resolvable(ip) is False, ip

    def test_accepts_public_addresses(self):
        assert is_resolvable("8.8.8.8") is True
        assert is_resolvable("2001:4860:4860::8888") is True


class TestPromptLine:
    def test_none_without_a_label(self):
        assert location_prompt_line(None, "Europe/Berlin") is None
        assert location_prompt_line("", None) is None

    def test_hedges_rather_than_asserting(self):
        line = location_prompt_line("Kochi, Kerala, India", "Asia/Kolkata")
        assert line is not None
        # "appear to be" and an explicit override instruction: a VPN or a
        # traveller must not have their own correction argued with.
        assert "appear to be" in line
        assert "never assert it back" in line
        assert "drop it immediately if they say otherwise" in line

    def test_includes_the_place_and_timezone(self):
        line = location_prompt_line("Kochi, Kerala, India", "Asia/Kolkata")
        assert "Kochi, Kerala, India" in line
        assert "Asia/Kolkata" in line

    def test_works_without_a_timezone(self):
        line = location_prompt_line("Berlin, Germany", None)
        assert line is not None and "Berlin, Germany" in line

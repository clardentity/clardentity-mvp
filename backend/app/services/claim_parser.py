import re
from dataclasses import dataclass

_OPEN_TAG_RE = re.compile(r'^<claim id="\d+">')
_CLOSE_TAG = "</claim>"
_OPEN_PREFIX = '<claim id="'
# The optional ` opinion="true"` group is the only other shape this tag ever
# takes - see prompt_builder's opinion-framing instruction. The streaming
# stripper (ClaimTagStripper) never needed updating for it: _OPEN_TAG_RE not
# matching a tag with the extra attribute just falls through to the generic
# _ANY_TAG_RE path below, which strips any well-formed tag regardless of its
# attributes, and _PARTIAL_TAG_RE's `\s[^<>]*` tail already covers a
# still-streaming attribute the same way it covers any other.
#
# extract_claims scans for these open tags rather than matching complete
# <claim>...</claim> blocks. A block-matching regex is all-or-nothing: one
# unclosed tag anywhere in the response means it matches nothing at all, and
# the whole answer collapses to a single unlabeled claim. Anchoring on the
# open tag instead means one malformed claim only ever costs that claim's
# exact boundary, never every other well-formed claim around it.
_OPEN_TAG_FULL_RE = re.compile(r'<claim id="(\d+)"( opinion="true")?>')
_MARKER_RE = re.compile(r"\[(\d+)\]")

# The model's one-sentence bottom line, written first and separately from the
# claims that follow - see prompt_builder._FORMATTING_RULES. Anchored at the
# very start: a <crux>-shaped string appearing later in the text is never
# meaningful and is left alone rather than matched.
_CRUX_RE = re.compile(r'^\s*<crux>(.*?)</crux>\s*', re.DOTALL)

# Any other tag the model emits. The chat bubble renders none of them, so a
# stray <strong> streams in as four visible characters and then vanishes when
# the cleaned final text swaps in - a flicker that looks like a bug.
_ANY_TAG_RE = re.compile(r"^</?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^<>]*?)?/?>")
_ASK_OPEN = "<ask>"
_ASK_CLOSE = "</ask>"
# Still open, so it could still become one.
_PARTIAL_TAG_RE = re.compile(r"^</?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^<>]*)?$")


def _is_partial_open(buf: str) -> bool:
    if len(buf) <= len(_OPEN_PREFIX):
        return _OPEN_PREFIX.startswith(buf)
    if not buf.startswith(_OPEN_PREFIX):
        return False
    rest = buf[len(_OPEN_PREFIX):]
    return re.fullmatch(r'\d*"?>?', rest) is not None


def _is_partial_close(buf: str) -> bool:
    return _CLOSE_TAG.startswith(buf)


class ClaimTagStripper:
    """Incrementally strips <claim id="n"> / </claim> tags from a stream of
    text deltas so the user never sees the raw markup while it's streaming
    in - only the prose and its [n] citation markers. Tags can be split
    across multiple deltas, so this buffers until a tag (or a false alarm)
    resolves.
    """

    def __init__(self) -> None:
        self._buffer = ""
        # Inside an <ask> block. Its body is JSON - a clarifying question and
        # its options - which the UI renders as buttons. Letting the raw object
        # stream past the reader first is worse than showing nothing.
        self._suppressing = False

    def feed(self, chunk: str) -> str:
        self._buffer += chunk
        out: list[str] = []

        while True:
            if self._suppressing:
                end = self._buffer.find(_ASK_CLOSE)
                if end == -1:
                    # Keep only enough to recognise a close tag split across
                    # deltas; everything before it is block body.
                    self._buffer = self._buffer[-len(_ASK_CLOSE):]
                    break
                self._buffer = self._buffer[end + len(_ASK_CLOSE):]
                self._suppressing = False
                continue

            lt = self._buffer.find("<")
            if lt == -1:
                out.append(self._buffer)
                self._buffer = ""
                break

            out.append(self._buffer[:lt])
            self._buffer = self._buffer[lt:]

            if self._buffer.startswith(_ASK_OPEN):
                self._buffer = self._buffer[len(_ASK_OPEN):]
                self._suppressing = True
                continue

            open_match = _OPEN_TAG_RE.match(self._buffer)
            if open_match:
                self._buffer = self._buffer[open_match.end():]
                continue

            if self._buffer.startswith(_CLOSE_TAG):
                self._buffer = self._buffer[len(_CLOSE_TAG):]
                continue

            any_tag = _ANY_TAG_RE.match(self._buffer)
            if any_tag:
                self._buffer = self._buffer[any_tag.end():]
                continue

            if (
                _is_partial_open(self._buffer)
                or _is_partial_close(self._buffer)
                or _PARTIAL_TAG_RE.match(self._buffer)
            ):
                break  # need more input to resolve whether this is a tag

            # The '<' wasn't the start of a claim tag after all.
            out.append(self._buffer[0])
            self._buffer = self._buffer[1:]

        return "".join(out)

    def finalize(self) -> str:
        # Anything still buffered inside an <ask> block is block body, not
        # prose, so it is dropped rather than flushed.
        remaining = "" if self._suppressing else self._buffer
        self._buffer = ""
        return remaining


@dataclass
class ParsedClaim:
    claim_index: int
    claim_text: str
    citation_markers: list[int]
    # Set from the tag itself (<claim id="n" opinion="true">), not inferred
    # from the claim's wording - see prompt_builder._FORMATTING_RULES. A
    # claim framed this way is a stated view with no source of truth to check
    # against, not an unsupported assertion of fact.
    is_opinion: bool = False


def extract_claims(full_text: str) -> list[ParsedClaim]:
    """Parses <claim id="n">...</claim> blocks out of the model's raw output.

    Recovers a claim's text even when its closing tag is missing: an open
    tag's body simply runs to the next open tag (or end of text) when no
    </claim> appears before then, so one malformed claim never drags down
    the claims around it. claim_index is taken verbatim from whatever id the
    model wrote - never renumbered or deduplicated, since [n] citation
    markers in the same text reference the CONTEXT block, not a claim's own
    ordinal, and renumbering would desync the two.

    Falls back to treating the whole response as one unlabeled claim only
    when there isn't a single open tag anywhere, so validation degrades
    instead of silently disappearing.
    """
    opens = list(_OPEN_TAG_FULL_RE.finditer(full_text))
    if not opens:
        stripped = full_text.strip()
        if not stripped:
            return []
        return [
            ParsedClaim(
                claim_index=1,
                claim_text=stripped,
                citation_markers=[int(m) for m in _MARKER_RE.findall(stripped)],
            )
        ]

    claims = []
    for i, m in enumerate(opens):
        end = opens[i + 1].start() if i + 1 < len(opens) else len(full_text)
        body = full_text[m.end():end]
        close_at = body.find(_CLOSE_TAG)
        if close_at != -1:
            body = body[:close_at]
        text = body.strip()
        claims.append(
            ParsedClaim(
                claim_index=int(m.group(1)),
                claim_text=text,
                citation_markers=[int(mk) for mk in _MARKER_RE.findall(text)],
                is_opinion=bool(m.group(2)),
            )
        )
    return claims


class CruxSplitter:
    """Streaming counterpart of extract_crux.

    The crux is the first thing the model writes, and the reader should see it
    first too - as its own card, not as the opening line of a body that then
    keeps scrolling. So deltas are held back until the leading <crux> block
    either closes (it is announced once, and only the text after it flows on)
    or provably isn't there (the text no longer matches a <crux> prefix, and
    everything held is released unchanged). Holding costs at most the length
    of one sentence.
    """

    _OPEN = "<crux>"

    def __init__(self) -> None:
        self._held = ""
        self._resolved = False
        # After a crux, the body's leading whitespace is dropped (as
        # extract_crux does) - tracked separately so the result is the same
        # whether that whitespace arrived in the crux's chunk or the next one.
        self._trim_leading = False

    def _pass(self, text: str) -> str:
        if self._trim_leading:
            text = text.lstrip()
            if text:
                self._trim_leading = False
        return text

    def feed(self, chunk: str) -> tuple[str | None, str]:
        """Returns (crux_text_if_it_just_resolved, text_to_pass_downstream)."""
        if self._resolved:
            return None, self._pass(chunk)
        self._held += chunk
        stripped = self._held.lstrip()
        match = _CRUX_RE.match(self._held)
        if match:
            self._resolved = True
            self._trim_leading = True
            rest = self._held[match.end():]
            self._held = ""
            return match.group(1).strip(), self._pass(rest)
        # Nothing but whitespace so far, a partial "<cru", or an opened block
        # that hasn't closed yet: keep holding.
        if not stripped or self._OPEN.startswith(stripped[: len(self._OPEN)]):
            return None, ""
        # Definitely not a crux. Release what was held, verbatim.
        self._resolved = True
        rest, self._held = self._held, ""
        return None, rest

    def flush(self) -> str:
        """Anything still held when the stream ends (e.g. an unclosed crux)."""
        rest, self._held = self._held, ""
        self._resolved = True
        return rest


def extract_crux(full_text: str) -> tuple[str | None, str]:
    """Pulls a leading <crux>...</crux> block off the front of raw text.

    Returns (crux_text_or_None, remaining_text_with_the_block_removed), so
    every downstream consumer - draft display, reflection, extract_claims -
    works from crux-free text and never has to know the tag existed.
    """
    match = _CRUX_RE.match(full_text)
    if not match:
        return None, full_text
    return match.group(1).strip(), full_text[match.end():]


def strip_claim_tags(full_text: str) -> str:
    """Non-streaming version of the same stripping, for text we already have
    in full (e.g. after a reflection revision)."""
    stripper = ClaimTagStripper()
    return stripper.feed(full_text) + stripper.finalize()

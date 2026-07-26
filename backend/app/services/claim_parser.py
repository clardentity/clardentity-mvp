import re
from dataclasses import dataclass

_OPEN_TAG_RE = re.compile(r'^<claim id="\d+">')
_CLOSE_TAG = "</claim>"
_OPEN_PREFIX = '<claim id="'
_CLAIM_BLOCK_RE = re.compile(r'<claim id="(\d+)">(.*?)</claim>', re.DOTALL)
_MARKER_RE = re.compile(r"\[(\d+)\]")


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
    in — only the prose and its [n] citation markers. Tags can be split
    across multiple deltas, so this buffers until a tag (or a false alarm)
    resolves.
    """

    def __init__(self) -> None:
        self._buffer = ""

    def feed(self, chunk: str) -> str:
        self._buffer += chunk
        out: list[str] = []

        while True:
            lt = self._buffer.find("<")
            if lt == -1:
                out.append(self._buffer)
                self._buffer = ""
                break

            out.append(self._buffer[:lt])
            self._buffer = self._buffer[lt:]

            open_match = _OPEN_TAG_RE.match(self._buffer)
            if open_match:
                self._buffer = self._buffer[open_match.end():]
                continue

            if self._buffer.startswith(_CLOSE_TAG):
                self._buffer = self._buffer[len(_CLOSE_TAG):]
                continue

            if _is_partial_open(self._buffer) or _is_partial_close(self._buffer):
                break  # need more input to resolve whether this is a tag

            # The '<' wasn't the start of a claim tag after all.
            out.append(self._buffer[0])
            self._buffer = self._buffer[1:]

        return "".join(out)

    def finalize(self) -> str:
        remaining = self._buffer
        self._buffer = ""
        return remaining


@dataclass
class ParsedClaim:
    claim_index: int
    claim_text: str
    citation_markers: list[int]


def extract_claims(full_text: str) -> list[ParsedClaim]:
    """Parses <claim id="n">...</claim> blocks out of the model's raw output.
    Falls back to treating the whole response as one unlabeled claim if the
    model didn't follow the tagging format, so validation degrades instead
    of silently disappearing.
    """
    blocks = _CLAIM_BLOCK_RE.findall(full_text)
    if not blocks:
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
    for raw_index, text in blocks:
        text = text.strip()
        claims.append(
            ParsedClaim(
                claim_index=int(raw_index),
                claim_text=text,
                citation_markers=[int(m) for m in _MARKER_RE.findall(text)],
            )
        )
    return claims


def strip_claim_tags(full_text: str) -> str:
    """Non-streaming version of the same stripping, for text we already have
    in full (e.g. after a reflection revision)."""
    stripper = ClaimTagStripper()
    return stripper.feed(full_text) + stripper.finalize()

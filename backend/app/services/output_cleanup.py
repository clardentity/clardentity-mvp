"""Making the model's output look like what the UI actually renders.

The chat bubble is plain text in a `whitespace-pre-wrap` element. It does not
interpret Markdown and it does not interpret HTML, so anything the model emits
in either lands on screen as literal `<strong>` and `**`. Telling the model not
to do it is necessary but not sufficient - models reach for emphasis by habit,
and every one that slips through is visible.

So the prompt asks for plain prose and this strips whatever arrives anyway.
Stripping rather than rendering is deliberate: converting a subset to real
formatting means deciding what to do with the subset you didn't convert, and
an HTML renderer over model output is a surface nobody needs.
"""

import re

# Fenced blocks first, so their contents survive the inline passes below.
_FENCE = re.compile(r"```[a-zA-Z0-9_-]*\n?")

# Any tag at all, not an allow-list. The bubble renders none of them, so the
# only question is whether the reader sees the tag or the text inside it.
_HTML_TAG = re.compile(r"</?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^<>]*?)?/?>")

# Bold/italic/strikethrough. Bold runs first so **x** doesn't leave a stray *.
_MARKDOWN_SPANS = (
    (re.compile(r"\*\*\*(.+?)\*\*\*", re.S), r"\1"),
    (re.compile(r"\*\*(.+?)\*\*", re.S), r"\1"),
    (re.compile(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", re.S), r"\1"),
    (re.compile(r"(?<![\w_])__(.+?)__(?![\w_])", re.S), r"\1"),
    (re.compile(r"(?<![\w_])_(?!\s)(.+?)(?<!\s)_(?![\w_])", re.S), r"\1"),
    (re.compile(r"~~(.+?)~~", re.S), r"\1"),
    # Inline code: keep the code, drop the backticks.
    (re.compile(r"`([^`]+)`"), r"\1"),
    # [text](url) -> text (url); a bare link is more use than link syntax.
    (re.compile(r"\[([^\]]+)\]\((https?://[^)\s]+)\)"), r"\1 (\2)"),
    (re.compile(r"\[([^\]]+)\]\([^)]*\)"), r"\1"),
)

# Leading #### on a line, and the ATX-style trailing hashes.
_HEADING = re.compile(r"^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$", re.M)
# Markdown bullets become a real bullet character rather than an asterisk.
_BULLET = re.compile(r"^(\s*)[*+-]\s+(?=\S)", re.M)
# A row of --- or *** on its own line is a rule; it has no rendering here.
_RULE = re.compile(r"^\s*(?:[-*_]\s*){3,}$", re.M)
# > quoted lines lose the marker, keep the text.
_BLOCKQUOTE = re.compile(r"^\s{0,3}>\s?", re.M)

# Dashes. Requested explicitly, and it removes a class of copy-paste and
# encoding problems downstream - em dashes break in plain-text exports,
# terminals and some PDF fonts.
# Escapes, not literals: em dash, en dash, figure dash, horizontal bar. A
# repo-wide "replace dashes with hyphens" sweep would otherwise rewrite this
# table into a set of no-ops and silently disable the very thing it does.
#
# The spacing matters as much as the character. An em dash is usually written
# without spaces around it, so a straight character swap turns "Great goal-
# Spanish is..." out of "Great goal-Spanish is..." - two words fused into what
# reads as a hyphenated compound. A dash separating clauses always becomes a
# spaced hyphen, whatever spacing it arrived with.
#
# [ \t] rather than \s so a dash at the start of a line can't swallow the
# newline before it and glue two lines together.
_DASH_RUN = re.compile(r"[ \t]*[\u2014\u2013\u2012\u2015][ \t]*")


def replace_dashes(text: str) -> str:
    """Em/en dashes to spaced hyphens. Existing hyphens are left alone."""
    if not text:
        return text
    return _DASH_RUN.sub(" - ", text)


def strip_markup(text: str) -> str:
    """Markdown and HTML out, the words they wrapped left behind."""
    if not text:
        return text

    cleaned = _FENCE.sub("", text)
    cleaned = _HTML_TAG.sub("", cleaned)
    cleaned = _HEADING.sub(r"\1", cleaned)
    cleaned = _RULE.sub("", cleaned)
    cleaned = _BLOCKQUOTE.sub("", cleaned)
    for pattern, replacement in _MARKDOWN_SPANS:
        cleaned = pattern.sub(replacement, cleaned)
    cleaned = _BULLET.sub(r"\1• ", cleaned)

    # &amp; and friends, only the handful that actually show up.
    for entity, char in (
        ("&amp;", "&"),
        ("&lt;", "<"),
        ("&gt;", ">"),
        ("&quot;", '"'),
        ("&#39;", "'"),
        ("&nbsp;", " "),
    ):
        cleaned = cleaned.replace(entity, char)

    # Stripping a heading or a rule can leave three blank lines behind.
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


# A verdict word the model sometimes tacks onto its own sentences, because it
# knows uncited claims get labelled. The label belongs in the evidence panel,
# computed from the score - written into the prose it is both duplicated and
# frequently wrong. Matched only as a standalone sentence at the end of a line
# or paragraph, so "the claim is unsupported by the data" survives untouched.
_SELF_LABEL = re.compile(
    r"[ \t]*\b(?:Unsupported|Unverified|Uncited|No citation|No source)\b\s*[.:]?(?=\s*(?:\n|$))",
    re.IGNORECASE,
)


def strip_self_labels(text: str) -> str:
    """Removes the model's own evidential-status asides from the prose."""
    return _SELF_LABEL.sub("", text)


def clean_output(text: str) -> str:
    """Everything, in the order the passes expect."""
    cleaned = replace_dashes(strip_markup(text))
    cleaned = strip_self_labels(cleaned)
    # Removing a trailing label can leave a blank line where a paragraph was.
    return re.sub(r"\n{3,}", "\n\n", cleaned).strip()

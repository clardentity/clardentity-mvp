"""Greetings and small talk: answered like a person, not researched.

"hi" used to go through the whole machine. The gate check found it vague and
answered with a row of options ("What would you like help creating?"), or it
was written up as a one-line gist in a card with claims to check - a tester
(2026-10-20): "when I say Hi it shall reply me with greeting, instead it just
gives me 4 options to select one". A message made only of a greeting, thanks,
goodbye, "how are you" or "who are you" now skips the questions about the
question and the research, and gets a short, warm reply from the rapid model
(services/prompt_builder.SMALL_TALK_RULES); nothing in it is checked, as with
a Quick answer.

Deliberately narrow: every word has to belong to one of these phrases. "hi,
can you help me write a poem" is a request with a greeting in front, and goes
the normal way.
"""

import re

# Phrases, matched whole, any number of them in a row ("hi there, thanks!").
_PHRASES = [
    r"hi+", r"hii+", r"hello+", r"hey+", r"heya", r"hiya", r"yo", r"namaste", r"hola",
    r"greetings", r"good (?:morning|afternoon|evening|day|night)", r"gm", r"gn",
    r"thanks?", r"thank (?:you|u)", r"thanks a lot", r"thx", r"ty", r"cheers",
    r"much appreciated", r"appreciate it",
    r"bye+", r"goodbye", r"good bye", r"see (?:you|ya|u)(?: later| soon)?", r"take care",
    r"ok(?:ay)?", r"okk+", r"cool", r"great", r"nice", r"awesome", r"perfect", r"got it",
    r"how are (?:you|u)(?: doing)?(?: today)?", r"how(?:'s| is) it going", r"what'?s up", r"sup",
    r"who are (?:you|u)", r"what are (?:you|u)", r"what can (?:you|u) do", r"what do (?:you|u) do",
    r"nice to meet (?:you|u)",
    # Words that only ever ride along with the phrases above.
    r"there", r"everyone", r"all", r"again", r"so much", r"a lot", r"very much",
    r"clardentity", r"friend", r"buddy", r"mate", r"and",
]
_SMALL_TALK = re.compile(r"^(?:(?:%s)(?: |$))+$" % "|".join(_PHRASES))
# Riding-along words alone are not a greeting.
_FILLER_ONLY = re.compile(
    r"^(?:(?:there|everyone|all|again|so much|a lot|very much|clardentity|friend|buddy|mate|and)(?: |$))+$"
)
_MAX_WORDS = 8


def normalise(message: str) -> str:
    """Lower-case words and apostrophes only, single-spaced."""
    text = re.sub(r"[^a-z' ]+", " ", message.lower().replace("’", "'"))
    return re.sub(r"\s+", " ", text).strip()


def is_small_talk(message: str) -> bool:
    """True when the whole message is a greeting, thanks, goodbye or a
    question about the companion itself - nothing to research, nothing to
    ask back about."""
    if not message or "(Clardentity asked:" in message:
        return False
    text = normalise(message)
    if not text or len(text.split()) > _MAX_WORDS:
        return False
    return bool(_SMALL_TALK.match(text)) and not _FILLER_ONLY.match(text)

"""What to look up on the web before answering.

One search with the question as typed finds pages *about* the question. It
does not find the specific facts a good answer needs - the price each of
four trek operators charges, tomorrow's forecast for a named town, the
figure behind a comparison. Those live on different pages, reached by
different queries, and a model asked to compare them without them writes
"I don't have a price for X in front of me" - true, and useless.

So a fast model reads the question (and the recent turns) and writes the
two to four searches a careful person would run, and they run at once. For
a simple question it returns the question, and nothing is lost. Runs
alongside the gate check, which takes as long, so it costs little on the
clock.
"""

import logging
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime

from app.core.config import settings
from app.models import Message
from app.services.anthropic_client import cached, generate_structured

logger = logging.getLogger("clardentity.search_planner")

MAX_QUERIES = 4

_INSTRUCTIONS = (
    "A user asked a question in a chat. Write the web searches that would fetch "
    "the specific facts a good answer needs - the way a careful person would open "
    "two or three tabs before replying.\n\n"
    "Rules:\n"
    "- One to four queries, each a short search-box string (3 to 12 words), "
    "specific enough to land on a page that states the fact: a named thing plus "
    "the attribute wanted ('Indiahikes Kuari Pass trek fee', 'Payyannur weather "
    "forecast tomorrow'), not the whole question restated.\n"
    "- A comparison needs one query per thing being compared, for the attribute "
    "compared (price, dates, features). If the question names the things, use "
    "those names; if it asks for options without naming them, one query to find "
    "the options and one for the attribute across them.\n"
    "- Anything time-sensitive - weather, prices, news, 'today', 'tomorrow', "
    "'latest', a current holder of a post - gets a query with the place, thing "
    "and time in it.\n"
    "- Resolve pronouns and references from the conversation so far; a follow-up "
    "('and for November?') inherits the subject.\n"
    "- A question that needs no lookup (opinion, reasoning, arithmetic, something "
    "about the user's own documents) gets exactly one query: the question's "
    "subject in a few words, for the document store.\n"
    "- TODAY's date is given; a query about current prices, plans or events "
    "carries the current year, not a remembered one.\n"
    "- Also return retrieval_query: the question rewritten as one standalone "
    "sentence with every pronoun and reference resolved, for searching the "
    "user's own documents. Unchanged if it already stands alone.\n"
    "Plain text, no quotes around queries."
)

_SCHEMA = {
    "type": "object",
    "properties": {
        "retrieval_query": {"type": "string"},
        # No maxItems: this API's structured output rejects it; capped in code.
        "queries": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["retrieval_query", "queries"],
    "additionalProperties": False,
}


# The quick answer skips the web by default - it is the fast path - except
# when the question is plainly about something a model cannot know from
# training: the weather, a price, what happened today. Then one search is
# the difference between an answer and "I don't have live data, try an app".
_LIVE_DATA = re.compile(
    r"\b(today|tonight|tomorrow|yesterday|now|currently|current|latest|recent|"
    r"this (?:week|month|year|morning|evening)|"
    r"weather|rain|raining|forecast|temperature|humidity|storm|cyclone|"
    r"price|prices|cost|costs|fee|fees|rate|rates|how much|cheapest|"
    r"score|result|results|match|fixture|"
    r"news|headline|announced|"
    r"stock|share price|exchange rate|"
    r"open(?:ing)? hours|is .* open|"
    r"who is the (?:current )?(?:president|prime minister|ceo|chief minister|governor)|"
    r"20(?:2[5-9]|3\d))\b",
    re.IGNORECASE,
)


def needs_live_data(message: str) -> bool:
    return bool(_LIVE_DATA.search(message))


@dataclass
class SearchPlan:
    retrieval_query: str
    queries: list[str] = field(default_factory=list)


async def plan_searches(history: list[Message], message: str) -> SearchPlan:
    """Never raises: on any failure the plan is the message itself, which is
    what the pipeline used before this existed."""
    recent = history[-6:]
    history_text = "\n".join(
        f"{'User' if m.role == 'user' else 'Assistant'}: {(m.content or '')[:600]}" for m in recent
    )
    input_text = (
        f"TODAY: {datetime.now(UTC).strftime('%d %B %Y')}\n\n"
        + (f"CONVERSATION SO FAR:\n{history_text}\n\n" if history_text else "")
        + f"LATEST MESSAGE:\n{message}"
    )
    try:
        # The smallest model: writing three search-box strings is not a
        # judgement call, and this sits in front of the searches, which sit
        # in front of the first token. Measured 1.3-2.8s against 2.1-2.9s.
        parsed = await generate_structured(
            instructions=cached(_INSTRUCTIONS),
            input_text=input_text,
            schema=_SCHEMA,
            schema_name="search_plan",
            model=settings.anthropic_rapid_model,
            fast=True,
        )
    except Exception:
        logger.warning("search planning failed; searching the question as typed", exc_info=True)
        return SearchPlan(retrieval_query=message, queries=[message])

    retrieval_query = str(parsed.get("retrieval_query") or "").strip() or message
    queries: list[str] = []
    for q in parsed.get("queries") or []:
        text = str(q).strip().strip('"')
        if text and text.lower() not in {x.lower() for x in queries}:
            queries.append(text[:200])
    if not queries:
        queries = [message]
    return SearchPlan(retrieval_query=retrieval_query, queries=queries[:MAX_QUERIES])

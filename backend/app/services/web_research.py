"""Web research with a supervisor that doesn't take the first answer.

Used when the workspace has nothing relevant to cite. The naive version of
this - search once, quote whatever comes back, print the link - replaces
"unsupported" with "supported by a URL", which is worse: a citation that
nobody checked reads as verification while providing none.

So it runs as a loop of two roles:

  search      finds sources and pulls the passage that bears on the claim
  supervisor  judges each source (is this a real, independent, current,
              on-topic source? does the passage actually say what the claim
              says?) and scores it

The supervisor's verdict decides whether there is another round. A source it
rejects comes back with a *reason*, and that reason is what the next search is
told to fix - "this was a content farm restating a press release, find the
primary source" produces a different query than the one that failed. Between
rounds the claim itself can be narrowed or corrected, because often the
problem is not that the evidence is missing but that the claim overstated
what the evidence supports.

The loop stops when a round clears the bar, or when the rounds run out - in
which case the honest result is a low score and a note saying what was
searched for and why it wasn't good enough, not a confident answer with a
decorative link under it.
"""

import asyncio
import logging
import re
from dataclasses import dataclass, field, replace
from urllib.parse import urlparse

import httpx

from app.core.config import settings
from app.services import openai_client
from app.services.anthropic_client import cached, generate_structured

logger = logging.getLogger("clardentity.web_research")

# Two extra rounds after the first. Each round is a search plus a judgement,
# and the returns fall off fast - if a third attempt at the same claim is
# still turning up nothing credible, that is itself the finding.
# Two, not three: with every unsupported claim now researched (not just the
# first two), a third search-and-judge round per claim was the difference
# between a phase that fits its deadline and one that doesn't - and the
# supervisor's "abandon" verdict already ends the hopeless ones early.
MAX_ROUNDS = 2

# Below this the source doesn't get cited at all. Set where a source has to be
# more than "plausibly related" - a passage that merely mentions the topic
# scores here, and citing it would be the exact failure this module exists to
# avoid.
CREDIBILITY_FLOOR = 0.55

_SEARCH_INSTRUCTIONS = (
    "You are researching one specific factual claim using web search.\n\n"
    "Find sources that directly address it. Prefer primary sources (the "
    "organisation, author, dataset or filing that the fact originates from) "
    "over reporting about them, and reporting from an outlet with a masthead "
    "over aggregators, content farms and SEO pages.\n\n"
    "At most 4 sources. If the search turns up nothing that actually "
    "addresses the claim, return an empty list rather than padding it with "
    "near-misses. Quote the passage that bears on the claim, at most 400 "
    "characters."
)

_SUPERVISOR_INSTRUCTIONS = (
    "You are auditing sources that were retrieved to support a claim. You are "
    "the last check before a citation is shown to a user as verification, so "
    "be harder on them than the search was.\n\n"
    "For each source judge:\n"
    "  authenticity - is this a real, identifiable publisher, or a content "
    "farm, an AI-generated aggregator, a scraped mirror, or a page that "
    "cannot be attributed to anyone?\n"
    "  independence - does it add anything, or is it restating a press "
    "release or another source already in the list?\n"
    "  currency     - is it recent enough for a claim of this kind?\n"
    "  entailment   - does the quoted passage actually state the claim, or "
    "merely touch the same subject? This is where most bad citations fail.\n\n"
    "Score each source 0.0-1.0 where 1.0 is a primary source whose passage "
    "states the claim outright, and anything below 0.5 should not be shown to "
    "a user as evidence.\n\n"
    "Then decide the round:\n"
    "  verdict 'accept'  - at least one source genuinely supports the claim\n"
    "  verdict 'retry'   - the claim is probably checkable but these sources "
    "aren't good enough. Say what was wrong with them and what to search for "
    "instead.\n"
    "  verdict 'revise'  - the sources are fine but the claim overstates "
    "them. Give the narrower claim they do support.\n"
    "  verdict 'abandon' - this isn't going to be verifiable by search.\n\n"
    "Score every source you were given, keyed by its url."
)


_SEARCH_SCHEMA = {
    "type": "object",
    "properties": {
        "sources": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "url": {"type": "string"},
                    "title": {"type": "string"},
                    "excerpt": {"type": "string", "description": "Quoted passage bearing on the claim."},
                    "publisher": {"type": ["string", "null"]},
                    "date": {"type": ["string", "null"], "description": "YYYY-MM-DD or null."},
                },
                "required": ["url", "title", "excerpt", "publisher", "date"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["sources"],
    "additionalProperties": False,
}

_SUPERVISOR_SCHEMA = {
    "type": "object",
    "properties": {
        "verdict": {"type": "string", "enum": ["accept", "retry", "revise", "abandon"]},
        "sources": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "url": {"type": "string"},
                    "score": {"type": "number", "description": "0.0-1.0 credibility for this claim."},
                    "note": {"type": "string", "description": "One sentence on why."},
                },
                "required": ["url", "score", "note"],
                "additionalProperties": False,
            },
        },
        "next_query": {"type": ["string", "null"], "description": "What to search instead, or null."},
        "revised_claim": {"type": ["string", "null"], "description": "Narrower claim, or null."},
    },
    "required": ["verdict", "sources", "next_query", "revised_claim"],
    "additionalProperties": False,
}


@dataclass
class WebSource:
    url: str
    title: str
    excerpt: str
    publisher: str | None = None
    date: str | None = None
    credibility_score: float | None = None
    credibility_note: str | None = None


@dataclass
class ResearchResult:
    """What the loop settled on, and how it got there."""

    sources: list[WebSource] = field(default_factory=list)
    #: Set when the supervisor narrowed the claim to what the evidence supports.
    revised_claim: str | None = None
    rounds_used: int = 0
    verdict: str = "abandon"
    #: Plain-language account of the rejected rounds, shown when nothing passed.
    trail: list[str] = field(default_factory=list)

    @property
    def succeeded(self) -> bool:
        return self.verdict == "accept" and bool(self.sources)


# The server-side search tool, which runs on the provider's infrastructure -
# there is nothing to execute here. The type is version-pinned by this API and
# is not the bare {"type": "web_search"} the previous provider took; that shape
# is a 400 here, which degraded to "no sources found" on every claim rather
# than to an error anyone would notice.
_WEB_SEARCH_TOOL = {"type": "web_search_20260209", "name": "web_search"}

# How many searches the model may run inside one round. Unbounded, a single
# "find sources for this" round was measured at ~19s (2026-09-16): the model
# searched, read, searched again. One search is enough to gather context
# before answering - that round sits on the critical path in front of the
# first token - and two is enough to check a claim afterwards, where the
# supervisor decides whether another *round* is worth it anyway.
CONTEXT_SEARCHES = 1
RESEARCH_SEARCHES = 2


def _search_tool(max_uses: int) -> dict:
    return {**_WEB_SEARCH_TOOL, "max_uses": max_uses}


# ---------------------------------------------------------------------------
# Tavily: a search API proper. One HTTP call returns ranked pages with an
# excerpt each in 1-3s. The model's own search tool did the same job in
# 5-20s a round, because it searched, read and wrote JSON in one turn - and
# every round of the research phase sits inside a deadline, so the slow tool
# meant most claims went unchecked. With Tavily the model only judges.
# ---------------------------------------------------------------------------
_TAVILY_URL = "https://api.tavily.com/search"
_TAVILY_TIMEOUT_SECONDS = 8.0
# Forums and social feeds are where a claim's exact words turn up with no
# authority behind them; the supervisor would reject them anyway, so they
# are not worth the result slots.
_EXCLUDED_DOMAINS = [
    "facebook.com",
    "reddit.com",
    "quora.com",
    "pinterest.com",
    "x.com",
    "twitter.com",
    "youtube.com",
    "tiktok.com",
    "instagram.com",
    "alternatehistory.com",
]
_EXCERPT_CHARS = 1800


def tavily_available() -> bool:
    return bool(settings.tavily_api_key)


async def _tavily_search(
    query: str, *, depth: str = "basic", max_results: int = 5
) -> list[WebSource]:
    """One Tavily query. Empty on any failure - the caller has other queries
    in flight and a fallback tool; a search that fails must not fail the
    turn. `depth` "advanced" reads pages for better excerpts (two credits,
    ~3s); "basic" is one credit and ~2s."""
    key = settings.tavily_api_key
    if not key:
        return []
    body = {
        "query": query[:400],
        "search_depth": depth,
        "max_results": max_results,
        "include_answer": False,
        "include_raw_content": False,
        "exclude_domains": _EXCLUDED_DOMAINS,
    }
    if depth == "advanced":
        # Several passages per page rather than one: the line with the
        # price or the forecast is rarely the first relevant paragraph.
        body["chunks_per_source"] = 3
    try:
        async with httpx.AsyncClient(timeout=_TAVILY_TIMEOUT_SECONDS) as client:
            res = await client.post(
                _TAVILY_URL, json=body, headers={"Authorization": f"Bearer {key}"}
            )
            res.raise_for_status()
            data = res.json()
    except Exception:  # noqa: BLE001 - a failed search is an empty search
        logger.warning("tavily search failed", exc_info=True)
        return []

    sources: list[WebSource] = []
    for item in data.get("results", []) or []:
        url = item.get("url")
        content = (item.get("content") or "").strip()
        if not isinstance(url, str) or not url.startswith(("http://", "https://")) or not content:
            continue
        try:
            host = urlparse(url).hostname or None
        except ValueError:
            host = None
        sources.append(
            WebSource(
                url=url,
                title=str(item.get("title") or url)[:300],
                excerpt=content[:_EXCERPT_CHARS],
                publisher=(host or "")[:200] or None,
                date=(str(item["published_date"])[:20] if item.get("published_date") else None),
            )
        )
    return sources


_STOPWORDS = frozenset(
    "a an the and or but of to in on at by for with from as is are was were be been "
    "being that this these those it its into over under after before during than then "
    "so such which who whom whose what when where why how not no nor also both either "
    "because while although though whereas has have had having does do did done can "
    "could may might must shall should will would about between among within without "
    "their there they them his her he she we our you your i".split()
)


def _keyword_query(claim: str) -> str:
    """The claim boiled down to its content words - names, numbers, terms -
    which is how a person would type it into a search box. A second angle on
    the same claim: the verbatim sentence finds pages that discuss it in
    those terms, the keywords find pages that state the fact in their own."""
    words = re.findall(r"[A-Za-z][A-Za-z'-]+|\d[\d.,%-]*", claim)
    kept = [w for w in words if w.lower() not in _STOPWORDS and len(w) > 2]
    return " ".join(kept[:14])


def _round_queries(claim: str, guidance: str | None, first: bool) -> list[tuple[str, str]]:
    """The queries one round fires at once - the branches of the search. The
    first round takes two angles on the claim as written; a later round
    takes the supervisor's own suggestion alongside the (possibly narrowed)
    claim. Deduplicated, so a keyword query identical to the claim doesn't
    cost a second credit."""
    queries: list[tuple[str, str]] = [(claim, "advanced")]
    if not first and guidance:
        queries.append((guidance, "basic"))
    keywords = _keyword_query(claim)
    if keywords and keywords.lower() != claim.lower():
        queries.append((keywords, "basic"))
    seen: set[str] = set()
    unique: list[tuple[str, str]] = []
    for q, d in queries:
        if q.lower() not in seen:
            seen.add(q.lower())
            unique.append((q, d))
    return unique[:3]


def _merge_sources(batches: list[list[WebSource]], skip: set[str], cap: int = 8) -> list[WebSource]:
    """Interleave the branches' results so each angle gets a fair share of
    the cap, dropping duplicates and anything already judged."""
    merged: list[WebSource] = []
    seen = set(skip)
    for i in range(max((len(b) for b in batches), default=0)):
        for batch in batches:
            if i < len(batch) and batch[i].url not in seen:
                seen.add(batch[i].url)
                merged.append(batch[i])
                if len(merged) >= cap:
                    return merged
    return merged


async def _search_structured(prompt: str, max_uses: int) -> dict | None:
    """One search-and-summarise call. Goes to OpenAI's search tool first, by
    measurement, not preference: the same round on Claude's search tool was
    timed at 17-19s (search, read, search again, then write the JSON) against
    4-8s here, and every round of the research phase sits inside a fixed
    deadline - so the slower tool meant most claims went unchecked. Claude's
    tool is the fallback when this one fails, and the shared client already
    falls back the other way, so an outage on either side still gets a
    search."""
    try:
        return await openai_client.generate_structured(
            instructions=_SEARCH_INSTRUCTIONS,
            input_text=prompt,
            schema=_SEARCH_SCHEMA,
            schema_name="web_sources",
            tools=[_search_tool(max_uses)],
        )
    except Exception:
        logger.warning("search round on the fast tool failed; trying the primary", exc_info=True)
    try:
        return await generate_structured(
            instructions=cached(_SEARCH_INSTRUCTIONS),
            input_text=prompt,
            schema=_SEARCH_SCHEMA,
            schema_name="web_sources",
            tools=[_search_tool(max_uses)],
        )
    except Exception:
        logger.exception("web search round failed")
        return None


async def _search_round(
    claim: str, guidance: str | None, max_uses: int = RESEARCH_SEARCHES
) -> list[WebSource]:
    prompt = f"CLAIM:\n{claim}"
    if guidance:
        prompt += (
            f"\n\nA previous search for this claim was rejected. What to do "
            f"differently:\n{guidance}"
        )
    payload = await _search_structured(prompt, max_uses)
    if payload is None:
        return []

    sources: list[WebSource] = []
    for item in payload.get("sources", [])[:4]:
        url = (item or {}).get("url")
        if not isinstance(url, str) or not url.startswith(("http://", "https://")):
            continue
        sources.append(
            WebSource(
                url=url,
                title=str(item.get("title") or url)[:300],
                excerpt=str(item.get("excerpt") or "")[:400],
                publisher=(str(item["publisher"])[:200] if item.get("publisher") else None),
                date=(str(item["date"])[:20] if item.get("date") else None),
            )
        )
    return sources


async def _supervise(claim: str, sources: list[WebSource]) -> dict:
    listing = "\n\n".join(
        f"[{i + 1}] {s.title}\nURL: {s.url}\nPublisher: {s.publisher or 'unknown'}\n"
        f"Date: {s.date or 'unknown'}\nPassage: {s.excerpt}"
        for i, s in enumerate(sources)
    )
    try:
        return await generate_structured(
            instructions=cached(_SUPERVISOR_INSTRUCTIONS),
            input_text=f"CLAIM:\n{claim}\n\nSOURCES:\n{listing}",
            schema=_SUPERVISOR_SCHEMA,
            schema_name="source_audit",
        )
    except Exception:
        logger.exception("supervisor round failed")
        return {}


async def gather_context(queries: list[str], depth: str = "basic") -> list[WebSource]:
    """One search round, scored, for use as *context* before generating.

    Runs speculatively, alongside document retrieval, and is thrown away if
    the workspace turned out to have something. That makes it latency the user
    never pays for when it isn't needed - and, when it is, latency that
    happened while the database was being queried anyway.

    Deliberately *one* call, with no supervision pass: there is no claim to
    judge these against yet, because the answer hasn't been written. Scoring
    them here would be scoring relevance to a question, which is what the
    search already did. The supervisor's real work - does this passage state
    the specific thing the answer ended up asserting - happens per claim, in
    `research_claim`, once there is something to check.
    """
    if not queries:
        return []
    if tavily_available():
        # Every planned query at once, results interleaved so each gets a
        # fair share of the cap. Basic depth, by measurement: four queries
        # in parallel come back in ~2.7s at basic and ~6s at advanced, and
        # this wait sits in front of the first token. The per-claim research
        # afterwards uses advanced depth for whatever the draft could not
        # cite.
        batches = await asyncio.gather(
            *(_tavily_search(q, depth=depth, max_results=5) for q in queries[:4]),
            return_exceptions=True,
        )
        return _merge_sources([b for b in batches if isinstance(b, list)], set(), cap=8)
    return await _search_round(queries[0], guidance=None, max_uses=CONTEXT_SEARCHES)


async def research_claim(
    claim: str, seed: list[WebSource] | None = None
) -> ResearchResult:
    """Search, judge, and keep going until it's good enough or it clearly won't be.

    With a search API in hand this is a tree search rather than a chain: each
    round fires two or three queries at once - the claim as written, its
    keywords, and in later rounds the supervisor's own suggestion - merges
    what they return, and judges the lot in one call. Where the old loop did
    search, judge, search, judge in sequence (20-40s a claim), this settles
    most claims in one round of ~5s and the rest in two. Without a search
    API it falls back to the model's own search tool, one query a round.

    `seed` is a set of sources already in hand - the pre-answer web search
    that came back after the answer had to go ahead without it. They join
    the first round's results and are judged with them. Each claim gets its
    own copies: the supervisor writes its verdict onto the source objects,
    and several claims judge the same set at once."""
    result = ResearchResult()
    current_claim = claim
    guidance: str | None = None
    pending_seed = [replace(s) for s in seed] if seed else []
    judged_urls: set[str] = set()
    use_api = tavily_available()

    for round_index in range(MAX_ROUNDS):
        result.rounds_used = round_index + 1

        if use_api:
            queries = _round_queries(current_claim, guidance, first=round_index == 0)
            batches = await asyncio.gather(
                *(_tavily_search(q, depth=d, max_results=5) for q, d in queries),
                return_exceptions=True,
            )
            found = [b for b in batches if isinstance(b, list)]
            sources = _merge_sources([pending_seed, *found], judged_urls)
        elif pending_seed:
            sources = pending_seed
        else:
            sources = await _search_round(current_claim, guidance)
        pending_seed = []

        if not sources:
            result.trail.append(
                f"Round {result.rounds_used}: no sources addressed the claim."
            )
            guidance = "The previous query returned nothing on point. Try broader terms."
            continue
        judged_urls.update(s.url for s in sources)

        judgement = await _supervise(current_claim, sources)
        verdict = judgement.get("verdict")
        scored_by_url = {
            str(entry.get("url")): entry
            for entry in judgement.get("sources", [])
            if isinstance(entry, dict) and entry.get("url")
        }
        for source in sources:
            entry = scored_by_url.get(source.url) or {}
            try:
                source.credibility_score = float(entry.get("score"))
            except (TypeError, ValueError):
                source.credibility_score = None
            note = entry.get("note")
            source.credibility_note = str(note)[:400] if note else None

        # The supervisor's verdict is advisory; the floor is not. A round is
        # only accepted if something actually cleared the bar, whatever the
        # model called it.
        kept = [
            s
            for s in sources
            if s.credibility_score is not None and s.credibility_score >= CREDIBILITY_FLOOR
        ]

        if verdict == "accept" and kept:
            result.sources = sorted(kept, key=lambda s: s.credibility_score or 0, reverse=True)[:4]
            result.verdict = "accept"
            if current_claim != claim:
                result.revised_claim = current_claim
            return result

        if verdict == "revise" and judgement.get("revised_claim"):
            narrowed = str(judgement["revised_claim"])[:600]
            result.trail.append(
                f"Round {result.rounds_used}: sources supported something narrower - "
                f"retried as \"{narrowed}\"."
            )
            # Sources that cleared the bar for the narrower claim are kept
            # in hand: if the next round finds nothing better they still
            # back what the supervisor said they back.
            current_claim = narrowed
            guidance = str(judgement.get("next_query") or "") or None
            continue

        if verdict == "abandon":
            result.trail.append(
                f"Round {result.rounds_used}: judged not verifiable by web search."
            )
            result.verdict = "abandon"
            return result

        rejected = "; ".join(
            f"{s.url} ({s.credibility_note})" for s in sources if s.credibility_note
        )
        result.trail.append(f"Round {result.rounds_used}: rejected - {rejected or 'weak sources'}.")
        guidance = str(judgement.get("next_query") or "") or (
            "The previous sources were not credible enough. Look for the primary source."
        )

    result.verdict = "exhausted"
    return result

"""Writing an answer and then checking it - the part every chat surface shares.

There are two ways to ask Clardentity something: the app, signed in, and the
try-it-here demo on the landing page. They used to answer through different
code. The demo was a deliberately small thing - the fast model, the mode's
instructions, and the text streamed back - and so a visitor asking
Decision-making got prose with no verdict box and no gist card, and a
visitor asking Finder got an answer with no claims checked, which is the one
thing the product exists to do. The demo's whole job is to show the product,
and it was showing a different one.

So the answer itself lives here, once. Everything from "the context is
ready" to "every claim is scored" runs through this module for both
surfaces: the same model routing, the same streamed gist, the same verdict
box, the same claim extraction, verification, per-claim research,
blind second look and score. What stays with each caller is what genuinely
differs - who is asking, where the history comes from, and whether anything
is written down. The app persists every step; the demo persists nothing.

The shape is a run object rather than one function because the callers
interleave their own work between the phases - the app saves the draft and
announces it between writing and checking - and both need the same events
in the same order around that.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field
from typing import Any

from app.core.config import settings
from app.schemas.chat import ClaimOut, EvidenceOut
from app.services.claim_parser import (
    ClaimTagStripper,
    CruxSplitter,
    extract_claims,
    extract_crux,
    split_leading_sentence,
    strip_claim_tags,
)
from app.services.confidence_scoring import (
    MessageScore,
    ScoredClaim,
    ScoringWeights,
    build_scored_evidence,
    compute_claim_score,
    compute_message_score,
    rescore_after_reconciliation,
)
from app.services.decision_classifier import NO_DECISION
from app.services.devils_advocate import generate_counterfactual
from app.services.output_cleanup import clean_output
from app.services.prompt_builder import build_context_block, build_conversation_input
from app.services.reflection_agent import reflect_and_revise
from app.services.retrieval import RetrievedChunk
from app.services.taxonomy import describe_bias
from app.services.verification_agent import reconcile_gray_area, verify_claim
from app.services.web_research import WebSource, research_claim, tavily_available

logger = logging.getLogger("clardentity.answer")

# Unsupported claims are researched concurrently, one agent each. Was two,
# which left the rest of a six-claim answer labelled as if nobody had looked
# - "0 of 6 claims backed by a source" on a textbook account of Indian
# independence. Six covers nearly every answer whole; each agent runs at most
# two search+judge rounds (web_research.MAX_ROUNDS), and they all share the
# deadline below, so the worst case is bounded in both calls and time.
MAX_RESEARCHED_CLAIMS = 6

# How long the answer waits for the speculative web search that runs when
# the workspace has nothing to say. Measured 2026-09-16: 19 of the 25 seconds
# a user waited before the first token were this one call. Past the budget
# the answer goes ahead without web context; the per-claim research after
# the answer still finds and attaches sources, so what's lost is inline
# markers in the first draft, not the checking.
PRE_SEARCH_BUDGET_SECONDS = 10.0

# The whole per-claim research phase, however many agents are in it.
#
# Measured 2026-09-16: a search round is 5-20s depending on the day and the
# tool, a supervisor round ~3s, so a claim that takes two rounds to settle
# costs 20-40s. This runs after the answer is on screen and the composer is
# live - the reader sees "Checking claims" under a finished answer - so the
# trade is a longer wait for the verdict against claims left unchecked, and
# unchecked claims were the complaint ("0 of 6 backed by a source" on a
# textbook history answer). Agents run concurrently, so this is a wall-clock
# cap on the phase, not a per-claim one.
RESEARCH_DEADLINE_SECONDS = 45.0

# How long a finished answer waits for the verdict box (Decision-making /
# Thought coach) before going out without it. The box normally lands well
# before the last token; this is for the short answer that beats it, so the
# box still fills the slot the client is holding rather than dropping in
# above an answer already being read.
REVIEW_GRACE_SECONDS = 4.0


async def no_text() -> AsyncIterator[dict]:
    """A generation that produces nothing, for a turn whose answer is a
    picture. Shaped like a real one so every consumer downstream - the crux
    splitter, the claim parser, the persistence - works unchanged on an
    empty string rather than needing to know about this case."""
    yield {"type": "done", "full_text": ""}


def generation_model_for(mode: str, admin_settings: dict) -> str | None:
    """Which model writes the answer, by mode.

    An explicit admin override still wins: the smallest for the quick
    answer, the fast one for the modes whose quality gate is verification
    rather than deliberation, the flagship (None - the client's default) for
    the reasoning-heavy rest. See config for the measurements.
    """
    chosen = admin_settings.get("openai_model")
    if chosen:
        return chosen
    if mode == "rapid":
        return settings.anthropic_rapid_model
    fast_modes = {m.strip() for m in settings.fast_generation_modes.split(",") if m.strip()}
    if mode in fast_modes:
        return settings.anthropic_fast_model
    return None


def gate_event(
    guidance: dict | None,
    *,
    refined_confirmed: bool,
    clarifying_confirmed: bool,
    context_acknowledged: bool,
    context_rounds: int,
    mode_confirmed: bool,
    answered_a_gate: bool,
    making_image: bool,
    max_context_rounds: int,
) -> dict | None:
    """The one pre-answer question to stop on, as an SSE event, or None.

    Order matters and is the same everywhere:

    1. Sharpen the phrasing - judging whether more context or another mode
       is needed against a question that is still genuinely unclear is
       itself unreliable, so this resolves first.
    2. Pick from options - the wording is not ambiguous enough for one best
       rewrite, but the missing piece has a short enumerable set of answers.
    3. Ask why - a question about someone's own life has no useful answer
       until the reasons are on the table.
    4. Another companion - only once the question itself is settled.

    The first three never take turns: once the user has answered one
    ("(Clardentity asked: ...)" is in the content) only the mode suggestion
    may still follow, and only once. A request for a picture goes round all
    four - every one of them is about prose, and the one that fires would
    stop the turn having drawn nothing.

    The one exception is the "why" itself. A personal decision may need a
    few things understood before an answer fits - the reasons, the
    constraints, what a good outcome looks like - so after a context answer
    (context_rounds > 0) the next round may ask the next thing, up to
    `max_context_rounds`, while rewording and options stay closed. Until
    2026-10-19 the marker closed this too, so only one question was ever
    asked, and a tester found the decision companion answering before it
    had the whole picture.
    """
    if not guidance or making_image:
        return None

    # A question about the question that has been answered *or declined*.
    # Declining - "Keep mine", "Skip", "Answer without this" - re-sends the
    # message without the marker, so it used to count for nothing, and the
    # next call was free to ask a different kind of question: "Answer
    # without this" met a row of options instead of an answer (seen
    # 2026-10-20). Declining one is declining them all.
    settled = answered_a_gate or refined_confirmed or clarifying_confirmed or context_acknowledged

    if not settled and guidance.get("refined_question"):
        return {
            "event": "refined_question",
            "data": json.dumps(
                {
                    "refined_question": guidance["refined_question"],
                    "refinement_reason": guidance.get("refinement_reason"),
                }
            ),
        }

    if not settled and guidance.get("clarifying_options"):
        return {
            "event": "clarifying_options",
            "data": json.dumps(
                {
                    "question": guidance.get("clarifying_question"),
                    "options": guidance["clarifying_options"],
                }
            ),
        }

    if (
        not context_acknowledged
        and (not settled or context_rounds > 0)
        and context_rounds < max_context_rounds
        and guidance.get("context_question")
    ):
        return {
            "event": "context_question",
            "data": json.dumps({"question": guidance["context_question"]}),
        }

    if not mode_confirmed and guidance.get("suggested_mode"):
        return {
            "event": "mode_suggestion",
            "data": json.dumps(
                {
                    "suggested_mode": guidance["suggested_mode"],
                    "mode_reason": guidance.get("mode_reason"),
                }
            ),
        }

    return None


@dataclass
class Analysis:
    """Everything checking the answer produced."""

    scored_claims: list[ScoredClaim]
    #: Each claim's wording as it ships - reflection may have reworded the
    #: prose around the claims while keeping their count.
    shipped_text: list[str]
    claim_marker_lists: list[list[int]]
    live_sources: list[WebSource]
    research_notes: list[str]
    message_score: MessageScore
    #: The answer as it ships: reflection's revision, claim tags stripped.
    display_text: str
    #: The answer with its claim tags, after reflection - what the caller
    #: re-parses if it needs the claims as shipped.
    final_text: str
    counterfactual_text: str | None
    #: Still running when the verdict was ready. The app writes it to the row
    #: when it lands; the demo waits a little longer for it instead.
    counterfactual_pending: asyncio.Task | None
    decision_review: dict | None
    thinking_review: dict | None


@dataclass
class AnswerRun:
    """One answer, from the context to the scored claims.

    The caller supplies what only it can know - the question, the history,
    the documents it retrieved, the search it started, the instructions it
    built - and drives the phases in order:

        async for event in run.generate(): ...      # status, review, crux, delta
        # caller: save the draft, if it saves things
        async for event in run.review_grace(): ...  # the verdict box, if late
        # caller: announce the answer
        async for event in run.analyse(): ...       # a picture, if it lands
        run.analysis                                # claims, score, reviews
        await run.collect_image()                   # the picture, if still out
    """

    mode: str
    content: str
    #: Oldest first. Anything with .role, .content and .clarifier - the app
    #: passes Message rows, the demo passes plain turns.
    history: list[Any]
    chunks: list[RetrievedChunk]
    web_task: asyncio.Task | None
    search_started: float
    memory_summary: str | None
    #: Given the assembled input text, the provider stream to read.
    make_generation: Callable[[str], AsyncIterator[dict]]
    image_task: asyncio.Task | None = None
    image_only: bool = False
    #: A greeting or small talk (services/small_talk): no research context,
    #: and no gist - the reply is the whole message, shown as it is.
    conversational: bool = False
    review_task: asyncio.Task | None = None
    thinking_task: asyncio.Task | None = None
    decision_task: asyncio.Task | None = None
    web_enabled: bool = True
    scoring_weights: ScoringWeights | None = None
    mark: Callable[[str], None] = lambda phase: None

    # State, filled in as the phases run.
    full_text: str = ""
    crux_text: str | None = None
    #: The answer with its claim tags stripped - what the draft shows.
    draft_display_text: str = ""
    error: Exception | None = None
    web_sources: list[WebSource] = field(default_factory=list)
    late_search: asyncio.Task | None = None
    analysis: Analysis | None = None
    generated_image: dict | None = None
    _review_sent: bool = False
    _image_sent: bool = False
    _image_announced: bool = False

    # ------------------------------------------------------------------
    # The three things that can arrive at any moment, each sent once.
    # ------------------------------------------------------------------

    def _image_status_event(self) -> dict | None:
        """Said once, at the top of the stream: a picture is being made.

        Known before the first token, because the intent check runs before
        the instructions are built.
        """
        if self._image_announced or self.image_task is None:
            return None
        self._image_announced = True
        return {
            "event": "status",
            "data": json.dumps({"phase": "image", "label": "Making the image"}),
        }

    def _image_event(self) -> dict | None:
        if self._image_sent or self.image_task is None or not self.image_task.done():
            return None
        self._image_sent = True
        try:
            self.generated_image = self.image_task.result()
        except Exception:  # noqa: BLE001 - a failed picture never fails the answer
            logger.warning("image task failed", exc_info=True)
            self.generated_image = None
        if not self.generated_image:
            return None
        # The same dict that is stored on the message, so the live event and
        # a reload render from identical data.
        return {"event": "image", "data": json.dumps(self.generated_image)}

    def _review_event(self) -> dict | None:
        if self._review_sent:
            return None
        pending = self.review_task or self.thinking_task
        if pending is None or not pending.done():
            return None
        self._review_sent = True
        try:
            result = pending.result()
        except Exception:  # noqa: BLE001 - the box is optional
            return None
        if not result:
            return None
        key = "decision_review" if self.review_task is not None else "thinking_review"
        return {"event": "review", "data": json.dumps({key: result})}

    # ------------------------------------------------------------------
    # Phase 1: write it.
    # ------------------------------------------------------------------

    async def generate(self) -> AsyncIterator[dict]:
        """Stream the answer. Sets `error` instead of raising."""
        stripper = ClaimTagStripper()
        crux_splitter = CruxSplitter()

        # An early warning the client acts on: this answer is going to be a
        # long one, so offer the quick way out now rather than after a fixed
        # wait. The tell is that nothing matched and the only search
        # available is the model's own tool, which takes 5-20s a round.
        # Quick answers themselves never warn; there is nothing quicker.
        if (
            self.mode != "rapid"
            and not self.chunks
            and self.web_task is not None
            and not tavily_available()
        ):
            yield {
                "event": "status",
                "data": json.dumps(
                    {"phase": "slow", "label": "This one will take a little longer"}
                ),
            }

        # The wait for the web search happens here, inside the stream, so the
        # warning above reaches the client before it rather than after. A
        # pre-search that missed its budget is not thrown away: it keeps
        # running while the answer streams, and whatever it brings back
        # seeds the per-claim research afterwards.
        if self.web_task is not None:
            if self.chunks:
                self.web_task.cancel()
            else:
                remaining = max(
                    0.0,
                    PRE_SEARCH_BUDGET_SECONDS - (time.monotonic() - self.search_started),
                )
                try:
                    self.web_sources = await asyncio.wait_for(
                        asyncio.shield(self.web_task), timeout=remaining
                    )
                except asyncio.TimeoutError:
                    logger.info("web pre-search over budget; answering without web context")
                    self.web_sources = []
                    self.late_search = self.web_task
                except (asyncio.CancelledError, Exception):  # noqa: B014 - degrade, never fail
                    self.web_sources = []
        context_block = (
            "(None - this message is a greeting or small talk, not a question to research.)"
            if self.conversational
            else build_context_block(self.chunks, self.web_sources)
        )
        input_text = build_conversation_input(
            context_block, self.memory_summary, self.history, self.content
        )
        self.mark("context")

        # Named phases, so the wait says what is being waited on.
        yield {
            "event": "status",
            "data": json.dumps(
                {"phase": "reading", "label": "Reading your documents"}
                if self.chunks
                else {"phase": "searching", "label": "Searching the web"}
                if self.web_sources
                else {"phase": "thinking", "label": "Cogitating"}
            ),
        }

        # Sent first if it is already in hand; otherwise the client holds its
        # slot at the top of the bubble and it fills in when it lands.
        early = self._review_event()
        if early:
            self.mark("review")
            yield early

        # Before the first token rather than on it: when the picture is the
        # whole answer there are no tokens, so a status that waited for one
        # would never be sent.
        announcement = self._image_status_event()
        if announcement:
            yield announcement

        full_text = ""
        try:
            generation = no_text() if self.image_only else self.make_generation(input_text)
            async for event in generation:
                if event["type"] == "delta":
                    late = self._review_event()
                    if late:
                        self.mark("review")
                        yield late
                    announcement = self._image_status_event()
                    if announcement:
                        yield announcement
                    picture = self._image_event()
                    if picture:
                        self.mark("image")
                        yield picture
                    full_text += event["text"]
                    # The leading one-sentence crux goes out as its own event
                    # the moment it closes, and never as body text - the
                    # client shows it first, above a body that streams in
                    # behind a fold. See CruxSplitter.
                    crux_now, passthrough = crux_splitter.feed(event["text"])
                    if crux_now:
                        self.mark("crux")
                        yield {"event": "crux", "data": json.dumps({"text": clean_output(crux_now)})}
                    visible = stripper.feed(passthrough) if passthrough else ""
                    if visible:
                        yield {"event": "delta", "data": json.dumps({"text": visible})}
                elif event["type"] == "done":
                    full_text = event["full_text"]
            tail = stripper.feed(crux_splitter.flush())
            if tail:
                yield {"event": "delta", "data": json.dumps({"text": tail})}
        except Exception as exc:  # noqa: BLE001 - the caller turns this into an SSE error
            if self.decision_task is not None:
                self.decision_task.cancel()
            self.error = exc
            return

        # Pulled off the front before anything else touches the text, so
        # every downstream consumer - the draft, reflection, claim
        # extraction, the counterfactual - works from crux-free text.
        self.mark("generated")
        crux_text, full_text = extract_crux(full_text)
        if self.conversational:
            # "Hi there!" in a gist card reads as broken: the reply is one or
            # two sentences, shown whole. A crux the model wrote anyway goes
            # back in front of the rest.
            if crux_text:
                full_text = f"{crux_text} {full_text}".strip()
            crux_text = None
        elif crux_text is None:
            # The model sometimes skips the <crux> wrapper (the fast model in
            # particular). Every brief asks for the bottom line first, so the
            # first sentence is it - and without a gist there is no gist card
            # and no fold, and the answer lands as a wall of text.
            crux_text, full_text = split_leading_sentence(full_text)
            if crux_text is None and not self.image_only:
                logger.warning("no gist could be derived; answer opens with: %r", full_text[:160])
        self.crux_text = clean_output(crux_text) if crux_text else None
        self.full_text = full_text
        self.draft_display_text = clean_output(strip_claim_tags(full_text))

    async def review_grace(self) -> AsyncIterator[dict]:
        """A short answer can finish before the verdict box does; give it a
        moment, so the box is part of the answer the client is handed rather
        than arriving after the bubble has been swapped for it."""
        pending = self.review_task or self.thinking_task
        if pending is not None and not self._review_sent:
            await asyncio.wait({pending}, timeout=REVIEW_GRACE_SECONDS)
            late = self._review_event()
            if late:
                self.mark("review")
                yield late

    # ------------------------------------------------------------------
    # Phase 2: check it.
    # ------------------------------------------------------------------

    async def analyse(self) -> AsyncIterator[dict]:
        """Verify, research and score every claim. Sets `analysis`.

        Everything here is independent of everything else here, so it all
        goes at once. Claim verification runs against the *draft's* claims
        rather than waiting for reflection: reflection preserves the claim
        structure and only improves the prose inside it, and a revision that
        changes the claim count is discarded - so the claims being scored
        are the claims that ship.
        """
        full_text = self.full_text
        chunks = self.chunks
        parsed_claims = extract_claims(full_text)

        # The critique-and-rewrite pass is for reasoning: a Thinking chain or
        # a Decision case reads better for it. A Finder answer is a set of
        # checked facts - the check *is* its quality gate.
        reflection_task = (
            asyncio.create_task(reflect_and_revise(self.mode, full_text))
            if self.mode != "knowing"
            else None
        )
        if self.decision_task is not None:
            try:
                decision_result = await self.decision_task
            except Exception:  # noqa: BLE001 - screening scope degrades, nothing fails
                decision_result = NO_DECISION
        else:
            decision_result = NO_DECISION
        bias_category_id = decision_result.bias_category_id

        counterfactual_task = (
            asyncio.create_task(generate_counterfactual(self.draft_display_text))
            if self.draft_display_text
            else None
        )

        # Markers 1..len(chunks) are documents; anything above continues into
        # the web sources, in the order build_context_block numbered them.
        # `live_sources` grows below as per-claim research finds more.
        live_sources: list[WebSource] = list(self.web_sources)

        def source_excerpt(marker: int) -> str:
            if marker <= len(chunks):
                return chunks[marker - 1].chunk.content
            return live_sources[marker - len(chunks) - 1].excerpt

        def valid_markers(raw: list[int]) -> list[int]:
            limit = len(chunks) + len(live_sources)
            return [m for m in sorted(set(raw)) if 0 < m <= limit]

        # Per-claim, per-evidence verification plus cognitive-bias screening,
        # concurrently across claims.
        claim_marker_lists = [valid_markers(c.citation_markers) for c in parsed_claims]
        verifications = await asyncio.gather(
            *(
                verify_claim(
                    claim.claim_text,
                    [source_excerpt(m) for m in markers],
                    bias_category_id=bias_category_id,
                )
                for claim, markers in zip(parsed_claims, claim_marker_lists)
            )
        )

        # Verification is the long pole after the answer - it is also the
        # window in which a picture usually finishes.
        picture = self._image_event()
        if picture:
            self.mark("image")
            yield picture

        evidence_by_claim = [
            build_scored_evidence(markers, chunks, v.evidence, live_sources)
            for markers, v in zip(claim_marker_lists, verifications)
        ]

        # A claim nothing supports is where the search agent earns its keep:
        # there is a specific proposition to go and check. Every such claim
        # is researched at once, one agent per claim. Except a claim written
        # as the model's own opinion: there is nothing to check by design.
        research_notes: list[str] = []
        if self.web_enabled:
            targets = [
                i
                for i, ev in enumerate(evidence_by_claim)
                if not ev and not parsed_claims[i].is_opinion
            ][:MAX_RESEARCHED_CLAIMS]
            if targets:
                # The pre-answer search, if it finished late: its sources are
                # judged against every unsupported claim first.
                seed: list[WebSource] | None = None
                if self.late_search is not None:
                    try:
                        seed = await asyncio.wait_for(asyncio.shield(self.late_search), timeout=5.0)
                    except (asyncio.TimeoutError, asyncio.CancelledError, Exception):  # noqa: B014
                        seed = None
                # A deadline, not a hope. Whatever has come back when the
                # clock runs out is what gets used; claims still unsupported
                # stay unsupported, which is a true statement either way.
                try:
                    results = await asyncio.wait_for(
                        asyncio.gather(
                            *(
                                research_claim(parsed_claims[i].claim_text, seed=seed)
                                for i in targets
                            ),
                            return_exceptions=True,
                        ),
                        timeout=RESEARCH_DEADLINE_SECONDS,
                    )
                except asyncio.TimeoutError:
                    research_notes.append(
                        "Ran out of time checking this against outside sources."
                    )
                    results = [None] * len(targets)
                # Marker assignment is serial even though the searches were
                # not: every claim's sources need a distinct block of marker
                # numbers in `live_sources`.
                recheck: list[tuple[int, list[int]]] = []
                for i, research in zip(targets, results):
                    if research is None:
                        continue
                    if isinstance(research, BaseException) or not research.succeeded:
                        if not isinstance(research, BaseException):
                            # Say what was tried: "unsupported after three
                            # searches" is a stronger statement than
                            # "unsupported because nobody looked".
                            research_notes.extend(research.trail)
                        continue
                    first_marker = len(chunks) + len(live_sources) + 1
                    live_sources.extend(research.sources)
                    recheck.append(
                        (i, list(range(first_marker, first_marker + len(research.sources))))
                    )

                if recheck:
                    rechecked = await asyncio.gather(
                        *(
                            verify_claim(
                                parsed_claims[i].claim_text,
                                [source_excerpt(m) for m in found],
                                bias_category_id=bias_category_id,
                            )
                            for i, found in recheck
                        )
                    )
                    for (i, found), v in zip(recheck, rechecked):
                        claim_marker_lists[i] = found
                        evidence_by_claim[i] = build_scored_evidence(
                            found, chunks, v.evidence, live_sources
                        )

        self.mark("verified")
        scored_claims: list[ScoredClaim] = []
        for claim, verification, evidence in zip(parsed_claims, verifications, evidence_by_claim):
            claim_score, entailment_label = compute_claim_score(
                evidence,
                distorted=bool(verification.distortion_flag),
                opinion=claim.is_opinion,
            )
            scored_claims.append(
                ScoredClaim(
                    claim_index=claim.claim_index,
                    claim_text=clean_output(claim.claim_text),
                    claim_score=claim_score,
                    entailment_label=entailment_label,
                    distortion_flag=verification.distortion_flag,
                    distortion_explanation=verification.distortion_explanation,
                    bias_category=verification.bias_category,
                    evidence=evidence,
                )
            )

        # "Targeted Blind Sampling": claims that landed in the gray_area tier
        # get one independent second look. The second pass never sees the
        # tier just assigned, so it cannot rubber-stamp it.
        gray_area_indices = [
            i for i, c in enumerate(scored_claims) if c.entailment_label == "gray_area"
        ]
        if gray_area_indices:
            reconciliations = await asyncio.gather(
                *(
                    reconcile_gray_area(
                        scored_claims[i].claim_text,
                        [source_excerpt(m) for m in claim_marker_lists[i]],
                    )
                    for i in gray_area_indices
                ),
                return_exceptions=True,
            )
            for i, result in zip(gray_area_indices, reconciliations):
                if isinstance(result, BaseException):
                    continue
                c = scored_claims[i]
                c.reconciliation_note = result.note
                c.dynamic = result.dynamic
                # Re-derived from the evidence rather than clamped: clamping
                # produced exactly 81 and exactly 40 every time, which read
                # as a measurement and was a constant.
                rescored = rescore_after_reconciliation(c.evidence, result.pattern)
                if rescored is not None:
                    c.claim_score, c.entailment_label = rescored

        message_score = compute_message_score(
            scored_claims, self.scoring_weights or ScoringWeights()
        )

        final_text = full_text
        if reflection_task is not None:
            try:
                final_text, _was_revised = await reflection_task
            except Exception:  # noqa: BLE001 - a failed critique keeps the draft
                final_text = full_text

        # The Devil's Draft is not waited for here: it is a whole second
        # answer and was the last thing the verdict waited on. If it has
        # landed it ships with the verdict; if not, the caller decides.
        counterfactual_text: str | None = None
        counterfactual_pending: asyncio.Task | None = None
        if counterfactual_task is not None:
            if counterfactual_task.done():
                try:
                    counterfactual_text = counterfactual_task.result()
                except Exception:  # noqa: BLE001 - the comparison is optional
                    counterfactual_text = None
            else:
                counterfactual_pending = counterfactual_task

        decision_review = await self.review_task if self.review_task else None
        thinking_review = await self.thinking_task if self.thinking_task else None

        # The claims carry the sentence *as it ships*, not as drafted.
        # Reflection keeps the claim count (or is discarded), so the i-th
        # shipped claim is the i-th scored one.
        shipped = extract_claims(final_text)
        shipped_text = (
            [clean_output(s.claim_text) for s in shipped]
            if len(shipped) == len(scored_claims)
            else [c.claim_text for c in scored_claims]
        )

        self.analysis = Analysis(
            scored_claims=scored_claims,
            shipped_text=shipped_text,
            claim_marker_lists=claim_marker_lists,
            live_sources=live_sources,
            research_notes=research_notes,
            message_score=message_score,
            # strip_claim_tags preserves the model's own formatting between
            # claims exactly, matching what streaming already showed.
            display_text=clean_output(strip_claim_tags(final_text)),
            final_text=final_text,
            counterfactual_text=counterfactual_text,
            counterfactual_pending=counterfactual_pending,
            decision_review=decision_review,
            thinking_review=thinking_review,
        )

    async def collect_image(self) -> dict | None:
        """The picture, if one was still being made when checking finished,
        as an event to send - or None.

        Awaited rather than abandoned: the bytes are already paid for.
        """
        if self.image_task is None or self._image_sent:
            return None
        try:
            self.generated_image = await self.image_task
        except Exception:  # noqa: BLE001
            logger.warning("image task failed", exc_info=True)
            self.generated_image = None
        self._image_sent = True
        if not self.generated_image:
            return None
        return {"event": "image", "data": json.dumps(self.generated_image)}


def claims_out(analysis: Analysis) -> list[ClaimOut]:
    """The claims as the client reads them - the live event and a reload
    agree because both are built from the as-shipped wording."""
    return [
        ClaimOut(
            claim_index=c.claim_index,
            claim_text=text_as_shipped,
            claim_score=c.claim_score,
            entailment_label=c.entailment_label,
            distortion_flag=c.distortion_flag,
            distortion_explanation=c.distortion_explanation,
            **describe_bias(c.distortion_flag, c.bias_category),
            reconciliation_note=c.reconciliation_note,
            dynamic=c.dynamic,
            evidence=[
                EvidenceOut(
                    citation_marker=e.citation_marker,
                    document_id=e.document_id,
                    document_filename=e.document_filename,
                    excerpt=e.excerpt,
                    support_score=e.support_score,
                    relevance_score=e.relevance_score,
                    entailment_label=e.entailment_label,
                    source_type=e.source_type,
                    url=e.url,
                    credibility_score=e.credibility_score,
                    credibility_note=e.credibility_note,
                )
                for e in c.evidence
            ],
        )
        for c, text_as_shipped in zip(analysis.scored_claims, analysis.shipped_text)
    ]

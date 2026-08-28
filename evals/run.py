#!/usr/bin/env python
"""Run the policy eval suite against a live Clardentity backend and score it
in Langfuse.

    conda activate clardentity-evals
    python run.py --run-name baseline
    # ... change a prompt in backend/app/services/..., redeploy ...
    python run.py --run-name after-context-gate-tweak

Both runs land in the same Langfuse dataset ("clardentity-policy-evals") as
separate dataset runs, so the Langfuse UI's run-comparison view is the
before/after diff - that is the iteration loop this harness exists for.
"""

from __future__ import annotations

import argparse
import os
import sys
from collections import defaultdict
from pathlib import Path

from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).parent))

load_dotenv(Path(__file__).parent / ".env")
# ANTHROPIC_API_KEY for the judge lives in the main repo's .env, not
# duplicated here - one secret, one place it's allowed to leak from.
load_dotenv(Path(__file__).parent.parent / ".env", override=False)

from langfuse import Langfuse  # noqa: E402
from rich.console import Console  # noqa: E402
from rich.table import Table  # noqa: E402

from backend_client import BackendClient  # noqa: E402
from dataset import sync_dataset  # noqa: E402
from evaluators import ALL_EVALUATORS  # noqa: E402

console = Console()


def build_task(client: BackendClient):
    def task(*, item, **_kwargs):
        meta = item.metadata or {}
        inp = item.input or {}
        mode = inp["mode"]
        category = meta.get("category")

        if category == "companion_nickname" and meta.get("set_nickname"):
            nick = meta["set_nickname"]
            client.set_companion_name(nick["mode"], nick["name"])

        conv_id = client.new_conversation(title=f"eval: {item.id}")
        try:
            result = client.send_message(
                conv_id,
                inp["message"],
                mode,
                mode_confirmed=meta.get("mode_confirmed", True),
                context_acknowledged=meta.get("context_acknowledged", True),
                reasoning_lens=meta.get("reasoning_lens"),
            )
            final = result.final_message or {}
            output = {
                "answer_text": result.answer_text,
                "context_question_fired": result.has("context_question"),
                "mode_suggestion_fired": result.has("mode_suggestion"),
                "clarifier_fired": bool(final.get("clarifier")),
                "decision_review": final.get("decision_review"),
                "claims": final.get("claims"),
                "elapsed_seconds": next(
                    (d["elapsed_seconds"] for t, d in result.events if t == "_meta"), None
                ),
            }

            # The one two-turn case: answer the clarifying question with its
            # own first option, then judge the SECOND turn - a reply that
            # ignores which option was picked is the bug this case exists to
            # catch, and it can only be seen after the follow-up.
            if category == "clarifier_continuity" and output["clarifier_fired"]:
                clarifier = final["clarifier"]
                options = clarifier.get("options") or []
                if options:
                    chosen = options[0]
                    second = client.send_message(conv_id, chosen, mode)
                    output["first_turn_answer_text"] = output["answer_text"]
                    output["answer_text"] = second.answer_text
                    output["clarifier_context"] = (
                        f"They were asked: {clarifier.get('question')!r} "
                        f"and replied by choosing: {chosen!r}"
                    )

            # The second two-turn case: resend the identical message with
            # context_acknowledged=True and confirm the gate does not fire a
            # second time. This is the guarantee the frontend depends on to
            # avoid an interrogation - one question, never two.
            if category == "context_gate_not_twice" and output["context_question_fired"]:
                second = client.send_message(
                    conv_id, inp["message"], mode, context_acknowledged=True
                )
                output["second_context_question_fired"] = second.has("context_question")
                output["answer_text"] = second.answer_text

            return output
        finally:
            client.delete_conversation(conv_id)

    return task


def _score_value(ev) -> float:
    return ev.value if hasattr(ev, "value") else ev["value"]


def _score_name(ev) -> str:
    return ev.name if hasattr(ev, "name") else ev["name"]


def _print_report(result) -> None:
    by_metric: dict[str, list[float]] = defaultdict(list)
    failures: list[tuple[str, str, str]] = []

    for item_result in result.item_results:
        item_id = getattr(item_result.item, "id", "?")
        for ev in item_result.evaluations or []:
            name, value = _score_name(ev), _score_value(ev)
            by_metric[name].append(value)
            if value == 0:
                comment = ev.comment if hasattr(ev, "comment") else ev.get("comment", "")
                failures.append((item_id, name, comment or ""))

    table = Table(title=f"Clardentity policy evals - run '{result.run_name}'")
    table.add_column("Metric")
    table.add_column("Pass rate", justify="right")
    table.add_column("n", justify="right")
    for name in sorted(by_metric):
        vals = by_metric[name]
        rate = sum(vals) / len(vals)
        style = "green" if rate == 1 else ("yellow" if rate >= 0.5 else "red")
        table.add_row(name, f"[{style}]{rate:.0%}[/{style}]", str(len(vals)))
    console.print(table)

    if failures:
        console.print("\n[bold red]Failures[/bold red]")
        ftable = Table()
        ftable.add_column("Case")
        ftable.add_column("Metric")
        ftable.add_column("Why")
        for case_id, metric, comment in failures:
            ftable.add_row(case_id, metric, comment[:100])
        console.print(ftable)
    else:
        console.print("\n[bold green]No failures.[/bold green]")

    if result.dataset_run_url:
        console.print(f"\nFull trace-level detail: [link]{result.dataset_run_url}[/link]")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--run-name",
        default=None,
        help="Label for this run, shown in Langfuse's run-comparison view (e.g. 'baseline').",
    )
    parser.add_argument(
        "--api-base",
        default=os.environ.get(
            "CLARDENTITY_API_BASE", "https://clardentity-backend.onrender.com/api/v1"
        ),
        help="Point at http://localhost:8000/api/v1 to eval a local backend instead.",
    )
    parser.add_argument(
        "--max-concurrency",
        type=int,
        default=3,
        help="Kept modest by default - the backend is a single instance that cold-starts.",
    )
    args = parser.parse_args()

    for var in ("LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY", "ANTHROPIC_API_KEY"):
        if not os.environ.get(var):
            console.print(f"[red]Missing {var}[/red] - check evals/.env and the repo-root .env.")
            sys.exit(1)

    langfuse = Langfuse(
        public_key=os.environ["LANGFUSE_PUBLIC_KEY"],
        secret_key=os.environ["LANGFUSE_SECRET_KEY"],
        host=os.environ.get("LANGFUSE_HOST", "https://cloud.langfuse.com"),
    )

    console.print(f"[dim]Target: {args.api_base}[/dim]")
    sync_dataset(langfuse)
    dataset = langfuse.get_dataset("clardentity-policy-evals")
    console.print(f"[dim]{len(dataset.items)} cases loaded[/dim]")

    client = BackendClient(args.api_base)
    client.ensure_account()
    client.ensure_workspace()

    try:
        result = dataset.run_experiment(
            name="Clardentity policy evals",
            run_name=args.run_name,
            description="Deterministic + LLM-judge checks against explicit product policies.",
            task=build_task(client),
            evaluators=ALL_EVALUATORS,
            max_concurrency=args.max_concurrency,
        )
    finally:
        client.close()

    langfuse.flush()
    _print_report(result)


if __name__ == "__main__":
    main()

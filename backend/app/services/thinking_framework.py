"""The client's Thinking Framework Matrix, as prompt guidance.

The matrix's own thesis (its section 9) is that "one need = one thinking
style" is the wrong model: what helps is a *combination*, applied in a
*sequence*, with a counterbalance against the dominant mode. Until now this
codebase did exactly the thing the matrix argues against - it handed the model
a flat list of eleven lenses and asked it to pick one.

The eleven types in the matrix are the eleven lenses already in
prompt_builder.REASONING_LENS_INSTRUCTIONS: ABS/ANL/ASS/CON/CRE/CRI/DIV/CONV/
LIN/NL/META are abstract, analytical, associative, concrete, creative,
critical, divergent, convergent, linear, non_linear, meta_cognitive. So none
of this is new vocabulary; it is instruction about how to combine what is
already there.

What is embedded and what is not
--------------------------------
Embedded: the demand-to-combination rules (matrix section 5), the
counterbalancing principle (section 1), the metacognition overlay (section 1),
the sequence principle (sections 1 and 9), and the monitoring/escalation
fields (section 8).

Not embedded: the 25-row need-category table (section 3) and the style x type
compatibility matrix (section 4). Section 5 generalises the same 25 rows into
eleven cognitive demands, and it keys off what the question *demands* rather
than requiring us to first classify it into one of 25 buckets - which would be
another model call, another failure mode, and a much larger prompt on every
single turn. The five styles (Synthesist/Idealist/Pragmatist/Analyst/
Problem-solver) describe a person's habitual working orientation; they are
meaningful for a human choosing how to approach their own week and much less
so for a model choosing how to answer one question. If the 25-row table turns
out to earn its cost, it belongs behind the existing decision classifier
rather than in every prompt.
"""

# Matrix section 5, verbatim in substance: the cognitive demand a question
# makes, and the combination of types that serves it. Kept as a table the
# model reads and matches against, not as a classification we perform - the
# demand is usually obvious from the question, and a wrong up-front label is
# worse than no label.
_DEMAND_RULES: tuple[tuple[str, str], ...] = (
    ("Exploration / generating possibilities", "divergent + associative + creative, before any converging"),
    ("Evaluating evidence", "analytical + critical; add meta-cognitive when bias or uncertainty is material"),
    ("Deciding / selecting", "analytical + critical + convergent"),
    ("Procedure / execution", "concrete + linear + convergent"),
    ("Complex or interacting systems", "abstract + non-linear + meta-cognitive, then analytical/critical to test the model"),
    ("Emotion / self-regulation", "meta-cognitive + critical + associative, grounded in concrete when it drifts abstract"),
    ("Relationships / social understanding", "associative + critical + meta-cognitive; separate observed behaviour from inferred motive"),
    ("Learning / acquiring a skill", "meta-cognitive + analytical + convergent; add associative/creative for transfer"),
    ("Safety / risk", "critical + analytical + convergent + linear; emphasise concrete action and monitoring"),
    ("Ethical deliberation", "abstract + critical + meta-cognitive, grounded in concrete evidence"),
    ("Long-horizon planning", "abstract + meta-cognitive + critical, then convergent + linear for implementation"),
)

# Matrix section 1. Pairing a dominant approach with its opposite is what
# stops a single mode running away with the answer.
_COUNTERBALANCES = (
    "creative <-> critical",
    "divergent <-> convergent",
    "abstract <-> concrete",
    "non-linear <-> linear",
    "generation <-> evaluation",
)


def thinking_framework_block() -> str:
    """Guidance for choosing *how* to reason. Never shown to the user."""
    demands = "\n".join(f"- {demand}: {combination}" for demand, combination in _DEMAND_RULES)
    return (
        "HOW TO REASON THROUGH THIS.\n\n"
        "Do not pick a single mode of thinking. Identify what the question "
        "actually demands, apply the combination that serves it, and move "
        "through it in a sequence rather than all at once. The usual shape is: "
        "broaden the problem space, structure the information, test the "
        "assumptions, converge on an answer, make it concrete, then say what "
        "would show you were wrong.\n\n"
        f"DEMAND -> COMBINATION:\n{demands}\n\n"
        "COUNTERBALANCE. Whichever mode dominates, deliberately apply its "
        "opposite once before concluding: "
        + "; ".join(_COUNTERBALANCES)
        + ". A one-note answer is the failure this prevents.\n\n"
        "META-COGNITIVE OVERLAY. When the question involves assumptions you "
        "cannot check, strong emotion, competing values, high stakes, or "
        "circumstances that may have changed, explicitly examine your own "
        "reasoning as part of the work - not as a disclaimer at the end.\n\n"
        "This is instruction about method, and the method is never the "
        "subject. Do not name these types, announce which you selected, "
        "label sections with them, or describe your own process in these "
        "terms. The reader wants the thinking, not a report on it."
    )


def monitoring_block() -> str:
    """Matrix section 8's last two fields.

    The monitoring question and the escalation point are the parts of the
    framework that most change what an answer is worth. A recommendation with
    no stated way to tell whether it is working is advice you cannot act on
    twice, and the escalation point is the difference between a companion that
    helps you think and one that quietly stands in for a professional.
    """
    return (
        "Close by making the answer checkable, in the natural voice of the "
        "answer rather than as labelled sections:\n"
        "- Say what evidence would show this is working, or would show it is "
        "wrong. Be specific enough that they could actually notice it.\n"
        "- If this is the sort of question where acting on a wrong answer is "
        "expensive or hard to reverse - health, legal exposure, money at "
        "risk, safety, anything affecting someone else's wellbeing - say "
        "plainly what would warrant a qualified professional rather than "
        "further reasoning. Say it once, in a sentence, without hedging the "
        "rest of the answer into uselessness."
    )


# Matrix section 6, for Decision mode only: selecting between options is a
# different job from reasoning about a problem, and the tree is about
# selection.
def decision_tree_block() -> str:
    return (
        "SELECTING BETWEEN OPTIONS.\n"
        "- Is the problem concrete and current, or abstract and systemic? "
        "Ground it in specifics for the first; reason about principles and "
        "second-order effects for the second.\n"
        "- Is the task open-ended or selection-focused? Generate options "
        "before narrowing; once narrowing, apply criteria consistently to "
        "every option rather than arguing for a favourite.\n"
        "- Do the options interact, or does order matter between them? Say so "
        "- a comparison that treats interdependent choices as independent is "
        "wrong in a way the reader cannot see.\n"
        "- Where are the assumptions, and which of them would change the "
        "recommendation if false? Name those explicitly.\n"
        "- Counterbalance before recommending: having reasoned your way to an "
        "option, argue the strongest case against it once."
    )

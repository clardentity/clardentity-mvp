/** The four modes of the single cognitive companion.
 *
 *  One definition shared by the landing page and the composer, so the words a
 *  visitor reads before signing up are the same ones they see when choosing a
 *  mode. `hint` is the one-liner on the button; `when` tells someone which to
 *  reach for, which is what the mode names alone never conveyed.
 */
export const COGNITIVE_MODES = [
  {
    value: "knowing",
    label: "Knowing",
    hint: "Find out what's true",
    when: "When you need a fact, and you need to see where it came from.",
    detail:
      "Answers stay close to your documents, and every claim carries its source. When the answer isn't in what you've given it, it says so instead of filling the gap.",
  },
  {
    value: "thinking",
    label: "Thinking",
    hint: "Reason it through",
    when: "When the answer depends on the reasoning, not just the conclusion.",
    detail:
      "Works through a problem in visible steps you can follow and challenge. Choose a reasoning lens — critical, creative, step-by-step — to change how it approaches the problem.",
  },
  {
    value: "decision",
    label: "Decision",
    hint: "Weigh the options",
    when: "When you're choosing between paths and want the trade-offs laid out.",
    detail:
      "Lays out the real options and what each one costs you, then makes a recommendation. It also flags the cognitive biases that tend to distort this kind of decision — before you commit, not after.",
  },
  {
    value: "learning",
    label: "Learning",
    hint: "Understand it properly",
    when: "When you want to actually learn something, not just be told the answer.",
    detail:
      "Meets you at your level and builds from there, drawing on established learning science. Ends by checking you've actually got it.",
  },
] as const;

export type CognitiveMode = (typeof COGNITIVE_MODES)[number]["value"];

export const MODE_BY_VALUE: Record<CognitiveMode, (typeof COGNITIVE_MODES)[number]> =
  Object.fromEntries(COGNITIVE_MODES.map((m) => [m.value, m])) as Record<
    CognitiveMode,
    (typeof COGNITIVE_MODES)[number]
  >;

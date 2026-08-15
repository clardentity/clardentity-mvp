/** The four modes of the single cognitive companion.
 *
 *  One definition shared by the landing page and the composer, so the words a
 *  visitor reads before signing up are the same ones they see when choosing a
 *  mode. Wording follows the client's linguistic recommendations.
 *
 *  `label` is the short name on the composer pill; `companion` is the full
 *  name the marketing copy uses ("Knowing Companion"); `hint` is the promise;
 *  `when` tells someone which to reach for; `cta` is the invitation on the
 *  landing page.
 */
export const COGNITIVE_MODES = [
  {
    value: "knowing",
    label: "Knowing",
    companion: "Knowing Companion",
    hint: "Find out facts",
    when: "When you need a fact you can trust and the evidence behind it.",
    cta: "Explore the unknown.",
    detail:
      "Answers stay close to your documents, and every claim carries its source. When the answer isn't in what you've given it, it says so instead of filling the gap.",
  },
  {
    value: "thinking",
    label: "Thinking",
    companion: "Thinking Companion",
    hint: "Think correctly",
    when: "When you want to improve your thinking skills, not just the conclusion.",
    cta: "Try thinking it through.",
    detail:
      "Works through a problem in visible steps you can follow and challenge. Choose a reasoning lens - critical, creative, step-by-step - to change how it approaches the problem.",
  },
  {
    value: "decision",
    label: "Decision",
    companion: "Decision-making Companion",
    hint: "Make wise choices",
    when: "When you want to choose between unbiased and biased decisions.",
    cta: "Try making the correct decision.",
    detail:
      "Lays out the real options and what each one costs you, then makes a recommendation. It also flags the cognitive biases that tend to distort this kind of decision - before you commit, not after.",
  },
  {
    value: "learning",
    label: "Learning",
    companion: "Learning Companion",
    hint: "Expand your knowledge and skills",
    when: "When you want to acquire knowledge and skills, not just be informed.",
    cta: "Try learning something new.",
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

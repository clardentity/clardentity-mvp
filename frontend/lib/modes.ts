/** The seven modes of the single cognitive companion.
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
    label: "Thinking-trainer",
    companion: "Thinking-trainer Companion",
    hint: "Think correctly",
    when: "When you want to improve your thinking skills, not just the conclusion.",
    cta: "Try thinking it through.",
    detail:
      "Works through a problem in visible steps you can follow and challenge. Choose a reasoning lens - critical, creative, step-by-step - to change how it approaches the problem.",
  },
  {
    value: "decision",
    label: "Decision-making",
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
  {
    value: "mentoring",
    label: "Mentoring",
    companion: "Mentoring Companion",
    hint: "Get guided toward a goal",
    when: "When you want guidance from someone who's been where you're headed.",
    cta: "Try getting mentored.",
    detail:
      "Advises the way a person who has actually done this before would - honest about what's hard and how long it really takes, not just encouraging.",
  },
  {
    value: "therapy",
    // Renamed from "Psycho-Therapy" - that word, and "counselling", read as a
    // claim to a clinical service this product doesn't provide and isn't
    // licensed for. The mode itself is unchanged; only the naming is.
    label: "Reflect & Relieve",
    companion: "Reflect & Relieve Companion",
    hint: "Talk it through",
    when: "When you want supportive, on-demand conversation to think and feel things through.",
    cta: "Try talking it through.",
    detail:
      "Listens fully and reflects back what's actually being said, helping you notice your own patterns. Companionship, not clinical treatment - it says so plainly when something calls for a licensed professional.",
  },
  {
    value: "creative",
    label: "Creative",
    companion: "Creative Companion",
    hint: "Make something",
    when: "When you want help writing, coding, or building a document from scratch.",
    cta: "Try making something.",
    detail:
      "Writes, codes, and builds structured documents - reports, presentations, spreadsheets - offered as an actual file, not just described in chat.",
  },
] as const;

export type CognitiveMode = (typeof COGNITIVE_MODES)[number]["value"];

export const MODE_BY_VALUE: Record<CognitiveMode, (typeof COGNITIVE_MODES)[number]> =
  Object.fromEntries(COGNITIVE_MODES.map((m) => [m.value, m])) as Record<
    CognitiveMode,
    (typeof COGNITIVE_MODES)[number]
  >;

/** Visible in every picker, selectable in none of them yet - shown grayed
 *  out with a "Soon" badge rather than hidden outright, so the announcement
 *  (the landing page carousel) and the composer agree on what exists. The
 *  backend already answers requests in these modes; this is purely about
 *  when the UI lets someone start one. */
export const COMING_SOON_MODES: readonly CognitiveMode[] = ["mentoring", "therapy", "creative"];

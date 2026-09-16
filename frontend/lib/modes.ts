/** The modes of the single cognitive companion, in the order the pickers
 *  show them (the client's sequence: the checked modes from most to least
 *  common, then the roadmap).
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
    // "Tailored" (the client's name, over "Knowing" / "Verified Knowing"):
    // the answer is fitted to your documents and your profile, and every
    // claim in it is checked against a source.
    label: "Tailored",
    companion: "Tailored Companion",
    hint: "Checked against your sources",
    when: "When you need an answer fitted to your documents and checked claim by claim.",
    cta: "Explore the unknown.",
    detail:
      "Answers stay close to your documents, and every claim carries its source. When the answer isn't in what you've given it, it says so instead of filling the gap.",
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
    value: "creative",
    // "Co-Creative": it works *with* you on a document, it doesn't produce
    // one unasked - the client's preferred framing over plain "Creative".
    label: "Co-Creative",
    companion: "Co-Creative Companion",
    hint: "Make something together",
    when: "When you want help writing, coding, or building a document from scratch.",
    cta: "Try making something.",
    detail:
      "Writes, codes, and builds structured documents - reports, presentations, spreadsheets - offered as an actual file, not just described in chat.",
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
    value: "legal",
    label: "Legal Companion",
    companion: "Legal Companion",
    hint: "Understand where you stand",
    when: "When you need a legal situation explained in plain language before you speak to a professional.",
    cta: "Try understanding your position.",
    detail:
      "Explains the rules that apply, the questions a lawyer will ask, and what to gather beforehand. Orientation, not legal advice - it says so, and points you to a professional for anything that turns on your specific facts.",
  },
] as const;

/** A mode the user can pick. */
export type PickableMode = (typeof COGNITIVE_MODES)[number]["value"];

/** Any mode a message can carry. `rapid` is the one that isn't in the
 *  picker: the server's no-gates, no-checking path, reached only through the
 *  "Quick answer" button while a slow answer is being written. */
export type CognitiveMode = PickableMode | "rapid";

export type ModeEntry = (typeof COGNITIVE_MODES)[number];

export const MODE_BY_VALUE: { [mode: string]: ModeEntry | undefined } = Object.fromEntries(
  COGNITIVE_MODES.map((m) => [m.value, m]),
);

/** The name shown for a mode wherever a message or chat carries one - the
 *  picker's label, or "Quick answer" for the unpickable quick path. */
export function modeLabel(value: string | null | undefined): string {
  if (!value) return "";
  if (value === "rapid") return "Quick answer";
  return MODE_BY_VALUE[value]?.label ?? value;
}

/** Visible in every picker, selectable in none of them yet - shown grayed
 *  out with a "Soon" badge rather than hidden outright, so the announcement
 *  (the landing page carousel) and the composer agree on what exists. The
 *  backend already answers requests in these modes; this is purely about
 *  when the UI lets someone start one. */
export const COMING_SOON_MODES: readonly PickableMode[] = [
  "mentoring",
  "therapy",
  "creative",
  // Announced, not built: no prompt behind it yet, and the backend's mode
  // validator doesn't accept it. It exists here so the pickers show the
  // roadmap the client asked for; it can't be started.
  "legal",
];

/** What a new chat opens in when nothing else has been chosen: the checked,
 *  cited mode the product is built around. The composer never waits on a
 *  mode pick - there is always one selected. */
export const DEFAULT_MODE: PickableMode = "knowing";

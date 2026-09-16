/* Phone-keyboard-style autocorrect for the composer, entirely in the
 * browser. Two Hunspell dictionaries (US and British English - Indian
 * English writes "colour", American users write "color", and neither is a
 * mistake) are fetched once, lazily, and parsed by nspell; when a word is
 * finished (space, punctuation, newline) and is spelled wrong in *both*, the
 * closest suggestion replaces it, with an undo. No model, no network call
 * per keystroke, nothing leaves the device.
 *
 * Why: the pre-answer checks read a message literally, so "recieve" or
 * "wat is the diffrence" reads as unclear and earns a clarifying question.
 * Cleaning the text as it's typed removes most of those. Desktop only by
 * default - phones have their own autocorrect, and two of them fight. */

type NSpell = {
  correct(word: string): boolean;
  suggest(word: string): string[];
};

let loading: Promise<Speller | null> | null = null;

export type Speller = {
  /** True if the word is fine in either dialect. */
  correct(word: string): boolean;
  /** Suggestions, US then British, deduplicated. */
  suggest(word: string): string[];
  /** Frequency rank of a common word (0 = "the"), or Infinity. Breaks ties
   *  between equally close suggestions the way a keyboard does: "wat" is
   *  one edit from both "what" and "watt", and only one of those is what
   *  anyone means. */
  rank(word: string): number;
};

async function fetchText(path: string): Promise<string> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.text();
}

/** Loads the dictionaries on first use. Resolves null if anything fails -
 *  autocorrect is a convenience, and the composer must not depend on it. */
export function loadSpeller(): Promise<Speller | null> {
  if (!loading) {
    loading = (async () => {
      try {
        const [{ default: nspell }, usAff, usDic, gbAff, gbDic, common] = await Promise.all([
          import("nspell"),
          fetchText("/dict/en-us.aff"),
          fetchText("/dict/en-us.dic"),
          fetchText("/dict/en-gb.aff"),
          fetchText("/dict/en-gb.dic"),
          fetchText("/dict/en-common.txt"),
        ]);
        const us = nspell({ aff: usAff, dic: usDic }) as unknown as NSpell;
        const gb = nspell({ aff: gbAff, dic: gbDic }) as unknown as NSpell;
        const ranks = new Map<string, number>();
        common.split(/\r?\n/).forEach((w, i) => {
          if (w && !ranks.has(w)) ranks.set(w, i);
        });
        return {
          correct: (w) => us.correct(w) || gb.correct(w),
          suggest: (w) => [...new Set([...us.suggest(w), ...gb.suggest(w)])],
          rank: (w) => ranks.get(w.toLowerCase()) ?? Number.POSITIVE_INFINITY,
        };
      } catch {
        return null;
      }
    })();
  }
  return loading;
}

/** Whether to run at all: fine-pointer devices (desktop). Phones bring
 *  their own keyboard correction. */
export function autocorrectSupported(): boolean {
  try {
    return window.matchMedia("(pointer: fine)").matches;
  } catch {
    return false;
  }
}

// Letters with an optional inner apostrophe ("don't"). Anything else - a
// URL, an email, a number, a hashtag, code - is left alone.
const WORD = /^[A-Za-z]+(?:'[A-Za-z]+)?$/;

/* Fixed corrections the dictionary can't make. Two kinds: chat shorthand
 * and dropped apostrophes, where the typed form is either a real word
 * ("cant", "wont", "ill") or ambiguous between equally close real words
 * ("wat" is one edit from "was", "what" and "watt"); and the lone
 * lowercase "i". These are what people type when typing fast, and they are
 * exactly what made the pre-answer check ask "did you mean...". */
const OVERRIDES: Record<string, string> = {
  i: "I",
  wat: "what",
  wats: "what's",
  whats: "what's",
  wen: "when",
  wer: "where",
  wht: "what",
  hw: "how",
  thn: "then",
  ur: "your",
  u: "you",
  pls: "please",
  plz: "please",
  thx: "thanks",
  bcoz: "because",
  bcz: "because",
  coz: "because",
  cuz: "because",
  becuase: "because",
  becasue: "because",
  alot: "a lot",
  dont: "don't",
  cant: "can't",
  wont: "won't",
  didnt: "didn't",
  doesnt: "doesn't",
  isnt: "isn't",
  wasnt: "wasn't",
  werent: "weren't",
  couldnt: "couldn't",
  wouldnt: "wouldn't",
  shouldnt: "shouldn't",
  havent: "haven't",
  hasnt: "hasn't",
  hadnt: "hadn't",
  arent: "aren't",
  im: "I'm",
  ive: "I've",
  youre: "you're",
  theyre: "they're",
  thats: "that's",
  hes: "he's",
  shes: "she's",
  lets: "let's",
  theres: "there's",
  heres: "here's",
};

/** Damerau-Levenshtein (with transposition), capped for speed. */
function editDistance(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i++) d[i][0] = i;
  for (let j = 0; j < cols; j++) d[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

function matchCase(source: string, target: string): string {
  if (source === source.toUpperCase() && source.length > 1) return target.toUpperCase();
  if (source[0] === source[0].toUpperCase()) return target[0].toUpperCase() + target.slice(1);
  return target;
}

/** The correction for one just-finished word, or null to leave it.
 *
 *  Conservative on purpose - a wrong correction costs more trust than a
 *  missed one: only plain lowercase words of three letters or more (a
 *  capital letter means a name, "Kochi" included, and acronyms are left
 *  alone); the suggestion has to be close - one edit for short words, two
 *  for long ones - and start with the same letter, which is what keyboard
 *  autocorrect weights most heavily too. Equally close candidates are
 *  settled by how common they are, and if neither is a common word at all
 *  the word is left as typed rather than guessed. */
export function correctionFor(
  word: string,
  speller: Speller,
  options: { ignore: ReadonlySet<string> },
): string | null {
  if (word.length > 24 || !WORD.test(word)) return null;
  if (word !== word.toLowerCase()) return null;
  if (options.ignore.has(word)) return null;
  const fixed = OVERRIDES[word];
  if (fixed) return fixed;
  if (word.length < 3 || speller.correct(word)) return null;

  const cap = word.length >= 6 ? 2 : 1;
  const candidates = speller
    .suggest(word)
    // Same first letter; and never an acronym for a lowercase word -
    // "https" is one edit from "HTTP", and nobody typing lowercase meant it.
    .filter((s) => WORD.test(s) && s[0].toLowerCase() === word[0] && s !== s.toUpperCase())
    .map((s) => ({ s, d: editDistance(word, s.toLowerCase(), cap), r: speller.rank(s) }))
    .filter(({ d }) => d <= cap)
    .sort((x, y) => x.d - y.d || x.r - y.r);
  if (candidates.length === 0) return null;
  const best = candidates[0];
  const rival = candidates[1];
  if (rival && rival.d === best.d && !Number.isFinite(best.r)) return null;
  return matchCase(word, best.s);
}

export type Fix = {
  /** The text with the word replaced. */
  text: string;
  /** Caret position after the replacement (same logical spot). */
  caret: number;
  from: string;
  to: string;
  /** Where the corrected word starts, for undo. */
  start: number;
};

/** Called after every edit. If the character just typed before `caret`
 *  finished a word, and that word wants correcting, returns the fix. */
export function fixAtBoundary(
  text: string,
  caret: number,
  speller: Speller,
  ignore: ReadonlySet<string>,
): Fix | null {
  if (caret < 2) return null;
  const boundary = text[caret - 1];
  if (!/[\s.,;:!?)]/.test(boundary)) return null;
  // Walk back over the word that ended at the boundary.
  let start = caret - 1;
  while (start > 0 && /[A-Za-z']/.test(text[start - 1])) start--;
  const word = text.slice(start, caret - 1);
  if (!word) return null;
  // Inside a URL, an email, a path or a dotted name ("nasa.gov")? The
  // whitespace-delimited chunk around the word tells: leave those whole.
  let chunkStart = start;
  while (chunkStart > 0 && !/\s/.test(text[chunkStart - 1])) chunkStart--;
  let chunkEnd = caret - 1;
  while (chunkEnd < text.length && !/\s/.test(text[chunkEnd])) chunkEnd++;
  const chunk = text.slice(chunkStart, chunkEnd);
  if (/[/@#_~]|:\/\/|\.[A-Za-z]|\d/.test(chunk)) return null;
  const to = correctionFor(word, speller, { ignore });
  if (!to || to === word) return null;
  const fixed = text.slice(0, start) + to + text.slice(caret - 1);
  return { text: fixed, caret: caret + (to.length - word.length), from: word, to, start };
}

/* Normalising the markup in text the bubble renders.
 *
 * The bubble renders a small fixed set - **bold**, *italic*, `code`, hyphen
 * bullets and numbered lists, pipe tables - and nothing else. The backend
 * (output_cleanup.py) already normalises anything it writes to exactly that
 * set; this is the same set of passes, applied on read, so messages stored
 * before that exist (with HTML, headings, "•" bullets, stripped markup) show
 * the same way as new ones. Two implementations that disagreed would show
 * old and new messages in different styles.
 */

const HTML_TAG = /<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^<>]*?)?\/?>/g;

// One canonical syntax each: ***x*** and __x__ become **x**, _x_ becomes
// *x*, strikethrough is dropped, link syntax becomes "text (url)".
// [\s\S] rather than the `s` flag: the flag needs an es2018 target and this
// project's tsconfig is lower.
const MARKDOWN_SPANS: Array<[RegExp, string]> = [
  [/\*\*\*([\s\S]+?)\*\*\*/g, "**$1**"],
  [/(?<![\w_])__([\s\S]+?)__(?![\w_])/g, "**$1**"],
  [/(?<![\w_])_(?!\s)([\s\S]+?)(?<!\s)_(?![\w_])/g, "*$1*"],
  [/~~([\s\S]+?)~~/g, "$1"],
  [/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1 ($2)"],
];

const ENTITIES: Array<[RegExp, string]> = [
  [/&amp;/g, "&"],
  [/&lt;/g, "<"],
  [/&gt;/g, ">"],
  [/&quot;/g, '"'],
  [/&#39;/g, "'"],
  [/&nbsp;/g, " "],
];

export function cleanMessageText(text: string): string {
  if (!text) return text;

  let out = text
    .replace(/```[a-zA-Z0-9_-]*\n?/g, "")
    .replace(HTML_TAG, "")
    // A heading becomes a bold line; rules and quote markers go; bullets
    // of any flavour become the hyphen the renderer recognises.
    .replace(/^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/gm, "**$1**")
    .replace(/^\s*(?:[-*_]\s*){3,}$/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^(\s*)[*+•]\s+(?=\S)/gm, "$1- ");

  for (const [pattern, replacement] of MARKDOWN_SPANS) {
    out = out.replace(pattern, replacement);
  }
  for (const [pattern, replacement] of ENTITIES) {
    out = out.replace(pattern, replacement);
  }

  // Em/en dashes become *spaced* hyphens. A straight character swap turns
  // "Great goal—Spanish" into "Great goal-Spanish", which reads as a
  // hyphenated compound rather than two clauses. [ \t] not \s, so a dash
  // opening a line can't swallow the newline before it.
  //
  // \u escapes, not literal characters: a repo-wide "replace dashes with
  // hyphens" sweep rewrites a literal class into /[----]/, which matches only
  // a hyphen and quietly turns this line into a no-op. It already did once.
  out = out.replace(/[ \t]*[\u2014\u2013\u2012\u2015][ \t]*/g, " - ");

  return out.replace(/\n{3,}/g, "\n\n").trim();
}

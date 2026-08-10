/* Cleaning markup out of text the bubble renders verbatim.
 *
 * The backend already does this for anything it writes, so new messages
 * arrive clean. This exists for the ones already in the database, written
 * before that - a stored `<strong>` would otherwise stay visible forever.
 * Same passes, deliberately: two implementations that disagree would show
 * old and new messages in different styles.
 */

const HTML_TAG = /<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^<>]*?)?\/?>/g;

// [\s\S] rather than the `s` flag: the flag needs an es2018 target and this
// project's tsconfig is lower.
const MARKDOWN_SPANS: Array<[RegExp, string]> = [
  [/\*\*\*([\s\S]+?)\*\*\*/g, "$1"],
  [/\*\*([\s\S]+?)\*\*/g, "$1"],
  [/(?<![\w*])\*(?!\s)([\s\S]+?)(?<!\s)\*(?![\w*])/g, "$1"],
  [/(?<![\w_])__([\s\S]+?)__(?![\w_])/g, "$1"],
  [/(?<![\w_])_(?!\s)([\s\S]+?)(?<!\s)_(?![\w_])/g, "$1"],
  [/~~([\s\S]+?)~~/g, "$1"],
  [/`([^`]+)`/g, "$1"],
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
    .replace(/^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/gm, "$1")
    .replace(/^\s*(?:[-*_]\s*){3,}$/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "");

  for (const [pattern, replacement] of MARKDOWN_SPANS) {
    out = out.replace(pattern, replacement);
  }
  for (const [pattern, replacement] of ENTITIES) {
    out = out.replace(pattern, replacement);
  }

  // Em/en dashes to hyphens, with the spacing an em dash implies.
  out = out.replace(/[----]/g, "-").replace(/\s+-\s+/g, " - ");

  return out.replace(/\n{3,}/g, "\n\n").trim();
}

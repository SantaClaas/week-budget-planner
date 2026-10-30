import type { Brand } from "../../brand.ts";
import type { Result } from "../../result.ts";

/**
 * An activity's name: trimmed, and 1 to 60 characters. Characters are counted as code points, the
 * way the database's `length()` counts them, so an emoji is one character in both.
 */
export type ActivityName = Brand<string, "ActivityName">;

/** The most characters (code points) a name can have. The database checks the same limit. */
export const MAX_NAME_CHARACTERS = 60;

/**
 * Splits text into graphemes, what a person sees as one character. Without `Intl.Segmenter`
 * (Firefox before 125) it splits into code points, so a cut may split an emoji made of several (see
 * docs/spec/browser-support.md).
 */
const segmenter =
  "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : undefined;
const splitGraphemes = (text: string): Iterable<string> =>
  segmenter ? Iterator.from(segmenter.segment(text)).map(({ segment }) => segment) : text;

/**
 * Gives a checked name its brand. Only the sanitizer and parser below call it, so this is the one
 * type assertion in the module.
 */
function brand(value: string): ActivityName {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- the one place a checked name becomes a brand (see Branded types in docs/guidelines/typescript.md).
  return value as ActivityName;
}

/**
 * The text trimmed and cut to the limit. The cut keeps whole graphemes, so an emoji made of several
 * code points, such as a flag, is kept or dropped as a whole, never split in half.
 */
function cut(text: string): string {
  let name = "";
  let characters = 0;
  for (const segment of splitGraphemes(text.trim())) {
    // oxlint-disable-next-line typescript/no-misused-spread -- code points are what is counted here, the way the database's length() counts them; the graphemes come from the Segmenter.
    characters += [...segment].length;
    if (characters > MAX_NAME_CHARACTERS) break;
    name += segment;
  }
  return name.trimEnd();
}

/** A name from storage or an import: cut to the limit, and "Untitled" when nothing is left. */
export const sanitizeActivityName = (text: string): ActivityName => brand(cut(text) || "Untitled");

/** A name as typed: cut to the limit, or `"empty"` when there is nothing but spaces. */
export function parseActivityName(text: string): Result<ActivityName, "empty"> {
  const name = cut(text);
  return name === "" ? "empty" : brand(name);
}

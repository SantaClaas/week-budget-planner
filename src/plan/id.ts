import { customAlphabet } from "nanoid";

import type { Brand } from "../brand.ts";

export type ActivityId = Brand<string, "ActivityId">;
export type BlockId = Brand<string, "BlockId">;

/**
 * nanoid-dictionary's `nolookalikesSafe`: no characters that look alike and no vowels, so ids read
 * back easily from a URL and never spell words (see Data model in docs/SPEC.md).
 */
const ID_ALPHABET = "6789BCDFGHJKLMNPQRTWbcdfghjkmnpqrtwz";

const createId: () => string = customAlphabet(ID_ALPHABET, 12);

/** Ids from storage, an import or the example week are kept when they are 1 to 40 characters. */
const isValidId = (value: string): boolean => value.length > 0 && value.length <= 40;

/**
 * Gives a checked or newly made id its brand. Only the functions below call it, so this is the one
 * type assertion in the module.
 */
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- Value is the brand to give: a return-only type parameter is what makes this the cast.
function brand<Value extends Brand<string, string>>(value: string): Value {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- the one place an id becomes a brand (see Branded types in docs/CODING-GUIDELINES.md).
  return value as Value;
}

/** A new 12-character id. */
export const createActivityId = (): ActivityId => brand<ActivityId>(createId());
export const createBlockId = (): BlockId => brand<BlockId>(createId());

/** The id as it is, or undefined when it isn't a valid id, so the caller gives it a new one. */
export const sanitizeActivityId = (value: string): ActivityId | undefined =>
  isValidId(value) ? brand<ActivityId>(value) : undefined;
export const sanitizeBlockId = (value: string): BlockId | undefined =>
  isValidId(value) ? brand<BlockId>(value) : undefined;

import { customAlphabet } from "nanoid";

import type { Brand } from "../brand.ts";

export type ActivityId = Brand<string, "ActivityId">;
export type BlockId = Brand<string, "BlockId">;

/**
 * nanoid-dictionary's `nolookalikesSafe`: no characters that look alike and no vowels, so ids read
 * back easily from a URL and never spell words (see docs/spec/data-model.md).
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
  // oxlint-disable-next-line typescript/consistent-type-assertions -- the one place an id becomes a brand (see Branded types in docs/guidelines/typescript.md).
  return value as Value;
}

/**
 * Makes new ids. Code that needs one takes an `IdGenerator` as an argument, so it stays pure: the
 * app passes {@link randomIds}, and a test passes ids it can predict (see "A pure core, with side
 * effects at the edges" in docs/guidelines/principles.md).
 */
export type IdGenerator = {
  readonly createActivityId: () => ActivityId;
  readonly createBlockId: () => BlockId;
};

/** New random 12-character ids. */
export const randomIds: IdGenerator = {
  createActivityId: () => brand<ActivityId>(createId()),
  createBlockId: () => brand<BlockId>(createId()),
};

/** The id as it is, or undefined when it isn't a valid id, so the caller gives it a new one. */
export const sanitizeActivityId = (value: string): ActivityId | undefined =>
  isValidId(value) ? brand<ActivityId>(value) : undefined;
export const sanitizeBlockId = (value: string): BlockId | undefined =>
  isValidId(value) ? brand<BlockId>(value) : undefined;

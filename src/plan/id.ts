import { customAlphabet } from "nanoid";

import type { Brand } from "../brand";

export type ActivityId = Brand<string, "ActivityId">;
export type BlockId = Brand<string, "BlockId">;

/**
 * nanoid-dictionary's `nolookalikesSafe`: no characters that look alike and no vowels, so ids read
 * back easily from a URL and never spell words (see Data model in docs/SPEC.md).
 */
const ID_ALPHABET = "6789BCDFGHJKLMNPQRTWbcdfghjkmnpqrtwz";

const createId: () => string = customAlphabet(ID_ALPHABET, 12);

/** Ids from storage, an import or the example week are kept when they are 1 to 40 characters. */
const isValidId = (value: string) => value.length >= 1 && value.length <= 40;

/** A new 12-character id. */
export const createActivityId = (): ActivityId => createId() as ActivityId;
export const createBlockId = (): BlockId => createId() as BlockId;

/** The id as it is, or undefined when it isn't a valid id, so the caller gives it a new one. */
export const sanitizeActivityId = (value: string): ActivityId | undefined =>
  isValidId(value) ? (value as ActivityId) : undefined;
export const sanitizeBlockId = (value: string): BlockId | undefined =>
  isValidId(value) ? (value as BlockId) : undefined;

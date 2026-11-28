// A sync group's identifier (see The messages in docs/spec/self-service.md and The envelope in
// docs/spec/sync.md). Strict parser: gives back undefined for anything the app couldn't have made.
import type { Brand } from "../brand.ts";

/**
 * A group's id: 128 random bits written as 32 lowercase hexadecimal digits, matching `DeviceKey`'s
 * hexadecimal form.
 */
export type GroupId = Brand<string, "GroupId">;

const GROUP_ID = /^[0-9a-f]{32}$/u;

/**
 * Gives a checked group id its brand. Only {@link parseGroupId} calls it, with text it has just
 * checked, so this is the one type assertion in the module.
 */
function brand(value: string): GroupId {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- the one place a checked group id becomes a brand (see Branded types in docs/guidelines/typescript.md).
  return value as GroupId;
}

/** Parses a group id strictly: 32 lowercase hexadecimal digits, nothing else. */
export const parseGroupId = (value: unknown): GroupId | undefined =>
  typeof value === "string" && GROUP_ID.test(value) ? brand(value) : undefined;

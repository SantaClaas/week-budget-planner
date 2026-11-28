// A device in the group's device list: its key, the relay it's reached through, its name and its
// membership (see The device list in docs/spec/self-service.md). The parsers are strict: they give
// back undefined for anything the app couldn't have written, since what they read was received.
import type { Brand } from "../brand.ts";

/**
 * A device's key: the public key of its node on the transport, which is its id there, as iroh
 * writes it: 64 lowercase hexadecimal digits (32 bytes).
 */
export type DeviceKey = Brand<string, "DeviceKey">;

/** The relay a device is reached through: an http or https URL as `URL` writes it. */
export type Relay = Brand<string, "Relay">;

/** What the person calls a device: trimmed, and 1 to 60 characters, counted as code points. */
export type DeviceName = Brand<string, "DeviceName">;

/**
 * Whether a device is in the group: a member, removed, or temporary, a window that keeps nothing
 * (see A window that keeps nothing in docs/spec/self-service.md).
 */
export type MembershipStatus = "member" | "removed" | "temporary";

/**
 * A device's membership. The proof, the passkey's signature over the change, comes with the passkey
 * guard (see Who may change the group in docs/spec/self-service.md); until then it is always null,
 * and a received proof is refused, since nothing could check it.
 */
export type Membership = { readonly status: MembershipStatus; readonly proof: null };

/** The most characters (code points) a device's name can have. The database checks the same. */
export const MAX_DEVICE_NAME_CHARACTERS = 60;

/** The most characters a relay's URL can have. The database checks the same. */
export const MAX_RELAY_CHARACTERS = 200;

export const MEMBERSHIP_STATUSES: readonly MembershipStatus[] = ["member", "removed", "temporary"];

const DEVICE_KEY = /^[0-9a-f]{64}$/u;

/**
 * Gives a checked key, relay or name its brand. Only the parsers below call it, with text they've
 * just checked, so this is the one type assertion in the module.
 */
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- Value is the brand to give: a return-only type parameter is what makes this the cast.
function brand<Value extends Brand<string, string>>(value: string): Value {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- the one place a checked key, relay or name becomes a brand (see Branded types in docs/guidelines/typescript.md).
  return value as Value;
}

export const parseDeviceKey = (value: unknown): DeviceKey | undefined =>
  typeof value === "string" && DEVICE_KEY.test(value) ? brand<DeviceKey>(value) : undefined;

/** A relay's URL, when it's http or https, and written as `URL` writes it, so it compares as text. */
export function parseRelay(value: unknown): Relay | undefined {
  if (typeof value !== "string" || value.length > MAX_RELAY_CHARACTERS) return undefined;

  const url = URL.parse(value);
  if (url === null) return undefined;

  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;

  return url.href === value ? brand<Relay>(value) : undefined;
}

/** A name that is trimmed and 1 to 60 code points long, as the database's `length()` counts them. */
export function parseDeviceName(value: unknown): DeviceName | undefined {
  if (typeof value !== "string" || value !== value.trim()) return undefined;

  // A string iterates by code points, as the database's length() counts them (not graphemes, as
  // Intl.Segmenter would: a flag is one grapheme of two code points).
  const characters = Iterator.from(value).reduce((count) => count + 1, 0);
  return characters >= 1 && characters <= MAX_DEVICE_NAME_CHARACTERS
    ? brand<DeviceName>(value)
    : undefined;
}

const isMembershipStatus = (value: unknown): value is MembershipStatus =>
  MEMBERSHIP_STATUSES.some((status) => status === value);

/**
 * A membership's fields, read one by one: a known status, and a proof that is null.
 *
 * @param status - The received status.
 * @param proof - The received proof.
 */
export const parseMembership = (status: unknown, proof: unknown): Membership | undefined =>
  isMembershipStatus(status) && proof === null ? { status, proof } : undefined;

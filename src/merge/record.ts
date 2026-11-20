// Reading an object that was received, field by field, before anything in it is trusted (see "What
// is received is checked" in docs/spec/merge.md).

type Fields = Record<string, unknown>;

/** Whether a value is an object that isn't a list, so its fields can be read. */
export const isRecord = (value: unknown): value is Fields =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The object, when it has exactly these fields: none missing and none unknown. */
export function readExact(value: unknown, names: readonly string[]): Fields | undefined {
  if (!isRecord(value)) return undefined;

  const keys = Object.keys(value);
  const isExact = keys.length === names.length && names.every((name) => Object.hasOwn(value, name));
  return isExact ? value : undefined;
}

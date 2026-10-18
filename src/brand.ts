declare const brand: unique symbol;

/**
 * A value that has been checked, such as a block's length or an activity's id. It's still a plain
 * number or string at runtime, but TypeScript keeps it apart from unchecked values and from other
 * brands. Only the module that defines a brand creates one, through its sanitizer, so a branded
 * value is always valid (see Branded types in docs/guidelines/typescript.md).
 */
export type Brand<Value, Name extends string> = Value & { readonly [brand]: Name };

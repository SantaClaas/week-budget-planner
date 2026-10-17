// oxlint-disable-next-line import/no-unassigned-import -- a stylesheet: Vite adds it to the page.
import "./font.css";

/** The same Latin range as font.css, so both faces cover the same text. */
const UNICODE_RANGE =
  "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD";

/**
 * Swaps in the copy of Google Sans Flex with the optical size axis. It's added after the face in
 * font.css, so where both match the browser uses this one. Text keeps its line height, but small
 * text gets slightly wider, which can rewrap a long line once.
 */
export async function loadOpticalSizes(): Promise<void> {
  const url = new URL("./google-sans-flex-optical-size.woff2", import.meta.url);
  const face = new FontFace("Google Sans Flex", `url("${url.href}") format("woff2")`, {
    weight: "400 700",
    display: "swap",
    unicodeRange: UNICODE_RANGE,
  });
  document.fonts.add(await face.load());
}

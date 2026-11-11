import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// The wavy indicator is drawn by the stylesheet (see .progress in docs/design/m3-tokens.css), with
// its curves written out, since CSS can't loop. These check what the drawing relies on.
const css = readFileSync(new URL("../../docs/design/m3-tokens.css", import.meta.url), "utf8");
/** One wavelength (ActiveWaveWavelength 40dp), in rem. */
const WAVELENGTH = 2.5;
/** The widest bar the app draws, in rem; a browser test checks it. */
const WIDEST_BAR = 80;

/** The wave's shape, from the part's ::before rule. */
function readShape(): string {
  const shape = /clip-path: shape\(([^;]*)\);/u.exec(
    css.slice(css.indexOf("&[data-wave] :is(.indicator, .over-budget) {")),
  )?.[1];
  if (shape === undefined) throw new Error("No wave shape in the tokens.");
  return shape;
}

/** How many half wavelengths one edge of the band draws: its curve and the smooth ones after. */
const countHalves = (shape: string, direction: "" | "-"): number =>
  1 + shape.split(`smooth by ${direction}1.25rem 0rem,`).length - 1;

describe("the wavy indicator's shape", () => {
  const shape = readShape();

  it("draws as many halves back along the bottom edge as along the top", () => {
    expect(countHalves(shape, "-")).toBe(countHalves(shape, ""));
  });

  it("covers the widest bar, from two wavelengths before it", () => {
    // The phase shifts the wave by up to one wavelength either way, so the start ranges from three
    // to one wavelengths before the bar.
    const covered = (countHalves(shape, "") * WAVELENGTH) / 2 - 3 * WAVELENGTH;
    expect(covered).toBeGreaterThanOrEqual(WIDEST_BAR);
  });

  it("turns back at the end with the control on the side the last top half had", () => {
    // Halves alternate up and down from an upward first one, so the even count ends going down,
    // and the bottom edge's first curve has its control below.
    expect(countHalves(shape, "") % 2).toBe(0);
    expect(shape).toContain(
      "curve by -1.25rem 0rem with -0.625rem calc(2 * var(--wave-amplitude))",
    );
  });
});

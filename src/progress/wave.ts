/**
 * The arithmetic of Google's wavy linear progress indicator (see "Wavy progress while resizing" in
 * docs/spec/design.md): the wave's shape for `clip-path: shape()`, its amplitude as it grows and
 * shrinks, and how far it has travelled. Pure, so the drawing in ./Progress.tsx only measures and
 * applies. Lengths are in rem, so the wave grows with the text size like the rest of the bar.
 *
 * Values from androidx: LinearProgressIndicatorTokens (ActiveWaveAmplitude 3dp, ActiveWaveWavelength
 * 40dp, ActiveThickness 4dp, WaveHeight 10dp), WavyProgressIndicator.kt (one wavelength per second,
 * the amplitude over MotionTokens.DurationLong2 with EasingStandardCubicBezier when it grows and
 * EasingEmphasizedAccelerateCubicBezier when it shrinks).
 */

/** The wave's full amplitude, from the center line to a crest: 3dp. */
export const AMPLITUDE = 0.1875;
/** One wave, crest to crest: 40dp. */
const WAVELENGTH = 2.5;
/** The indicator's thickness: 4dp. */
const THICKNESS = 0.25;
/** The container the wave moves in: 10dp, which every bar reserves. */
const HEIGHT = 0.625;
/** How many straight pieces draw one wavelength: at 3dp, 12 stray less than 0.1dp from a sine. */
const STEPS_PER_WAVELENGTH = 12;
/** How long the amplitude takes to grow or shrink: MotionTokens.DurationLong2. */
const AMPLITUDE_MILLISECONDS = 500;

/** One coordinate of a cubic Bézier from (0, 0) to (1, 1), with its two control points' values. */
const sampleBezier = (first: number, second: number, parameter: number): number =>
  3 * first * parameter * (1 - parameter) ** 2 +
  3 * second * parameter ** 2 * (1 - parameter) +
  parameter ** 3;

/**
 * A CSS `cubic-bezier()` easing as a function from time to progress, both 0 to 1: the curve's x
 * for a parameter is found by bisection, which always converges, and gives its y.
 */
function createCubicBezier(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): (time: number) => number {
  return (time) => {
    if (time <= 0) return 0;
    if (time >= 1) return 1;
    let low = 0;
    let high = 1;
    for (let step = 0; step < 30; step++) {
      const middle = (low + high) / 2;
      [low, high] = sampleBezier(x1, x2, middle) < time ? [middle, high] : [low, middle];
    }
    return sampleBezier(y1, y2, (low + high) / 2);
  };
}

/** MotionTokens.EasingStandardCubicBezier: cubic-bezier(0.2, 0, 0, 1). */
const easeStandard = createCubicBezier(0.2, 0, 0, 1);
/** MotionTokens.EasingEmphasizedAccelerateCubicBezier: cubic-bezier(0.3, 0, 0.8, 0.15). */
const easeEmphasizedAccelerate = createCubicBezier(0.3, 0, 0.8, 0.15);

/** The amplitude on its way from one value to another, 0 for flat and 1 for the full wave. */
export type AmplitudeChange = { from: number; to: number; startedAt: number };

/** A flat bar that stays flat. */
export const FLAT: AmplitudeChange = { from: 0, to: 0, startedAt: 0 };

/** The amplitude at `now` (milliseconds), eased on the way. */
export function readAmplitude(change: AmplitudeChange, now: number): number {
  const time = (now - change.startedAt) / AMPLITUDE_MILLISECONDS;
  const ease = change.to > change.from ? easeStandard : easeEmphasizedAccelerate;
  return change.from + (change.to - change.from) * ease(time);
}

/** Starts the amplitude towards `to` from wherever it is at `now`, so a change midway is smooth. */
export function changeAmplitude(change: AmplitudeChange, to: number, now: number): AmplitudeChange {
  return { from: readAmplitude(change, now), to, startedAt: now };
}

/** Whether the amplitude is flat now and stays flat, so nothing needs drawing any more. */
export const isFlat = (change: AmplitudeChange, now: number): boolean =>
  change.to === 0 && readAmplitude(change, now) <= 0;

/** How far the wave has travelled at `now` (milliseconds), in wavelengths from 0 to 1. */
export const readPhase = (now: number): number => (now / 1000) % 1;

/** A length in rem for `shape()`, to a thousandth. */
const formatRem = (value: number): string => `${String(Math.round(value * 1000) / 1000)}rem`;

/**
 * The wave as a `shape()` for one part of the bar: a band as thick as the indicator, its center
 * line a sine wave across the 10dp container, with round ends as the flat bar has.
 *
 * - `width`: the part's width, in rem.
 * - `offset`: how far the part starts from the bar's start, so a wave runs on across the gap
 *   between the within-budget part and the overrun.
 * - `amplitude`: from the center line to a crest, in rem: `AMPLITUDE` times how far it has grown.
 * - `phase`: how far the wave has travelled, in wavelengths. It travels towards the bar's end,
 *   which is the left in a right-to-left language.
 */
export function drawWave(options: {
  width: number;
  offset: number;
  amplitude: number;
  phase: number;
  isRightToLeft: boolean;
}): string {
  const { width, offset, amplitude } = options;
  const radius = THICKNESS / 2;
  const phase = options.isRightToLeft ? -options.phase : options.phase;
  const center = (x: number): number =>
    HEIGHT / 2 + amplitude * Math.sin(2 * Math.PI * ((x + offset) / WAVELENGTH - phase));
  // A part narrower than the indicator is thick is drawn as a dot, as the flat bar's round ends.
  const start = Math.min(radius, width / 2);
  const end = Math.max(width - radius, start);
  const count = Math.max(1, Math.ceil(((end - start) / WAVELENGTH) * STEPS_PER_WAVELENGTH));
  const xs = Array.from(
    { length: count + 1 },
    (_, index) => start + ((end - start) * index) / count,
  );
  const point = (x: number, side: number): string =>
    `${formatRem(x)} ${formatRem(center(x) + side * radius)}`;
  const top = xs.map((x) => `line to ${point(x, -1)}`);
  const bottom = xs.toReversed().map((x) => `line to ${point(x, 1)}`);
  const cap = `of ${formatRem(radius)} cw`;
  return [
    `shape(from ${point(start, -1)}`,
    ...top.slice(1),
    `arc to ${point(end, 1)} ${cap}`,
    ...bottom.slice(1),
    `arc to ${point(start, -1)} ${cap}`,
    "close)",
  ].join(", ");
}

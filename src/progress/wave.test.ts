import { describe, expect, it } from "vitest";

import {
  AMPLITUDE,
  changeAmplitude,
  drawWave,
  FLAT,
  isFlat,
  readAmplitude,
  readPhase,
} from "./wave.ts";

/** The points of a `shape()`, in rem, in the order it draws them. */
function readPoints(shape: string): { x: number; y: number }[] {
  return [...shape.matchAll(/(-?[\d.]+)rem (-?[\d.]+)rem/gu)].map(([, x = "", y = ""]) => ({
    x: Number(x),
    y: Number(y),
  }));
}

/** The highest and lowest point a shape reaches. */
function measureReach(shape: string): { top: number; bottom: number } {
  const ys = readPoints(shape).map((point) => point.y);
  return { top: Math.min(...ys), bottom: Math.max(...ys) };
}

/** Where a shape starts, up and down. */
const readFirstY = (shape: string): number => readPoints(shape)[0]?.y ?? Number.NaN;

const flatWave = { width: 10, offset: 0, amplitude: 0, phase: 0, isRightToLeft: false };

describe("drawWave", () => {
  it("draws a flat band as thick as the indicator, centered in the container, with round ends", () => {
    const shape = drawWave(flatWave);
    expect(shape).toMatch(/^shape\(from 0\.125rem 0\.188rem, line to /u);
    expect(shape).toContain("arc to 9.875rem 0.438rem of 0.125rem cw");
    expect(shape).toMatch(/arc to 0\.125rem 0\.188rem of 0\.125rem cw, close\)$/u);
    // 4dp thick, in the middle of the 10dp container
    expect(measureReach(shape)).toEqual({ top: 0.188, bottom: 0.438 });
  });

  it("swings 3dp each way at the full amplitude, so the band fills the 10dp container", () => {
    const reach = measureReach(drawWave({ ...flatWave, amplitude: AMPLITUDE }));
    // The pieces' corners land near the crests, not on them.
    expect(reach.top).toBeCloseTo(0, 2);
    expect(reach.bottom).toBeCloseTo(0.625, 2);
  });

  it("draws 12 pieces per wavelength along each edge", () => {
    // 10rem less the two round ends is 9.75rem, 3.9 waves of 2.5rem: 47 pieces, 48 points an
    // edge, and the shape ends where it started.
    expect(readPoints(drawWave(flatWave))).toHaveLength(48 * 2 + 1);
  });

  it("travels one wavelength over a whole phase, and back to the same shape", () => {
    const wave = { ...flatWave, amplitude: AMPLITUDE };
    expect(drawWave({ ...wave, phase: 1 })).toBe(drawWave({ ...wave, phase: 0 }));
    expect(drawWave({ ...wave, phase: 0.5 })).not.toBe(drawWave(wave));
  });

  it("travels towards the end of the bar, which is the left right-to-left", () => {
    const wave = { ...flatWave, amplitude: AMPLITUDE, phase: 0.25 };
    // A quarter wavelength later, the wave at x looks like it did a quarter wavelength before x.
    const moved = drawWave({ ...wave, offset: 0.625 });
    const before = drawWave({ ...wave, phase: 0 });
    expect(readFirstY(moved)).toBeCloseTo(readFirstY(before), 2);
    expect(drawWave({ ...wave, isRightToLeft: true })).toBe(drawWave({ ...wave, phase: -0.25 }));
  });

  it("runs the wave on across parts by their offset from the bar's start", () => {
    const wave = { ...flatWave, amplitude: AMPLITUDE, width: 5 };
    expect(drawWave({ ...wave, offset: 2.5 })).toBe(drawWave(wave));
  });

  it("draws a part narrower than the indicator's thickness as a dot", () => {
    const points = readPoints(drawWave({ ...flatWave, width: 0.1 }));
    expect(new Set(points.map((point) => point.x))).toEqual(new Set([0.05]));
  });
});

describe("the amplitude", () => {
  it("grows from flat to full over 500ms, with the standard easing", () => {
    const growing = changeAmplitude(FLAT, 1, 1000);
    expect(readAmplitude(growing, 1000)).toBe(0);
    // cubic-bezier(0.2, 0, 0, 1) is most of the way there by half time
    expect(readAmplitude(growing, 1250)).toBeGreaterThan(0.75);
    expect(readAmplitude(growing, 1500)).toBe(1);
    expect(readAmplitude(growing, 9000)).toBe(1);
  });

  it("shrinks over 500ms with the emphasized accelerate easing, and is flat after", () => {
    const shrinking = changeAmplitude(changeAmplitude(FLAT, 1, 0), 0, 1000);
    // cubic-bezier(0.3, 0, 0.8, 0.15) starts slowly
    expect(readAmplitude(shrinking, 1250)).toBeGreaterThan(0.8);
    expect(isFlat(shrinking, 1250)).toBe(false);
    expect(readAmplitude(shrinking, 1500)).toBe(0);
    expect(isFlat(shrinking, 1500)).toBe(true);
  });

  it("turns around from where it is when it changes midway", () => {
    const growing = changeAmplitude(FLAT, 1, 0);
    const midway = readAmplitude(growing, 100);
    const shrinking = changeAmplitude(growing, 0, 100);
    expect(readAmplitude(shrinking, 100)).toBeCloseTo(midway, 10);
    expect(readAmplitude(shrinking, 600)).toBe(0);
  });

  it("is flat when it never grew", () => {
    expect(isFlat(FLAT, 0)).toBe(true);
  });
});

describe("readPhase", () => {
  it("travels one wavelength per second", () => {
    expect(readPhase(0)).toBe(0);
    expect(readPhase(250)).toBe(0.25);
    expect(readPhase(1250)).toBe(0.25);
  });
});

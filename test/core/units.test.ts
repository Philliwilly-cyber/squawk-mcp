import { describe, expect, it } from "vitest";
import { altitude, speed, verticalRate } from "../../src/core/units.js";

describe("units", () => {
  it("converts altitude to metres and feet", () => {
    expect(altitude(10_972.8)).toEqual({ m: 10_973, ft: 36_000 });
  });

  it("converts speed to km/h and knots", () => {
    expect(speed(231.5)).toEqual({ kmh: 833, kn: 450 });
  });

  it("converts vertical rate to m/s and ft/min", () => {
    expect(verticalRate(-5.08)).toEqual({ m_s: -5.1, ft_min: -1000 });
  });

  it("returns null for missing values", () => {
    expect(altitude(null)).toBeNull();
    expect(speed(undefined)).toBeNull();
    expect(verticalRate(Number.NaN)).toBeNull();
  });
});

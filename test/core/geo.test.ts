import { describe, expect, it } from "vitest";
import {
  bearingDeg,
  boundingBoxAround,
  boxAreaSqDeg,
  compassPoint,
  distanceKm,
  validateBox,
} from "../../src/core/geo.js";

const BERLIN = { lat: 52.52, lon: 13.405 };
const HAMBURG = { lat: 53.5511, lon: 9.9937 };

describe("geo", () => {
  it("computes great-circle distance", () => {
    expect(distanceKm(BERLIN, HAMBURG)).toBeCloseTo(255, 0);
  });

  it("computes bearing and compass point", () => {
    const bearing = bearingDeg(BERLIN, HAMBURG);
    expect(bearing).toBeGreaterThan(280);
    expect(bearing).toBeLessThan(310);
    expect(compassPoint(bearing)).toBe("NW");
    expect(compassPoint(359)).toBe("N");
  });

  it("builds a bounding box around a point", () => {
    const box = boundingBoxAround(BERLIN, 50);
    expect(box.lamax - box.lamin).toBeCloseTo(0.898, 2);
    expect(box.lomax - box.lomin).toBeGreaterThan(box.lamax - box.lamin);
    // A 50 km radius over Germany stays well within the cheapest credit tier.
    expect(boxAreaSqDeg(box)).toBeLessThan(25);
  });

  it("validates boxes", () => {
    expect(validateBox({ lamin: 1, lamax: 0, lomin: 0, lomax: 1 })).toMatch(/lamin/);
    expect(validateBox({ lamin: 0, lamax: 1, lomin: 0, lomax: 1 })).toBeNull();
  });
});

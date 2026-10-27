import { describe, expect, it } from "vitest";
import { historyCost, statesCost, utcPartitions } from "../../../src/sources/opensky/credits.js";

describe("credit costs", () => {
  it("prices /states/all by box area", () => {
    expect(statesCost({ lamin: 0, lamax: 5, lomin: 0, lomax: 5 })).toBe(1);
    expect(statesCost({ lamin: 0, lamax: 10, lomin: 0, lomax: 10 })).toBe(2);
    expect(statesCost({ lamin: 0, lamax: 20, lomin: 0, lomax: 20 })).toBe(3);
    expect(statesCost({ lamin: 0, lamax: 21, lomin: 0, lomax: 20 })).toBe(4);
    expect(statesCost(null)).toBe(4);
  });

  it("prices history by day partitions", () => {
    const now = 100 * 86_400;
    expect(historyCost(now - 3_600, now, now)).toBe(4);
    expect(historyCost(90 * 86_400, 90 * 86_400 + 3_600, now)).toBe(30);
    expect(utcPartitions(90 * 86_400, 94 * 86_400 - 1)).toBe(4);
    expect(historyCost(90 * 86_400, 94 * 86_400 - 1, now)).toBe(240);
  });
});

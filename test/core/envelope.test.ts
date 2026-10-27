import { describe, expect, it } from "vitest";
import { EnvelopeBuilder } from "../../src/core/envelope.js";

describe("EnvelopeBuilder", () => {
  it("computes data age and keeps the worst cache status", () => {
    const now = new Date("2026-10-23T08:00:30Z");
    const envelope = new EnvelopeBuilder(now)
      .source("OpenSky")
      .dataTime(Date.parse("2026-10-23T08:00:00Z"))
      .cacheStatus("stale")
      .cacheStatus("fresh")
      .warn("w")
      .warn("w")
      .build({ x: 1 });
    expect(envelope).toMatchObject({
      source: ["OpenSky"],
      server_time: "2026-10-23T10:00:30+02:00",
      data_time: "2026-10-23T10:00:00+02:00",
      data_age_seconds: 30,
      cache: "stale",
      warnings: ["w"],
      data: { x: 1 },
    });
  });
});

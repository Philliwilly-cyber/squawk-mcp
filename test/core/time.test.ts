import { describe, expect, it } from "vitest";
import { toBerlinIso, unixToBerlinIso, utcDayStart } from "../../src/core/time.js";

describe("time", () => {
  it("formats summer time with +02:00", () => {
    expect(toBerlinIso(new Date("2026-07-01T10:00:00Z"))).toBe("2026-07-01T12:00:00+02:00");
  });

  it("formats winter time with +01:00", () => {
    expect(toBerlinIso(new Date("2026-12-24T23:30:05Z"))).toBe("2026-12-25T00:30:05+01:00");
  });

  it("handles the DST switch", () => {
    // 2026-10-25 01:00 UTC is the end of summer time in Berlin.
    expect(toBerlinIso(new Date("2026-10-25T00:59:59Z"))).toBe("2026-10-25T02:59:59+02:00");
    expect(toBerlinIso(new Date("2026-10-25T01:00:00Z"))).toBe("2026-10-25T02:00:00+01:00");
  });

  it("converts unix seconds", () => {
    expect(unixToBerlinIso(0)).toBe("1970-01-01T01:00:00+01:00");
    expect(unixToBerlinIso(null)).toBeNull();
  });

  it("finds the UTC day start", () => {
    expect(utcDayStart(1_517_230_800)).toBe(1_517_184_000);
  });
});

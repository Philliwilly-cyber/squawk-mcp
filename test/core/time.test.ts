import { describe, expect, it } from "vitest";
import {
  addDays,
  berlinDate,
  berlinDayRange,
  parseUserTime,
  toBerlinIso,
  unixToBerlinIso,
  utcDayStart,
} from "../../src/core/time.js";

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

describe("Berlin calendar helpers", () => {
  it("computes a Berlin day in summer and winter", () => {
    expect(berlinDayRange("2026-07-01")).toEqual({
      begin: Date.parse("2026-06-30T22:00:00Z") / 1000,
      end: Date.parse("2026-07-01T22:00:00Z") / 1000 - 1,
    });
    expect(berlinDayRange("2026-12-01").begin).toBe(Date.parse("2026-11-30T23:00:00Z") / 1000);
    // The day summer time ends has 25 hours.
    const dst = berlinDayRange("2026-10-25");
    expect(dst.end - dst.begin + 1).toBe(25 * 3600);
  });

  it("parses user times", () => {
    expect(parseUserTime("2026-07-01T14:00").toISOString()).toBe("2026-07-01T12:00:00.000Z");
    expect(parseUserTime("2026-07-01T14:00:00Z").toISOString()).toBe("2026-07-01T14:00:00.000Z");
    expect(parseUserTime("1517227200").toISOString()).toBe("2018-01-29T12:00:00.000Z");
    expect(() => parseUserTime("yesterday-ish")).toThrow(RangeError);
  });

  it("finds the Berlin date and shifts days", () => {
    expect(berlinDate(new Date("2026-10-22T22:30:00Z"))).toBe("2026-10-23");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

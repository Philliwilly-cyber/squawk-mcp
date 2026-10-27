import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EnvelopeBuilder } from "../src/core/envelope.js";
import { parsePlace } from "../src/sources/nominatim/nominatim.js";
import { parseStates, parseTrack } from "../src/sources/opensky/parse.js";
import { addSquawkWarnings, formatState } from "../src/tools/format.js";

interface Recorded {
  url: string;
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

const live = (name: string): Recorded =>
  JSON.parse(readFileSync(new URL(`./fixtures/live/${name}`, import.meta.url), "utf8")) as Recorded;

describe("real OpenSky responses", () => {
  it("parses every state vector of a live box", () => {
    const recorded = live("states-hamburg.json");
    const rows = (recorded.body as { states: unknown[] }).states;
    const snapshot = parseStates(recorded.body);
    expect(snapshot.states).toHaveLength(rows.length);
    expect(recorded.headers["x-rate-limit-remaining"]).toBeDefined();
  });

  it("formats live states without noise: no 'no information' category, short discrete squawks", () => {
    const { time, states } = parseStates(live("states-hamburg.json").body);
    const formatted = states.map((s) => formatState(s, { aircraft: undefined, nowS: time }));
    expect(formatted.every((f) => f["category"] === null)).toBe(true);
    const discrete = formatted.map((f) => f["squawk"]).find((s) => (s as { category?: string } | null)?.category === "discrete");
    expect(discrete).toEqual({ code: expect.any(String) as string, category: "discrete", label: "Discrete code assigned by ATC" });
  });

  it("explains the German air rescue code 0020 seen live", () => {
    const { time, states } = parseStates(live("states-north-of-hamburg.json").body);
    const rescue = states.find((s) => s.squawk === "0020");
    expect(rescue).toBeDefined();
    if (!rescue) return;
    expect(formatState(rescue, { aircraft: undefined, nowS: time })["squawk"]).toMatchObject({
      category: "special",
      label: "Air rescue helicopter (Germany)",
    });
    const builder = new EnvelopeBuilder(new Date(time * 1000));
    addSquawkWarnings(builder, states);
    expect(builder.build(null).warnings).toEqual([]);
  });

  it("parses a live track", () => {
    const track = parseTrack(live("track-live.json").body);
    expect(track?.path.length).toBeGreaterThan(1);
    expect(track?.endTime).toBeGreaterThan(track?.startTime ?? Number.POSITIVE_INFINITY);
  });

  it("records the anonymous 403 for past flights", () => {
    const recorded = live("flights-aircraft-anonymous-403.json");
    expect(recorded.status).toBe(403);
    expect(recorded.body).toBe("You cannot access historical flights");
  });
});

describe("real Nominatim response", () => {
  it("parses place and bounding box", () => {
    const place = parsePlace((live("nominatim-search-hamburg.json").body as unknown[])[0]);
    expect(place).toMatchObject({ displayName: "Hamburg, Germany", category: "boundary", type: "administrative" });
    expect(place?.boundingBox?.lamin).toBeLessThan(place?.boundingBox?.lamax ?? 0);
  });
});

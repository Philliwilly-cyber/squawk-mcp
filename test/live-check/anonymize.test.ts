import { describe, expect, it } from "vitest";
import { Anonymizer } from "../../src/live-check/anonymize.js";

describe("Anonymizer", () => {
  it("replaces icao24 and callsign in state vectors, keeping everything else", () => {
    const anonymizer = new Anonymizer();
    const body = anonymizer.body({
      time: 1,
      states: [
        ["3e1206", "CHR50   ", "Germany", 1, 1, 10.08, 53.51, 167.6, false, 56.5, 280, 1.9, null, 221, "0034", false, 0, 0],
        ["3c126b", "", "Germany", 1, 1, 9.8, 53.5, null, true, 0, 14, null, null, null, null, false, 0, 0],
      ],
    }) as { states: unknown[][] };
    expect(body.states[0]).toEqual([
      "f00001", "ANON01  ", "Germany", 1, 1, 10.08, 53.51, 167.6, false, 56.5, 280, 1.9, null, 221, "0034", false, 0, 0,
    ]);
    // An empty callsign stays empty.
    expect(body.states[1]?.slice(0, 2)).toEqual(["f00002", ""]);
  });

  it("maps the same aircraft to the same placeholder across responses and URLs", () => {
    const anonymizer = new Anonymizer();
    anonymizer.body({ time: 1, states: [["3e1206", "CHR50   "]] });
    expect(anonymizer.body({ icao24: "3e1206", callsign: "CHR50   ", path: [[1, 2, 3, 4, 5, false]] })).toEqual({
      icao24: "f00001",
      callsign: "ANON01  ",
      path: [[1, 2, 3, 4, 5, false]],
    });
    expect(anonymizer.url("https://opensky-network.org/api/tracks/all?icao24=3E1206&time=0")).toBe(
      "https://opensky-network.org/api/tracks/all?time=0&icao24=f00001",
    );
  });

  it("de-identifies flight lists and leaves other bodies alone", () => {
    const anonymizer = new Anonymizer();
    expect(anonymizer.body([{ icao24: "3c675a", callsign: "DLH1AB  ", estArrivalAirport: "EDDF" }])).toEqual([
      { icao24: "f00001", callsign: "ANON01  ", estArrivalAirport: "EDDF" },
    ]);
    expect(anonymizer.body("You cannot access historical flights")).toBe("You cannot access historical flights");
    const place = [{ lat: "53.55", display_name: "Hamburg, Germany" }];
    expect(anonymizer.body(place)).toEqual(place);
  });
});

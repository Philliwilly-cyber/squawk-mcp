import { describe, expect, it } from "vitest";
import { parseFlights, parseStates, parseTrack } from "../../../src/sources/opensky/parse.js";
import { fixture } from "../../helpers.js";

describe("OpenSky parsers", () => {
  it("parses state vectors and skips malformed rows", () => {
    const snapshot = parseStates(fixture("states-all.json"));
    expect(snapshot.time).toBe(1507203250);
    expect(snapshot.states).toHaveLength(4);
    expect(snapshot.states[0]).toMatchObject({ icao24: "c04049", callsign: null, positionSource: "ADS-B", category: 4 });
    expect(snapshot.states[1]?.callsign).toBe("UTA716");
    expect(snapshot.states[2]?.squawk).toBe("7700");
  });

  it("handles short rows without the category field", () => {
    const snapshot = parseStates(fixture("states-all.json"));
    expect(snapshot.states[3]).toMatchObject({ positionSource: "MLAT", category: null, latitude: null });
  });

  it("handles an empty states list", () => {
    expect(parseStates({ time: 1, states: null }).states).toEqual([]);
  });

  it("parses flights", () => {
    const [flight] = parseFlights(fixture("flights-arrival.json"));
    expect(flight).toMatchObject({ callsign: "DLH1AB", estArrivalAirport: "EDDF", arrivalAirportCandidatesCount: 2 });
  });

  it("parses tracks", () => {
    const track = parseTrack(fixture("track.json"));
    expect(track?.callsign).toBe("DLH9LF");
    expect(track?.path).toHaveLength(3);
    expect(track?.path[0]?.onGround).toBe(true);
  });
});

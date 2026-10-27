import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCsv } from "../../../src/core/csv.js";
import { AirportIndex, parseAirportRows } from "../../../src/sources/ourairports/airports.js";

const csv = readFileSync(new URL("../../fixtures/airports.csv", import.meta.url), "utf8");
const index = new AirportIndex(parseAirportRows(parseCsv(csv)));

describe("AirportIndex", () => {
  it("looks up by ICAO and IATA", () => {
    expect(index.lookup("eddf")?.name).toBe("Frankfurt am Main Airport");
    expect(index.lookup("HAM")?.icao).toBe("EDDH");
    expect(index.lookup("TXL")?.type).toBe("closed");
  });

  it("searches by city, bigger airports first, closed ones excluded", () => {
    expect(index.search("Hamburg").map((a) => a.ident)).toEqual(["EDDH", "EDHI"]);
    expect(index.search("Berlin").map((a) => a.ident)).toEqual(["EDDB"]);
  });

  it("finds the nearest large airports", () => {
    expect(index.nearest({ lat: 52.52, lon: 13.4 }, 1)[0]?.ident).toBe("EDDB");
  });
});

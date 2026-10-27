import { describe, expect, it } from "vitest";
import type { AircraftInfo } from "../../src/sources/aircraft-db/aircraft-db.js";
import { aircraftSummary } from "../../src/tools/format.js";

const base: AircraftInfo = {
  icao24: "3c675a",
  registration: "D-AIZZ",
  manufacturer: null,
  model: null,
  typecode: "A320",
  icaoAircraftClass: null,
  operator: null,
  operatorCallsign: null,
  operatorIcao: "DLH",
  built: null,
  category: null,
};

describe("aircraftSummary", () => {
  it("does not repeat the manufacturer when the model already names it", () => {
    expect(aircraftSummary({ ...base, manufacturer: "Airbus", model: "Airbus A320 214SL" })?.["type"]).toBe(
      "Airbus A320 214SL",
    );
  });

  it("joins manufacturer and model otherwise", () => {
    expect(
      aircraftSummary({ ...base, manufacturer: "Airbus Helicopters", model: "MBB-BK 117 D-2 (H145)" })?.["type"],
    ).toBe("Airbus Helicopters MBB-BK 117 D-2 (H145)");
    expect(aircraftSummary({ ...base, manufacturer: "Embraer", model: null })?.["type"]).toBe("Embraer");
    expect(aircraftSummary(base)?.["type"]).toBeNull();
  });
});

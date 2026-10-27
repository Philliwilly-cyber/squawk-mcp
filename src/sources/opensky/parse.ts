import type { Flight, PositionSource, StateVector, StatesSnapshot, Track, Waypoint } from "./types.js";

const POSITION_SOURCES: readonly PositionSource[] = ["ADS-B", "ASTERIX", "MLAT", "FLARM"];

const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const str = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};
const bool = (value: unknown): boolean => value === true;

export function parseStateVector(row: unknown): StateVector | null {
  if (!Array.isArray(row)) return null;
  const icao24 = str(row[0]);
  const lastContact = num(row[4]);
  if (icao24 === null || lastContact === null) return null;
  const sourceIndex = num(row[16]);
  return {
    icao24: icao24.toLowerCase(),
    callsign: str(row[1]),
    originCountry: str(row[2]) ?? "unknown",
    timePosition: num(row[3]),
    lastContact,
    longitude: num(row[5]),
    latitude: num(row[6]),
    baroAltitude: num(row[7]),
    onGround: bool(row[8]),
    velocity: num(row[9]),
    trueTrack: num(row[10]),
    verticalRate: num(row[11]),
    geoAltitude: num(row[13]),
    squawk: str(row[14]),
    spi: bool(row[15]),
    positionSource: sourceIndex === null ? "unknown" : (POSITION_SOURCES[sourceIndex] ?? "unknown"),
    category: num(row[17]),
  };
}

export function parseStates(body: unknown): StatesSnapshot {
  const object = (body ?? {}) as { time?: unknown; states?: unknown };
  const time = num(object.time) ?? Math.floor(Date.now() / 1000);
  const rows = Array.isArray(object.states) ? object.states : [];
  const states = rows.map(parseStateVector).filter((s): s is StateVector => s !== null);
  return { time, states };
}

export function parseFlight(entry: unknown): Flight | null {
  if (typeof entry !== "object" || entry === null) return null;
  const e = entry as Record<string, unknown>;
  const icao24 = str(e["icao24"]);
  const firstSeen = num(e["firstSeen"]);
  const lastSeen = num(e["lastSeen"]);
  if (icao24 === null || firstSeen === null || lastSeen === null) return null;
  return {
    icao24: icao24.toLowerCase(),
    firstSeen,
    estDepartureAirport: str(e["estDepartureAirport"]),
    lastSeen,
    estArrivalAirport: str(e["estArrivalAirport"]),
    callsign: str(e["callsign"]),
    estDepartureAirportHorizDistance: num(e["estDepartureAirportHorizDistance"]),
    estDepartureAirportVertDistance: num(e["estDepartureAirportVertDistance"]),
    estArrivalAirportHorizDistance: num(e["estArrivalAirportHorizDistance"]),
    estArrivalAirportVertDistance: num(e["estArrivalAirportVertDistance"]),
    departureAirportCandidatesCount: num(e["departureAirportCandidatesCount"]),
    arrivalAirportCandidatesCount: num(e["arrivalAirportCandidatesCount"]),
  };
}

export function parseFlights(body: unknown): Flight[] {
  if (!Array.isArray(body)) return [];
  return body.map(parseFlight).filter((f): f is Flight => f !== null);
}

function parseWaypoint(row: unknown): Waypoint | null {
  if (!Array.isArray(row)) return null;
  const time = num(row[0]);
  if (time === null) return null;
  return {
    time,
    latitude: num(row[1]),
    longitude: num(row[2]),
    baroAltitude: num(row[3]),
    trueTrack: num(row[4]),
    onGround: bool(row[5]),
  };
}

export function parseTrack(body: unknown): Track | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const icao24 = str(b["icao24"]);
  if (icao24 === null) return null;
  const rawPath = Array.isArray(b["path"]) ? b["path"] : [];
  const path = rawPath.map(parseWaypoint).filter((w): w is Waypoint => w !== null);
  const startTime = num(b["startTime"]) ?? path[0]?.time ?? null;
  const endTime = num(b["endTime"]) ?? path.at(-1)?.time ?? null;
  if (startTime === null || endTime === null) return null;
  return {
    icao24: icao24.toLowerCase(),
    startTime,
    endTime,
    // The API documents the field as "calllsign"; accept both spellings.
    callsign: str(b["callsign"]) ?? str(b["calllsign"]),
    path,
  };
}

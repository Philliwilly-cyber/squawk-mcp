export type PositionSource = "ADS-B" | "ASTERIX" | "MLAT" | "FLARM" | "unknown";

export interface StateVector {
  icao24: string;
  callsign: string | null;
  originCountry: string;
  timePosition: number | null;
  lastContact: number;
  longitude: number | null;
  latitude: number | null;
  baroAltitude: number | null;
  onGround: boolean;
  velocity: number | null;
  trueTrack: number | null;
  verticalRate: number | null;
  geoAltitude: number | null;
  squawk: string | null;
  spi: boolean;
  positionSource: PositionSource;
  /** ADS-B emitter category; only present with extended=1. */
  category: number | null;
}

export interface StatesSnapshot {
  /** Unix seconds the vectors refer to. */
  time: number;
  states: StateVector[];
}

export interface Flight {
  icao24: string;
  firstSeen: number;
  estDepartureAirport: string | null;
  lastSeen: number;
  estArrivalAirport: string | null;
  callsign: string | null;
  estDepartureAirportHorizDistance: number | null;
  estDepartureAirportVertDistance: number | null;
  estArrivalAirportHorizDistance: number | null;
  estArrivalAirportVertDistance: number | null;
  departureAirportCandidatesCount: number | null;
  arrivalAirportCandidatesCount: number | null;
}

export interface Waypoint {
  time: number;
  latitude: number | null;
  longitude: number | null;
  baroAltitude: number | null;
  trueTrack: number | null;
  onGround: boolean;
}

export interface Track {
  icao24: string;
  startTime: number;
  endTime: number;
  callsign: string | null;
  path: Waypoint[];
}

export const AIRCRAFT_CATEGORIES: Readonly<Record<number, string>> = {
  0: "No information",
  1: "No ADS-B emitter category information",
  2: "Light (< 15,500 lbs)",
  3: "Small (15,500 to 75,000 lbs)",
  4: "Large (75,000 to 300,000 lbs)",
  5: "High vortex large (e.g. B757)",
  6: "Heavy (> 300,000 lbs)",
  7: "High performance (> 5 g and 400 kt)",
  8: "Rotorcraft",
  9: "Glider / sailplane",
  10: "Lighter-than-air",
  11: "Parachutist / skydiver",
  12: "Ultralight / hang-glider / paraglider",
  13: "Reserved",
  14: "Unmanned aerial vehicle",
  15: "Space / trans-atmospheric vehicle",
  16: "Surface vehicle - emergency vehicle",
  17: "Surface vehicle - service vehicle",
  18: "Point obstacle (incl. tethered balloons)",
  19: "Cluster obstacle",
  20: "Line obstacle",
};

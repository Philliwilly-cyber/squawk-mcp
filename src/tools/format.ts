import type { DatasetState } from "../core/dataset.js";
import type { EnvelopeBuilder } from "../core/envelope.js";
import { AIRCRAFT_DB_ATTRIBUTION, OPENSKY_ATTRIBUTION } from "../core/envelope.js";
import { type Coordinates, bearingDeg, compassPoint, distanceKm } from "../core/geo.js";
import { emergencyWarning, explainSquawk, isEmergencySquawk, type SquawkInfo } from "../core/squawk.js";
import { unixToBerlinIso } from "../core/time.js";
import { altitude, speed, verticalRate } from "../core/units.js";
import type { AircraftIndex, AircraftInfo } from "../sources/aircraft-db/aircraft-db.js";
import type { OpenSkyResult } from "../sources/opensky/service.js";
import { AIRCRAFT_CATEGORIES, type Flight, type StateVector } from "../sources/opensky/types.js";
import { NOTE_SQUAWK } from "./notes.js";

export function aircraftSummary(info: AircraftInfo | undefined): Record<string, string | null> | null {
  if (!info) return null;
  const type = [info.manufacturer, info.model].filter(Boolean).join(" ") || null;
  return {
    registration: info.registration,
    type,
    typecode: info.typecode,
    operator: info.operator,
    operator_icao: info.operatorIcao,
    built: info.built,
  };
}

export function squawkDetails(code: string | null): SquawkInfo | null {
  return code === null ? null : explainSquawk(code);
}

export interface FormatOptions {
  observer?: Coordinates;
  aircraft?: AircraftIndex | undefined;
  nowS: number;
}

export function formatState(state: StateVector, options: FormatOptions): Record<string, unknown> {
  const hasPosition = state.latitude !== null && state.longitude !== null;
  const position = hasPosition ? { lat: state.latitude, lon: state.longitude } : null;
  let fromObserver: Record<string, unknown> | null = null;
  if (options.observer && state.latitude !== null && state.longitude !== null) {
    const target = { lat: state.latitude, lon: state.longitude };
    const bearing = bearingDeg(options.observer, target);
    fromObserver = {
      distance_km: Math.round(distanceKm(options.observer, target) * 10) / 10,
      bearing_deg: Math.round(bearing),
      direction: compassPoint(bearing),
    };
  }
  return {
    icao24: state.icao24,
    callsign: state.callsign,
    aircraft: options.aircraft ? (aircraftSummary(options.aircraft.byIcao24(state.icao24)) ?? "not in aircraft database") : null,
    origin_country: state.originCountry,
    position,
    from_observer: fromObserver,
    on_ground: state.onGround,
    altitude_barometric: altitude(state.baroAltitude),
    altitude_geometric: altitude(state.geoAltitude),
    ground_speed: speed(state.velocity),
    track_deg: state.trueTrack === null ? null : Math.round(state.trueTrack),
    vertical_rate: verticalRate(state.verticalRate),
    squawk: squawkDetails(state.squawk),
    category: state.category === null ? null : (AIRCRAFT_CATEGORIES[state.category] ?? `unknown (${state.category})`),
    position_source: state.positionSource,
    position_age_s: state.timePosition === null ? null : Math.max(0, options.nowS - state.timePosition),
    last_contact: unixToBerlinIso(state.lastContact),
  };
}

export function formatFlight(flight: Flight, aircraft: AircraftIndex | undefined): Record<string, unknown> {
  return {
    icao24: flight.icao24,
    callsign: flight.callsign,
    aircraft: aircraft ? (aircraftSummary(aircraft.byIcao24(flight.icao24)) ?? "not in aircraft database") : null,
    first_seen: unixToBerlinIso(flight.firstSeen),
    last_seen: unixToBerlinIso(flight.lastSeen),
    duration_min: Math.round((flight.lastSeen - flight.firstSeen) / 60),
    departure_airport_estimate: flight.estDepartureAirport,
    departure_alternatives: flight.departureAirportCandidatesCount,
    arrival_airport_estimate: flight.estArrivalAirport,
    arrival_alternatives: flight.arrivalAirportCandidatesCount,
  };
}

/** Adds squawk warnings for emergency codes in a list of states. */
export function addSquawkWarnings(builder: EnvelopeBuilder, states: readonly StateVector[]): void {
  let anySquawk = false;
  for (const state of states) {
    if (state.squawk !== null) anySquawk = true;
    if (isEmergencySquawk(state.squawk) && state.squawk !== null) {
      builder.warn(emergencyWarning(state.squawk, state.callsign ?? state.icao24));
    }
  }
  if (anySquawk) builder.note(NOTE_SQUAWK);
}

/** Copies OpenSky metadata (auth, cache, data time, warnings, quota) into the envelope. */
export function applyOpenSky<T>(
  builder: EnvelopeBuilder,
  endpoint: string,
  result: OpenSkyResult<T>,
  dataTimeMs: number,
): { estimated_cost: number; remaining_today: number | null } {
  builder
    .source(`OpenSky Network REST ${endpoint}`)
    .attribute(OPENSKY_ATTRIBUTION)
    .authMode(result.authMode)
    .cacheStatus(result.cache)
    .dataTime(dataTimeMs);
  for (const warning of result.warnings) builder.warn(warning);
  return { estimated_cost: result.estimatedCost, remaining_today: result.creditsRemaining };
}

/** Waits briefly for the aircraft database and records its state in the envelope. */
export function applyAircraftDb(
  builder: EnvelopeBuilder,
  state: DatasetState<AircraftIndex>,
): AircraftIndex | undefined {
  if (state.status === "ready") {
    builder.source("OpenSky aircraft database").attribute(AIRCRAFT_DB_ATTRIBUTION);
    if (state.refreshError) builder.warn(`Aircraft database could not be refreshed (${state.refreshError}); using the local copy.`);
    return state.data;
  }
  if (state.status === "loading") {
    builder.warn("The aircraft database is still downloading; type, operator and registration are missing for now.");
  } else {
    builder.warn(`The aircraft database is unavailable (${state.error}); type, operator and registration are missing.`);
  }
  return undefined;
}

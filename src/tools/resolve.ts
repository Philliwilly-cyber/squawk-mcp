import { type EnvelopeBuilder, OSM_ATTRIBUTION, OURAIRPORTS_ATTRIBUTION } from "../core/envelope.js";
import type { BoundingBox, Coordinates } from "../core/geo.js";
import { HttpError } from "../core/http.js";
import type { AircraftIndex, AircraftInfo } from "../sources/aircraft-db/aircraft-db.js";
import type { Airport } from "../sources/ourairports/airports.js";
import type { ToolContext } from "./context.js";
import { applyAircraftDb } from "./format.js";
import { ToolInputError } from "./result.js";

export interface ResolvedLocation {
  point: Coordinates;
  label: string;
  boundingBox: BoundingBox | null;
}

export interface LocationInput {
  place?: string | undefined;
  lat?: number | undefined;
  lon?: number | undefined;
}

export async function resolveLocation(
  ctx: ToolContext,
  builder: EnvelopeBuilder,
  input: LocationInput,
): Promise<ResolvedLocation> {
  if (input.lat !== undefined && input.lon !== undefined) {
    return { point: { lat: input.lat, lon: input.lon }, label: `${input.lat}, ${input.lon}`, boundingBox: null };
  }
  if (input.lat !== undefined || input.lon !== undefined) {
    throw new ToolInputError("Give both lat and lon, or a place name.");
  }
  if (!input.place?.trim()) {
    throw new ToolInputError("Give a place name (e.g. \"Hamburg\") or coordinates (lat and lon).");
  }
  let result;
  try {
    result = await ctx.geocoder.geocode(input.place);
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    throw new ToolInputError(
      `Could not look up "${input.place}": ${error.message}`,
      "Try again in a minute, or give coordinates (lat and lon) instead of a place name.",
    );
  }
  builder.source(`Nominatim (OpenStreetMap)${result.cached ? ", cached" : ""}`).attribute(OSM_ATTRIBUTION);
  if (!result.place) {
    throw new ToolInputError(`Nominatim found no place called "${input.place}".`, "Try a more specific name or coordinates.");
  }
  return {
    point: { lat: result.place.lat, lon: result.place.lon },
    label: result.place.displayName,
    boundingBox: result.place.boundingBox,
  };
}

export interface ResolvedAircraft {
  icao24: string;
  info: AircraftInfo | undefined;
  index: AircraftIndex | undefined;
  matchedBy: "icao24" | "registration";
}

const HEX_ICAO = /^[0-9a-fA-F]{6}$/;

/**
 * Resolves an icao24 address or registration (via the aircraft database) to an icao24.
 * `kind` forces one interpretation; by default a known registration wins over a hex address.
 */
export async function resolveAircraft(
  ctx: ToolContext,
  builder: EnvelopeBuilder,
  query: string,
  kind: "auto" | "registration" | "icao24" = "auto",
): Promise<ResolvedAircraft> {
  const text = query.trim();
  const isHex = HEX_ICAO.test(text);
  if (kind === "icao24" && !isHex) {
    throw new ToolInputError(`"${query}" is not a 24-bit ICAO address.`, "An icao24 address has 6 hex digits, e.g. 3c675a.");
  }
  // A hex address needs no database, so wait only briefly in that case.
  const index = applyAircraftDb(builder, await ctx.aircraftDb.get(isHex && kind !== "registration" ? 2_000 : 20_000));

  const byRegistration = kind === "icao24" ? undefined : index?.byRegistrationMark(text);
  if (byRegistration && !(kind === "auto" && isHex && index?.byIcao24(text))) {
    return { icao24: byRegistration.icao24, info: byRegistration, index, matchedBy: "registration" };
  }
  if (isHex && kind !== "registration") {
    const icao24 = text.toLowerCase();
    return { icao24, info: index?.byIcao24(icao24), index, matchedBy: "icao24" };
  }
  throw new ToolInputError(
    index
      ? `"${query}" is neither a known registration nor a 24-bit ICAO address (6 hex digits).`
      : `"${query}" is not a 24-bit ICAO address, and registrations cannot be resolved while the aircraft database is unavailable.`,
    "Use the icao24 hex address (e.g. 3c675a) or a registration such as D-AIZZ. For callsigns use aircraft_lookup.",
  );
}

/** Resolves an airport by ICAO/IATA code or name. Falls back to a raw 4-letter ICAO code. */
export async function resolveAirport(
  ctx: ToolContext,
  builder: EnvelopeBuilder,
  query: string,
): Promise<{ icao: string; airport: Airport | null }> {
  const state = await ctx.airports.get(15_000);
  const text = query.trim();
  if (state.status === "ready") {
    builder.source("OurAirports").attribute(OURAIRPORTS_ATTRIBUTION);
    if (state.refreshError) builder.warn(`Airport data could not be refreshed (${state.refreshError}); using the local copy.`);
    const airport = state.data.lookup(text) ?? state.data.search(text, 1)[0];
    if (airport) {
      const icao = airport.icao ?? airport.ident;
      return { icao, airport };
    }
  } else {
    builder.warn(
      state.status === "loading" ? "Airport data is still downloading." : `Airport data is unavailable (${state.error}).`,
    );
  }
  if (/^[A-Za-z]{4}$/.test(text)) return { icao: text.toUpperCase(), airport: null };
  throw new ToolInputError(`No airport found for "${query}".`, "Use the ICAO code (e.g. EDDF) or the IATA code (e.g. FRA).");
}

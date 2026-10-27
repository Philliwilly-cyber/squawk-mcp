import type { EnvelopeBuilder } from "../core/envelope.js";
import { type BoundingBox, type Coordinates, distanceKm } from "../core/geo.js";
import { toUnixSeconds } from "../core/time.js";
import type { StateVector } from "../sources/opensky/types.js";
import type { ToolContext } from "./context.js";
import { addSquawkWarnings, applyAircraftDb, applyOpenSky, formatState } from "./format.js";
import { NOTE_ADSB_COVERAGE, NOTE_MILITARY, NOTE_STATE_VALIDITY } from "./notes.js";

export interface LiveQuery {
  box?: BoundingBox;
  observer?: Coordinates;
  /** Keep only aircraft within this distance of the observer. */
  radiusKm?: number;
  includeOnGround: boolean;
  maxResults: number;
  filter?: (state: StateVector) => boolean;
}

/** Fetches live states for a box, enriches and sorts them, and fills the envelope. */
export async function liveStates(ctx: ToolContext, builder: EnvelopeBuilder, query: LiveQuery): Promise<Record<string, unknown>> {
  // Start the database lookup in parallel with the API call.
  const dbState = ctx.aircraftDb.get(2_000);
  const result = await ctx.opensky.getStates(query.box ? { box: query.box } : {});
  const quota = applyOpenSky(builder, "/states/all", result, result.value.time * 1000);
  const aircraft = applyAircraftDb(builder, await dbState);
  builder.note(NOTE_ADSB_COVERAGE).note(NOTE_MILITARY).note(NOTE_STATE_VALIDITY);

  const observer = query.observer;
  let states = result.value.states.filter((s) => query.includeOnGround || !s.onGround);
  if (query.filter) states = states.filter(query.filter);
  if (observer && query.radiusKm !== undefined) {
    const radius = query.radiusKm;
    states = states.filter(
      (s) => s.latitude !== null && s.longitude !== null && distanceKm(observer, { lat: s.latitude, lon: s.longitude }) <= radius,
    );
  }
  if (observer) {
    const distance = (s: StateVector): number =>
      s.latitude === null || s.longitude === null ? Number.POSITIVE_INFINITY : distanceKm(observer, { lat: s.latitude, lon: s.longitude });
    states.sort((a, b) => distance(a) - distance(b));
  } else {
    states.sort((a, b) => (b.baroAltitude ?? -1) - (a.baroAltitude ?? -1));
  }

  addSquawkWarnings(builder, states);
  const shown = states.slice(0, query.maxResults);
  if (states.length > shown.length) {
    builder.warn(`Showing ${shown.length} of ${states.length} aircraft. Raise max_results or narrow the area to see more.`);
  }
  const nowS = toUnixSeconds(ctx.clock());
  return {
    count: states.length,
    shown: shown.length,
    aircraft: shown.map((s) => formatState(s, { ...(observer ? { observer } : {}), aircraft, nowS })),
    quota,
  };
}

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { EnvelopeBuilder } from "../core/envelope.js";
import { boundingBoxAround } from "../core/geo.js";
import { addDays, berlinDate, berlinDayRange } from "../core/time.js";
import { feetToMetres } from "../core/units.js";
import type { Flight, StateVector } from "../sources/opensky/types.js";
import type { ToolContext } from "./context.js";
import { applyAircraftDb, applyOpenSky, formatFlight } from "./format.js";
import { liveStates } from "./live.js";
import { NOTE_ADSB_COVERAGE, NOTE_ESTIMATED_AIRPORTS, NOTE_NIGHTLY_BATCH } from "./notes.js";
import { resolveAirport } from "./resolve.js";
import { ToolInputError, jsonResult, runTool } from "./result.js";

type Direction = "arrival" | "departure";

function phase(state: StateVector, fieldElevationM: number): string {
  if (state.onGround) return "on ground";
  const height = state.baroAltitude === null ? null : state.baroAltitude - fieldElevationM;
  if (height !== null && height < 1_500 && state.verticalRate !== null) {
    if (state.verticalRate < -1) return "likely approaching / landing";
    if (state.verticalRate > 1) return "likely departing / climbing";
  }
  return "in the vicinity / overflying";
}

export function registerAirportTraffic(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "airport_traffic",
    {
      title: "Airport arrivals and departures",
      description:
        "mode=history: arrivals and/or departures at an airport on a past day (nightly OpenSky batch, yesterday or earlier, " +
        "about 30 credits per direction). mode=live_nearby: aircraft around the airport right now, with an estimated phase " +
        "(on ground, approaching, departing), 1 credit.",
      inputSchema: {
        airport: z.string().min(3).describe("ICAO (EDDF), IATA (FRA) or airport name"),
        mode: z.enum(["history", "live_nearby"]).default("history"),
        direction: z.enum(["arrivals", "departures", "both"]).default("arrivals").describe("history mode only"),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("history mode: day in Europe/Berlin, YYYY-MM-DD. Default: yesterday."),
        radius_km: z.number().min(2).max(60).default(15).describe("live_nearby mode: radius around the airport"),
        max_results: z.number().int().min(1).max(500).default(50),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) =>
      runTool(async () => {
        const now = ctx.clock();
        const builder = new EnvelopeBuilder(now);
        const { icao, airport } = await resolveAirport(ctx, builder, args.airport);
        const airportInfo = airport
          ? { icao, iata: airport.iata, name: airport.name, municipality: airport.municipality, country: airport.country }
          : { icao, name: null };

        if (args.mode === "live_nearby") {
          if (!airport) throw new ToolInputError(`Coordinates for ${icao} are unknown, so live_nearby is not possible.`);
          const center = { lat: airport.lat, lon: airport.lon };
          const elevationM = feetToMetres(airport.elevationFt ?? 0);
          const live = await liveStates(ctx, builder, {
            box: boundingBoxAround(center, args.radius_km),
            observer: center,
            radiusKm: args.radius_km,
            includeOnGround: true,
            maxResults: args.max_results,
          });
          // live.shown and live.data.aircraft are in the same order.
          const aircraft = live.data.aircraft.map((a, i) => {
            const state = live.shown[i];
            return { ...a, phase: state ? phase(state, elevationM) : null };
          });
          builder.note("The phase is a guess from altitude and vertical rate near the airport, not ATC data.");
          return jsonResult(builder.build({ airport: airportInfo, radius_km: args.radius_km, ...live.data, aircraft }));
        }

        const today = berlinDate(now);
        const date = args.date ?? addDays(today, -1);
        if (date >= today) {
          throw new ToolInputError(
            `Arrivals and departures for ${date} are not available yet: OpenSky processes flights in a nightly batch.`,
            'Use mode "live_nearby" to see what is around the airport right now.',
          );
        }
        const { begin, end } = berlinDayRange(date);
        const directions: Direction[] =
          args.direction === "both" ? ["arrival", "departure"] : [args.direction === "arrivals" ? "arrival" : "departure"];
        if (directions.length === 2) builder.warn("Arrivals and departures are two requests (about 60 credits together).");

        const dbState = ctx.aircraftDb.get(2_000);
        // Run both directions at once, and keep one direction's (already paid) result if the other fails.
        const settled = await Promise.allSettled(
          directions.map((direction) => ctx.opensky.getAirportFlights(direction, icao, begin, end)),
        );
        if (settled.every((r) => r.status === "rejected")) throw settled[0]?.reason;

        const airportsState = ctx.airports.peek();
        const nameOf = (code: string | null): string | null =>
          code === null || airportsState.status !== "ready" ? null : (airportsState.data.lookup(code)?.name ?? null);
        const aircraftIndex = applyAircraftDb(builder, await dbState);

        const data: Record<string, unknown> = { airport: airportInfo, date, time_zone: "Europe/Berlin" };
        const quota: Record<string, unknown> = {};
        directions.forEach((direction, i) => {
          const outcome = settled[i];
          if (!outcome) return;
          if (outcome.status === "rejected") {
            const reason = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
            builder.warn(`The ${direction}s could not be loaded: ${reason}`);
            data[`${direction}s`] = null;
            return;
          }
          const result = outcome.value;
          quota[direction] = applyOpenSky(builder, `/flights/${direction}`, result, end * 1000);
          const key = direction === "arrival" ? "lastSeen" : "firstSeen";
          const flights = [...result.value].sort((a: Flight, b: Flight) => b[key] - a[key]);
          const shown = flights.slice(0, args.max_results);
          if (flights.length > shown.length) builder.warn(`Showing ${shown.length} of ${flights.length} ${direction}s.`);
          data[`${direction}s`] = {
            count: flights.length,
            flights: shown.map((f) => {
              const formatted = formatFlight(f, aircraftIndex);
              const other = direction === "arrival" ? f.estDepartureAirport : f.estArrivalAirport;
              return { ...formatted, [direction === "arrival" ? "from" : "to"]: nameOf(other) };
            }),
          };
        });
        builder.note(NOTE_NIGHTLY_BATCH).note(NOTE_ESTIMATED_AIRPORTS).note(NOTE_ADSB_COVERAGE);
        return jsonResult(builder.build({ ...data, quota }));
      }),
  );
}

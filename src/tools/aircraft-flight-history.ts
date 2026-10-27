import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { EnvelopeBuilder } from "../core/envelope.js";
import { addDays, berlinDate, berlinDayRange } from "../core/time.js";
import type { ToolContext } from "./context.js";
import { aircraftSummary, applyOpenSky, formatFlight } from "./format.js";
import { NOTE_ADSB_COVERAGE, NOTE_ESTIMATED_AIRPORTS, NOTE_NIGHTLY_BATCH } from "./notes.js";
import { resolveAircraft } from "./resolve.js";
import { ToolInputError, jsonResult, requireAccountForHistory, runTool } from "./result.js";

const MAX_INTERVAL_S = 2 * 86_400;

export function registerAircraftFlightHistory(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "aircraft_flight_history",
    {
      title: "Past flights of an aircraft",
      description:
        "Flights of one aircraft on a past day (or two), with estimated departure and arrival airports. " +
        "OpenSky builds this data in a nightly batch, so only yesterday or earlier is available (about 30 credits). " +
        "Needs OpenSky credentials: anonymous users get no past flights.",
      inputSchema: {
        aircraft: z.string().min(2).describe("Registration (D-AIZZ) or icao24 hex address (3c675a)"),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("Day in Europe/Berlin, YYYY-MM-DD. Default: yesterday."),
        days: z.number().int().min(1).max(2).default(1).describe("1 = only that day, 2 = that day and the day before"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) =>
      runTool(async () => {
        const now = ctx.clock();
        const builder = new EnvelopeBuilder(now);
        const today = berlinDate(now);
        const date = args.date ?? addDays(today, -1);
        if (date >= today) {
          throw new ToolInputError(
            `Flights for ${date} are not available yet: OpenSky processes flights in a nightly batch.`,
            "Use aircraft_lookup for the live position, or aircraft_track for the current flight.",
          );
        }
        requireAccountForHistory(ctx.opensky.authMode, "Without an account, aircraft_track shows the current flight.");
        const first = berlinDayRange(addDays(date, 1 - args.days));
        const last = berlinDayRange(date);
        // Around a DST switch two Berlin days can be 49 h long; the API allows 48 h.
        const begin = Math.max(first.begin, last.end - MAX_INTERVAL_S + 1);
        if (begin > first.begin) builder.warn("Interval shortened by one hour to stay within the 48 h API limit.");

        const resolved = await resolveAircraft(ctx, builder, args.aircraft);
        const result = await ctx.opensky.getFlightsByAircraft(resolved.icao24, begin, last.end);
        const quota = applyOpenSky(builder, "/flights/aircraft", result, last.end * 1000);
        builder.note(NOTE_NIGHTLY_BATCH).note(NOTE_ESTIMATED_AIRPORTS).note(NOTE_ADSB_COVERAGE);
        if (date === addDays(today, -1)) {
          builder.note("Yesterday's batch may not be complete yet early in the morning.");
        }

        const flights = [...result.value].sort((a, b) => a.firstSeen - b.firstSeen);
        if (flights.length === 0) {
          builder.note("No flights found. The aircraft may not have flown, or flew outside receiver coverage.");
        }
        return jsonResult(
          builder.build({
            icao24: resolved.icao24,
            aircraft: aircraftSummary(resolved.info),
            period: { from: addDays(date, 1 - args.days), to: date, time_zone: "Europe/Berlin" },
            count: flights.length,
            flights: flights.map((f) => formatFlight(f, resolved.index)),
            quota,
          }),
        );
      }),
  );
}

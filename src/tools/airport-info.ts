import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { EnvelopeBuilder, OURAIRPORTS_ATTRIBUTION } from "../core/envelope.js";
import { altitude, feetToMetres } from "../core/units.js";
import type { Airport } from "../sources/ourairports/airports.js";
import type { ToolContext } from "./context.js";
import { resolveLocation } from "./resolve.js";
import { ToolInputError, jsonResult, runTool } from "./result.js";

function formatAirport(a: Airport): Record<string, unknown> {
  return {
    icao: a.icao,
    iata: a.iata,
    ident: a.ident,
    name: a.name,
    type: a.type.replace(/_/g, " "),
    municipality: a.municipality,
    country: a.country,
    region: a.region,
    position: { lat: a.lat, lon: a.lon },
    elevation: a.elevationFt === null ? null : altitude(feetToMetres(a.elevationFt)),
    scheduled_service: a.scheduledService,
    wikipedia: a.wikipedia,
  };
}

export function registerAirportInfo(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "airport_info",
    {
      title: "Airport information",
      description:
        "Looks up airports by ICAO or IATA code, name or city in OurAirports (no OpenSky credits), " +
        "or lists the larger airports nearest to a place.",
      inputSchema: {
        query: z.string().min(2).optional().describe("ICAO (EDDH), IATA (HAM), name or city"),
        near_place: z.string().optional().describe("List the nearest larger airports to this place instead"),
        limit: z.number().int().min(1).max(25).default(5),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) =>
      runTool(async () => {
        const builder = new EnvelopeBuilder(ctx.clock());
        const state = await ctx.airports.get(30_000);
        if (state.status !== "ready") {
          throw new ToolInputError(
            state.status === "loading"
              ? "The airport database is still downloading. Try again in a moment."
              : `The airport database is unavailable: ${state.error}`,
          );
        }
        builder.source("OurAirports").attribute(OURAIRPORTS_ATTRIBUTION).cacheStatus("cached").dataTime(state.updatedAt);
        if (state.refreshError) builder.warn(`Airport data could not be refreshed (${state.refreshError}); using the local copy.`);

        if (args.near_place) {
          const location = await resolveLocation(ctx, builder, { place: args.near_place });
          const airports = state.data.nearest(location.point, args.limit);
          return jsonResult(builder.build({ near: location.label, airports: airports.map(formatAirport) }));
        }
        if (!args.query) throw new ToolInputError("Give a query or near_place.");
        const airports = state.data.search(args.query, args.limit);
        if (airports.length === 0) builder.note(`No airport matches "${args.query}".`);
        return jsonResult(builder.build({ query: args.query, airports: airports.map(formatAirport) }));
      }),
  );
}

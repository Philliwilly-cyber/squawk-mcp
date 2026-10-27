import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { EnvelopeBuilder } from "../core/envelope.js";
import { boundingBoxAround, boxAreaSqDeg } from "../core/geo.js";
import { statesCost } from "../sources/opensky/credits.js";
import type { ToolContext } from "./context.js";
import { liveStates } from "./live.js";
import { resolveLocation } from "./resolve.js";
import { jsonResult, runTool } from "./result.js";

export function registerFlightsOverhead(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "flights_overhead",
    {
      title: "What's flying overhead?",
      description:
        "Live aircraft around a place or coordinates, nearest first, with distance and direction from that point, " +
        "altitude (m/ft), speed (km/h, kn), aircraft type and operator, and explained squawk codes. " +
        "Uses OpenSky live state vectors (usually 1 credit).",
      inputSchema: {
        place: z.string().optional().describe('Place name, geocoded via OpenStreetMap, e.g. "Hamburg" or "Brandenburger Tor"'),
        lat: z.number().min(-90).max(90).optional().describe("Latitude of the observer (use with lon instead of place)"),
        lon: z.number().min(-180).max(180).optional().describe("Longitude of the observer"),
        radius_km: z.number().min(1).max(250).default(30).describe("Search radius in km (default 30)"),
        include_on_ground: z.boolean().default(false).describe("Also list aircraft on the ground"),
        max_results: z.number().int().min(1).max(200).default(25),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) =>
      runTool(async () => {
        const builder = new EnvelopeBuilder(ctx.clock());
        const location = await resolveLocation(ctx, builder, args);
        const box = boundingBoxAround(location.point, args.radius_km);
        if (statesCost(box) > 1) {
          builder.warn(
            `A ${args.radius_km} km radius here needs a ${Math.round(boxAreaSqDeg(box))} sq° box, which costs ${statesCost(box)} OpenSky credits instead of 1.`,
          );
        }
        const live = await liveStates(ctx, builder, {
          box,
          observer: location.point,
          radiusKm: args.radius_km,
          includeOnGround: args.include_on_ground,
          maxResults: args.max_results,
        });
        if (live.count === 0) {
          builder.note(
            "No aircraft found. That can mean empty sky, but also missing receiver coverage at this place or altitude.",
          );
        }
        return jsonResult(
          builder.build({ location: { name: location.label, ...location.point }, radius_km: args.radius_km, ...live.data }),
        );
      }),
  );
}

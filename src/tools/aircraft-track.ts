import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { EnvelopeBuilder } from "../core/envelope.js";
import { parseUserTime, toUnixSeconds, unixToBerlinIso } from "../core/time.js";
import { altitude } from "../core/units.js";
import type { ToolContext } from "./context.js";
import { aircraftSummary, applyOpenSky } from "./format.js";
import { NOTE_ADSB_COVERAGE, NOTE_TRACKS_EXPERIMENTAL } from "./notes.js";
import { resolveAircraft } from "./resolve.js";
import { jsonResult, runTool } from "./result.js";

export function registerAircraftTrack(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "aircraft_track",
    {
      title: "Flight track of an aircraft",
      description:
        "The trajectory (waypoints with time, position, altitude) of an aircraft's current flight, or of a flight " +
        "at a given time within the last 30 days. Uses the experimental OpenSky tracks endpoint (about 4 credits).",
      inputSchema: {
        aircraft: z.string().min(2).describe("Registration (D-AIZZ) or icao24 hex address (3c675a)"),
        time: z
          .string()
          .optional()
          .describe("Any time during the flight, ISO 8601 (Berlin time if no offset). Omit for the live track."),
        max_waypoints: z.number().int().min(2).max(1000).default(200),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) =>
      runTool(async () => {
        const builder = new EnvelopeBuilder(ctx.clock());
        const resolved = await resolveAircraft(ctx, builder, args.aircraft);
        const time = args.time === undefined ? 0 : toUnixSeconds(parseUserTime(args.time));
        const result = await ctx.opensky.getTrack(resolved.icao24, time);
        const track = result.value;
        const dataTime = track ? track.endTime * 1000 : ctx.clock().getTime();
        const quota = applyOpenSky(builder, "/tracks/all", result, dataTime);
        builder.warn("Experimental OpenSky endpoint: results may be incomplete or unavailable.").note(NOTE_TRACKS_EXPERIMENTAL).note(NOTE_ADSB_COVERAGE);

        if (!track || track.path.length === 0) {
          builder.note(
            time === 0
              ? "No ongoing flight found for this aircraft. It may be on the ground or outside coverage."
              : "No flight found at that time.",
          );
          return jsonResult(builder.build({ icao24: resolved.icao24, aircraft: aircraftSummary(resolved.info), track: null, quota }));
        }

        const step = Math.max(1, Math.ceil(track.path.length / args.max_waypoints));
        const points = track.path.filter((_, i) => i % step === 0 || i === track.path.length - 1);
        if (step > 1) builder.warn(`Track thinned to ${points.length} of ${track.path.length} waypoints.`);

        return jsonResult(
          builder.build({
            icao24: resolved.icao24,
            callsign: track.callsign,
            aircraft: aircraftSummary(resolved.info),
            start: unixToBerlinIso(track.startTime),
            end: unixToBerlinIso(track.endTime),
            waypoint_count: track.path.length,
            waypoints: points.map((p) => ({
              time: unixToBerlinIso(p.time),
              lat: p.latitude,
              lon: p.longitude,
              altitude_barometric: altitude(p.baroAltitude),
              track_deg: p.trueTrack === null ? null : Math.round(p.trueTrack),
              on_ground: p.onGround,
            })),
            quota,
          }),
        );
      }),
  );
}

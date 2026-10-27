import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { EnvelopeBuilder } from "../core/envelope.js";
import type { BoundingBox } from "../core/geo.js";
import { toUnixSeconds } from "../core/time.js";
import type { ToolContext } from "./context.js";
import { AREA_SCHEMA, resolveArea } from "./flights-in-area.js";
import { addSquawkWarnings, aircraftSummary, applyAircraftDb, applyOpenSky, formatState } from "./format.js";
import { liveStates } from "./live.js";
import { NOTE_ADSB_COVERAGE, NOTE_MILITARY } from "./notes.js";
import { resolveAircraft } from "./resolve.js";
import { ToolInputError, jsonResult, runTool } from "./result.js";

const HEX = /^[0-9a-f]{6}$/i;
const normalizeCallsign = (callsign: string): string => callsign.replace(/\s+/g, "").toUpperCase();

export function registerAircraftLookup(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "aircraft_lookup",
    {
      title: "Look up an aircraft",
      description:
        "Finds an aircraft by registration (e.g. D-AIZZ), 24-bit ICAO address (e.g. 3c675a) or callsign (e.g. DLH4AB): " +
        "type, manufacturer, operator from the OpenSky aircraft database, plus its live position if it is flying. " +
        "Callsigns can only be searched within an area (or worldwide for 4 credits), because OpenSky cannot filter by callsign.",
      inputSchema: {
        query: z.string().min(2).describe("Registration, icao24 hex address or callsign"),
        kind: z.enum(["auto", "registration", "icao24", "callsign"]).default("auto"),
        live: z.boolean().default(true).describe("Also fetch the live position (costs OpenSky credits)"),
        ...AREA_SCHEMA,
        search_worldwide: z
          .boolean()
          .default(false)
          .describe("For callsigns without an area: search all live aircraft worldwide (4 credits)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) =>
      runTool(async () => {
        const builder = new EnvelopeBuilder(ctx.clock());
        const text = args.query.trim();
        let kind = args.kind;
        if (kind === "auto") {
          const dbState = await ctx.aircraftDb.get(HEX.test(text) ? 2_000 : 20_000);
          const knownRegistration = dbState.status === "ready" && dbState.data.byRegistrationMark(text) !== undefined;
          kind = knownRegistration ? "registration" : HEX.test(text) ? "icao24" : "callsign";
        }

        if (kind === "callsign") {
          const callsign = normalizeCallsign(text);
          let box: BoundingBox | undefined;
          let areaName = "worldwide";
          if (args.place || args.lamin !== undefined) {
            const area = await resolveArea(ctx, builder, args);
            box = area.box;
            areaName = area.label;
          } else if (!args.search_worldwide) {
            throw new ToolInputError(
              `"${text}" looks like a callsign. OpenSky cannot search callsigns directly.`,
              "Give an area (place or bounding box) to search in, or set search_worldwide to true (4 OpenSky credits).",
            );
          } else {
            builder.warn("Worldwide callsign search: this request costs 4 OpenSky credits.");
          }
          const live = await liveStates(ctx, builder, {
            ...(box ? { box } : {}),
            includeOnGround: true,
            maxResults: 20,
            filter: (s) => s.callsign !== null && normalizeCallsign(s.callsign) === callsign,
          });
          if (live["count"] === 0) {
            builder.note(`No live aircraft with callsign ${callsign} in ${areaName}. It may not be flying, or be outside coverage.`);
          }
          return jsonResult(builder.build({ query: text, matched_by: "callsign", area: areaName, ...live }));
        }

        const resolved = await resolveAircraft(ctx, builder, text);
        const data: Record<string, unknown> = {
          query: text,
          matched_by: resolved.matchedBy,
          icao24: resolved.icao24,
          aircraft: aircraftSummary(resolved.info) ?? (resolved.index ? "not in aircraft database" : null),
          category: resolved.info?.category ?? null,
        };
        if (!resolved.info && resolved.index) {
          builder.note("Not every transponder address is in the crowd-sourced aircraft database; that is common and no cause for concern.");
        }

        if (args.live) {
          const result = await ctx.opensky.getStates({ icao24: [resolved.icao24] });
          data["quota"] = applyOpenSky(builder, "/states/all", result, result.value.time * 1000);
          builder.note(NOTE_ADSB_COVERAGE).note(NOTE_MILITARY);
          const state = result.value.states[0];
          addSquawkWarnings(builder, result.value.states);
          data["live"] = state
            ? formatState(state, { aircraft: undefined, nowS: toUnixSeconds(ctx.clock()) })
            : "Not currently seen by OpenSky (on the ground with transponder off, outside coverage, or not transmitting).";
        } else {
          applyAircraftDb(builder, await ctx.aircraftDb.get(0));
        }
        return jsonResult(builder.build(data));
      }),
  );
}

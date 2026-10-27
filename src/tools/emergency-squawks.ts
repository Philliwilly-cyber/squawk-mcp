import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { EnvelopeBuilder } from "../core/envelope.js";
import { EMERGENCY_CAVEAT, explainSquawk, isEmergencySquawk } from "../core/squawk.js";
import type { ToolContext } from "./context.js";
import { AREA_SCHEMA, resolveArea } from "./flights-in-area.js";
import { liveStates } from "./live.js";
import { ToolInputError, jsonResult, runTool } from "./result.js";

export function registerEmergencySquawks(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "emergency_squawks",
    {
      title: "Emergency squawks",
      description:
        "Finds aircraft currently squawking 7500 (unlawful interference), 7600 (radio failure) or 7700 (general emergency) " +
        "in a region or worldwide, and explains what each code means and what it does not mean. " +
        "A region up to 25 sq° costs 1 credit; worldwide costs 4.",
      inputSchema: {
        ...AREA_SCHEMA,
        worldwide: z.boolean().default(false).describe("Search the whole world (costs 4 OpenSky credits)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) =>
      runTool(async () => {
        const builder = new EnvelopeBuilder(ctx.clock());
        let area: Record<string, unknown>;
        let live: Record<string, unknown>;
        const filter = (s: { squawk: string | null }): boolean => isEmergencySquawk(s.squawk);
        if (args.worldwide) {
          builder.warn("Worldwide search: this request costs 4 OpenSky credits.");
          area = { name: "worldwide" };
          live = await liveStates(ctx, builder, { includeOnGround: true, maxResults: 100, filter });
        } else {
          if (!args.place && args.lamin === undefined) {
            throw new ToolInputError("Give a place, a bounding box, or set worldwide to true.");
          }
          const resolved = await resolveArea(ctx, builder, args);
          area = { name: resolved.label, ...resolved.box };
          live = await liveStates(ctx, builder, { box: resolved.box, includeOnGround: true, maxResults: 100, filter });
        }
        if (live["count"] === 0) {
          builder.note(
            "No emergency squawk seen in this area right now. Aircraft outside receiver coverage, or not transmitting, cannot be seen.",
          );
        }
        return jsonResult(
          builder.build({
            area,
            ...live,
            codes: ["7500", "7600", "7700"].map((code) => explainSquawk(code)),
            caveat: EMERGENCY_CAVEAT,
          }),
        );
      }),
  );
}

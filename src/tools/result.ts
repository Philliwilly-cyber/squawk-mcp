import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { HttpError } from "../core/http.js";
import { toBerlinIso } from "../core/time.js";
import { InvalidRequestError } from "../sources/opensky/service.js";

/** An error caused by the tool input, with a hint how to fix it. */
export class ToolInputError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = "ToolInputError";
  }
}

export function jsonResult(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function errorResult(error: string, hint: string | undefined): CallToolResult {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({ error, ...(hint ? { hint } : {}), server_time: toBerlinIso(new Date()) }, null, 2),
      },
    ],
  };
}

/** Past flights (/flights/*) are refused by OpenSky for anonymous users; check before spending a request. */
export function requireAccountForHistory(authMode: "oauth2" | "anonymous", alternative: string): void {
  if (authMode === "anonymous") {
    throw new ToolInputError(
      "OpenSky only serves past flights to registered accounts, and no credentials are configured.",
      `Create a free API client at https://opensky-network.org/my-opensky/account and set OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET. ${alternative}`,
    );
  }
}

/** Turns thrown errors into readable tool errors instead of protocol errors. */
export async function runTool(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ToolInputError) return errorResult(error.message, error.hint);
    if (error instanceof InvalidRequestError || error instanceof RangeError) return errorResult(error.message, undefined);
    if (error instanceof HttpError) {
      const hint =
        error.status === 429
          ? "The daily OpenSky credits for this endpoint are used up. Cached answers still work; try again after the refill."
          : error.status === 0 || error.status >= 500
            ? "The upstream service is unreachable or overloaded. Try again in a minute."
            : undefined;
      return errorResult(error.message, hint);
    }
    return errorResult(error instanceof Error ? error.message : String(error), undefined);
  }
}

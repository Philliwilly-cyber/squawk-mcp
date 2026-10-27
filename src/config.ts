import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface OpenSkyCredentials {
  clientId: string;
  clientSecret: string;
}

export interface Config {
  version: string;
  userAgent: string;
  credentials: OpenSkyCredentials | null;
  cacheDir: string;
  openSkyApiUrl: string;
  openSkyTokenUrl: string;
  aircraftDbUrl: string;
  airportsUrl: string;
  nominatimUrl: string;
}

export const REPOSITORY_URL = "https://github.com/philliwilly-cyber/squawk-mcp";

/** The version lives only in package.json; read it from there. */
export function readVersion(): string {
  const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
  const parsed = JSON.parse(raw) as { version?: unknown };
  return typeof parsed.version === "string" ? parsed.version : "0.0.0";
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const version = readVersion();
  const clientId = nonEmpty(env["OPENSKY_CLIENT_ID"]);
  const clientSecret = nonEmpty(env["OPENSKY_CLIENT_SECRET"]);
  const contact = nonEmpty(env["SQUAWK_CONTACT"]);
  const xdgCache = nonEmpty(env["XDG_CACHE_HOME"]);

  return {
    version,
    // Nominatim requires an identifying User-Agent; a contact address is recommended.
    userAgent: `squawk-mcp/${version} (+${REPOSITORY_URL}${contact ? `; ${contact}` : ""})`,
    credentials: clientId && clientSecret ? { clientId, clientSecret } : null,
    cacheDir: nonEmpty(env["SQUAWK_CACHE_DIR"]) ?? join(xdgCache ?? join(homedir(), ".cache"), "squawk-mcp"),
    openSkyApiUrl: nonEmpty(env["OPENSKY_API_URL"]) ?? "https://opensky-network.org/api",
    openSkyTokenUrl:
      nonEmpty(env["OPENSKY_TOKEN_URL"]) ??
      "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token",
    aircraftDbUrl:
      nonEmpty(env["SQUAWK_AIRCRAFT_DB_URL"]) ??
      "https://s3.opensky-network.org/data-samples/metadata/aircraftDatabase.csv",
    airportsUrl:
      nonEmpty(env["SQUAWK_AIRPORTS_URL"]) ?? "https://davidmegginson.github.io/ourairports-data/airports.csv",
    nominatimUrl: nonEmpty(env["SQUAWK_NOMINATIM_URL"]) ?? "https://nominatim.openstreetmap.org",
  };
}

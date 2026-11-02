/**
 * Replaces aircraft identifiers (icao24 addresses, callsigns) in recorded OpenSky
 * responses with stable placeholders. The OpenSky data license requires aircraft
 * identifiers to be de-identified in anything published, and fixtures end up in a
 * public repository. Positions, altitudes, squawks etc. are kept for realistic tests.
 */
export class Anonymizer {
  private readonly icao = new Map<string, string>();
  private readonly callsigns = new Map<string, string>();

  /** Placeholder icao24: 6 hex digits in the f0xxxx range. */
  icao24(real: string): string {
    const key = real.toLowerCase();
    let fake = this.icao.get(key);
    if (fake === undefined) {
      fake = `f0${(this.icao.size + 1).toString(16).padStart(4, "0")}`;
      this.icao.set(key, fake);
    }
    return fake;
  }

  /** Placeholder callsign, padded to the API's 8 characters like the original. */
  callsign(real: string): string {
    const key = real.trim();
    if (key === "") return real;
    let fake = this.callsigns.get(key);
    if (fake === undefined) {
      fake = `ANON${String(this.callsigns.size + 1).padStart(2, "0")}`;
      this.callsigns.set(key, fake);
    }
    return real.length >= 8 ? fake.padEnd(8) : fake;
  }

  url(raw: string): string {
    const url = new URL(raw);
    const ids = url.searchParams.getAll("icao24");
    if (ids.length === 0) return raw;
    url.searchParams.delete("icao24");
    for (const id of ids) url.searchParams.append("icao24", this.icao24(id));
    return url.href;
  }

  /** De-identifies a states, track or flights response body. Other bodies are returned unchanged. */
  body(body: unknown): unknown {
    if (Array.isArray(body)) return body.map((entry) => this.flight(entry));
    if (typeof body !== "object" || body === null) return body;
    const object = body as Record<string, unknown>;
    if (Array.isArray(object["states"])) {
      return { ...object, states: object["states"].map((row) => this.stateRow(row)) };
    }
    if (typeof object["icao24"] === "string") {
      const out: Record<string, unknown> = { ...object, icao24: this.icao24(object["icao24"]) };
      for (const field of ["callsign", "calllsign"]) {
        if (typeof object[field] === "string") out[field] = this.callsign(object[field]);
      }
      return out;
    }
    return body;
  }

  private stateRow(row: unknown): unknown {
    if (!Array.isArray(row)) return row;
    const copy: unknown[] = Array.from(row as unknown[]);
    if (typeof copy[0] === "string") copy[0] = this.icao24(copy[0]);
    if (typeof copy[1] === "string") copy[1] = this.callsign(copy[1]);
    return copy;
  }

  private flight(entry: unknown): unknown {
    if (typeof entry !== "object" || entry === null) return entry;
    const flight = entry as Record<string, unknown>;
    return {
      ...flight,
      ...(typeof flight["icao24"] === "string" ? { icao24: this.icao24(flight["icao24"]) } : {}),
      ...(typeof flight["callsign"] === "string" ? { callsign: this.callsign(flight["callsign"]) } : {}),
    };
  }
}

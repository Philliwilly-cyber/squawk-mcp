export const TIME_ZONE = "Europe/Berlin";

const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  timeZoneName: "longOffset",
});

/** Formats a date as ISO 8601 in Europe/Berlin with its UTC offset, e.g. 2026-10-23T09:15:00+02:00. */
export function toBerlinIso(date: Date): string {
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) parts[part.type] = part.value;
  // longOffset yields "GMT+02:00", or plain "GMT" for a zero offset.
  const offset = (parts["timeZoneName"] ?? "GMT").replace("GMT", "") || "+00:00";
  return `${parts["year"]}-${parts["month"]}-${parts["day"]}T${parts["hour"]}:${parts["minute"]}:${parts["second"]}${offset}`;
}

export function unixToBerlinIso(unixSeconds: number | null | undefined): string | null {
  if (unixSeconds === null || unixSeconds === undefined || !Number.isFinite(unixSeconds)) return null;
  return toBerlinIso(new Date(unixSeconds * 1000));
}

export function toUnixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

/** A clock that can be replaced in tests. */
export type Clock = () => Date;

export const systemClock: Clock = () => new Date();

/** Start of the given UTC day as Unix seconds. */
export function utcDayStart(unixSeconds: number): number {
  return unixSeconds - (unixSeconds % 86_400);
}

/** UTC offset of Europe/Berlin at the given instant, in minutes (60 or 120). */
export function berlinOffsetMinutes(date: Date): number {
  const iso = toBerlinIso(date);
  const match = /([+-])(\d{2}):(\d{2})$/.exec(iso);
  if (!match) return 0;
  const [, sign, hours, minutes] = match;
  return (sign === "-" ? -1 : 1) * (Number(hours) * 60 + Number(minutes));
}

/** Converts a wall-clock time in Europe/Berlin to an instant. */
function berlinWallClockToDate(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  // Two passes settle the offset, also near DST switches.
  let instant = guess - berlinOffsetMinutes(new Date(guess)) * 60_000;
  instant = guess - berlinOffsetMinutes(new Date(instant)) * 60_000;
  return new Date(instant);
}

/** The Europe/Berlin calendar date (YYYY-MM-DD) of an instant. */
export function berlinDate(date: Date): string {
  return toBerlinIso(date).slice(0, 10);
}

/** Shifts a YYYY-MM-DD date by whole days. */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days)).toISOString().slice(0, 10);
}

/** Start and end (Unix seconds, end exclusive minus one) of a Europe/Berlin calendar day. */
export function berlinDayRange(isoDate: string): { begin: number; end: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) throw new RangeError(`Invalid date "${isoDate}", expected YYYY-MM-DD`);
  const [, y, m, d] = match.map(Number);
  const begin = toUnixSeconds(berlinWallClockToDate(y ?? 0, m ?? 0, d ?? 0));
  const next = addDays(isoDate, 1).split("-").map(Number);
  const end = toUnixSeconds(berlinWallClockToDate(next[0] ?? 0, next[1] ?? 0, next[2] ?? 0)) - 1;
  return { begin, end };
}

/**
 * Parses a user-supplied time. ISO 8601 with Z or an offset is taken as is; without an
 * offset it is read as Europe/Berlin wall-clock time. Plain numbers are Unix seconds.
 */
export function parseUserTime(input: string): Date {
  const text = input.trim();
  if (/^\d{9,11}$/.test(text)) return new Date(Number(text) * 1000);
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2})(?::(\d{2})(?::(\d{2})(?:\.\d+)?)?)?)?(Z|[+-]\d{2}:?\d{2})?$/i.exec(text);
  if (!match) throw new RangeError(`Could not understand the time "${input}". Use ISO 8601, e.g. 2026-10-22T14:00.`);
  const [, y, mo, d, h, mi, s, zone] = match;
  if (zone === undefined) {
    return berlinWallClockToDate(Number(y), Number(mo), Number(d), Number(h ?? 0), Number(mi ?? 0), Number(s ?? 0));
  }
  // An explicit offset or Z is unambiguous; Date.parse handles it without local-time guessing.
  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) throw new RangeError(`Could not understand the time "${input}". Use ISO 8601, e.g. 2026-10-22T14:00Z.`);
  return new Date(parsed);
}

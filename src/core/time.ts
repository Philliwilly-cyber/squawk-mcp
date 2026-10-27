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

const FEET_PER_METRE = 1 / 0.3048;
const KMH_PER_MS = 3.6;
const KNOTS_PER_MS = 3600 / 1852;
const FPM_PER_MS = FEET_PER_METRE * 60;

export interface Altitude {
  m: number;
  ft: number;
}

export interface Speed {
  kmh: number;
  kn: number;
}

export interface VerticalRate {
  m_s: number;
  ft_min: number;
}

function round(value: number, digits = 0): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function altitude(metres: number | null | undefined): Altitude | null {
  if (metres === null || metres === undefined || !Number.isFinite(metres)) return null;
  return { m: round(metres), ft: round(metres * FEET_PER_METRE) };
}

export function speed(metresPerSecond: number | null | undefined): Speed | null {
  if (metresPerSecond === null || metresPerSecond === undefined || !Number.isFinite(metresPerSecond)) {
    return null;
  }
  return { kmh: round(metresPerSecond * KMH_PER_MS), kn: round(metresPerSecond * KNOTS_PER_MS) };
}

export function verticalRate(metresPerSecond: number | null | undefined): VerticalRate | null {
  if (metresPerSecond === null || metresPerSecond === undefined || !Number.isFinite(metresPerSecond)) {
    return null;
  }
  return { m_s: round(metresPerSecond, 1), ft_min: round(metresPerSecond * FPM_PER_MS, -1) };
}

export function feetToMetres(feet: number): number {
  return feet / FEET_PER_METRE;
}

import type { BoundingBox } from "../../core/geo.js";
import { boxAreaSqDeg } from "../../core/geo.js";

export type CreditBucket = "states" | "flights" | "tracks";

export interface BucketBalance {
  remaining: number;
  observedAt: number;
}

/** Below this many remaining credits, results carry a warning. */
export const LOW_CREDIT_THRESHOLD = 50;

export function bucketForPath(path: string): CreditBucket {
  if (path.startsWith("/flights")) return "flights";
  if (path.startsWith("/tracks")) return "tracks";
  return "states";
}

/** Credit cost of /states/all as documented (by bounding box area in square degrees). */
export function statesCost(box: BoundingBox | null): number {
  if (box === null) return 4;
  const area = boxAreaSqDeg(box);
  if (area <= 25) return 1;
  if (area <= 100) return 2;
  if (area <= 400) return 3;
  return 4;
}

/** Number of UTC calendar dates the interval touches. */
export function utcPartitions(begin: number, end: number): number {
  return Math.floor(end / 86_400) - Math.floor(begin / 86_400) + 1;
}

/**
 * Documented credit cost of /flights/* and /tracks/*. The docs are not precise about
 * how partitions are counted, so this is an estimate.
 */
export function historyCost(begin: number, end: number, nowS: number): number {
  if (begin >= nowS - 86_400) return 4;
  const n = utcPartitions(begin, end);
  if (n <= 2) return 30;
  if (n <= 10) return 60 * n;
  if (n <= 15) return 120 * n;
  if (n <= 20) return 240 * n;
  if (n <= 25) return 480 * n;
  return 960 * n;
}

/** Remembers the last X-Rate-Limit-Remaining value per bucket. */
export class CreditTracker {
  private readonly balances = new Map<CreditBucket, BucketBalance>();

  record(bucket: CreditBucket, remaining: number, observedAt: number): void {
    this.balances.set(bucket, { remaining, observedAt });
  }

  get(bucket: CreditBucket): BucketBalance | undefined {
    return this.balances.get(bucket);
  }

  snapshot(): Partial<Record<CreditBucket, BucketBalance>> {
    return Object.fromEntries(this.balances);
  }
}

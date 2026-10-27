export interface Coordinates {
  lat: number;
  lon: number;
}

export interface BoundingBox {
  lamin: number;
  lomin: number;
  lamax: number;
  lomax: number;
}

const EARTH_RADIUS_KM = 6371.0088;
const KM_PER_DEGREE_LAT = 111.32;

const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** Great-circle distance in km. */
export function distanceKm(a: Coordinates, b: Coordinates): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a to b in degrees (0 = north, clockwise). */
export function bearingDeg(a: Coordinates, b: Coordinates): number {
  const y = Math.sin(toRad(b.lon - a.lon)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lon - a.lon));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

export function compassPoint(degrees: number): string {
  const index = Math.round((((degrees % 360) + 360) % 360) / 45) % COMPASS.length;
  return COMPASS[index] ?? "N";
}

/** Bounding box that contains a circle of the given radius around a point. */
export function boundingBoxAround(center: Coordinates, radiusKm: number): BoundingBox {
  const dLat = radiusKm / KM_PER_DEGREE_LAT;
  const cosLat = Math.max(Math.cos(toRad(center.lat)), 0.01);
  const dLon = Math.min(radiusKm / (KM_PER_DEGREE_LAT * cosLat), 180);
  return {
    lamin: clamp(center.lat - dLat, -90, 90),
    lamax: clamp(center.lat + dLat, -90, 90),
    lomin: clamp(center.lon - dLon, -180, 180),
    lomax: clamp(center.lon + dLon, -180, 180),
  };
}

/** Area in square degrees, which is what OpenSky bills /states/all by. */
export function boxAreaSqDeg(box: BoundingBox): number {
  return Math.abs(box.lamax - box.lamin) * Math.abs(box.lomax - box.lomin);
}

export function contains(box: BoundingBox, point: Coordinates): boolean {
  return point.lat >= box.lamin && point.lat <= box.lamax && point.lon >= box.lomin && point.lon <= box.lomax;
}

export function boxContainsBox(outer: BoundingBox, inner: BoundingBox): boolean {
  return (
    inner.lamin >= outer.lamin && inner.lamax <= outer.lamax && inner.lomin >= outer.lomin && inner.lomax <= outer.lomax
  );
}

export function validateBox(box: BoundingBox): string | null {
  if (box.lamin >= box.lamax) return "lamin must be smaller than lamax";
  if (box.lomin >= box.lomax) return "lomin must be smaller than lomax (boxes crossing the antimeridian are not supported)";
  if (box.lamin < -90 || box.lamax > 90) return "latitude must be between -90 and 90";
  if (box.lomin < -180 || box.lomax > 180) return "longitude must be between -180 and 180";
  return null;
}

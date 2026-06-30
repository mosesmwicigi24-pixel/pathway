// Coarse-geo helpers for the location → proximity → cell-pairing feature
// (parity gap #4). Privacy-first: we only ever derive a 6-char geohash (~1.2 km
// cell) from approximate coordinates and immediately discard the raw lat/lng.
// No heavyweight dependency — a ~30-line geohash encoder is plenty.
//
// Geohash reference: interleave latitude/longitude bits, base-32 encode in
// chunks of 5 bits per character. 6 characters ⇒ 30 bits ⇒ a cell of roughly
// 1.2 km × 0.6 km.

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz"; // geohash alphabet (no a,i,l,o)

/**
 * Encode (lat, lng) to a geohash of the given precision (default 6 chars).
 * Caller is responsible for discarding the source coordinates afterwards.
 */
export function encodeGeohash(lat: number, lng: number, precision = 6): string {
  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;
  let hash = "";
  let bit = 0;
  let ch = 0;
  let even = true; // start with longitude

  while (hash.length < precision) {
    if (even) {
      const mid = (lngMin + lngMax) / 2;
      if (lng >= mid) {
        ch = (ch << 1) | 1;
        lngMin = mid;
      } else {
        ch = ch << 1;
        lngMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        ch = (ch << 1) | 1;
        latMin = mid;
      } else {
        ch = ch << 1;
        latMax = mid;
      }
    }
    even = !even;
    if (bit < 4) {
      bit += 1;
    } else {
      hash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return hash;
}

export interface GeoBounds {
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
}

/** Decode a geohash back to the lat/lng bounding box of its cell. */
export function geohashToApproxBounds(hash: string): GeoBounds {
  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;
  let even = true;

  for (const c of hash) {
    const idx = BASE32.indexOf(c);
    if (idx < 0) continue;
    for (let mask = 16; mask >= 1; mask >>= 1) {
      const on = (idx & mask) !== 0;
      if (even) {
        const mid = (lngMin + lngMax) / 2;
        if (on) lngMin = mid;
        else lngMax = mid;
      } else {
        const mid = (latMin + latMax) / 2;
        if (on) latMin = mid;
        else latMax = mid;
      }
      even = !even;
    }
  }
  return { latMin, latMax, lngMin, lngMax };
}

/** The approximate center (lat, lng) of a geohash cell. */
export function geohashCenter(hash: string): { lat: number; lng: number } {
  const b = geohashToApproxBounds(hash);
  return { lat: (b.latMin + b.latMax) / 2, lng: (b.lngMin + b.lngMax) / 2 };
}

const EARTH_RADIUS_KM = 6371;
const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance in km between two lat/lng points (haversine). */
export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Distance in km between the centers of two geohash cells. */
export function geohashDistanceKm(a: string, b: string): number {
  return haversineKm(geohashCenter(a), geohashCenter(b));
}

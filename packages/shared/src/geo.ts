// Geography helpers shared by the API (validation, pricing) and the web app (map defaults).

export interface LatLng {
  lat: number;
  lng: number;
}

/** Generous bounding box around Addis Ababa's 11 sub-cities. */
export const ADDIS_BOUNDS = { south: 8.82, west: 38.62, north: 9.12, east: 38.93 } as const;

/** Meskel Square — a neutral default map centre. */
export const ADDIS_CENTER: LatLng = { lat: 9.0105, lng: 38.7614 };

export function isInAddis({ lat, lng }: LatLng): boolean {
  return (
    lat >= ADDIS_BOUNDS.south &&
    lat <= ADDIS_BOUNDS.north &&
    lng >= ADDIS_BOUNDS.west &&
    lng <= ADDIS_BOUNDS.east
  );
}

/** Great-circle distance in kilometres. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Coordinates are stored as NUMERIC(9,6): six decimals (~11 cm). */
export const roundCoord = (v: number) => Math.round(v * 1e6) / 1e6;

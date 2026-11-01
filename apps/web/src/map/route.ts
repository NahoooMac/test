import type { LatLng } from '@dp/shared';

const OSRM = 'https://router.project-osrm.org/route/v1/driving';

interface OsrmResponse {
  code: string;
  routes: Array<{
    geometry: { type: 'LineString'; coordinates: [number, number][] };
    distance: number;
    duration: number;
  }>;
}

const cache = new Map<string, [number, number][]>();

/** Fetch a road-following route from OSRM. Returns [lat,lng] pairs for Yandex Maps. */
export async function fetchRouteGeometry(
  from: LatLng,
  to: LatLng,
): Promise<[number, number][] | null> {
  const key = `${from.lat},${from.lng}-${to.lat},${to.lng}`;
  const cached = cache.get(key);
  if (cached) return cached;

  try {
    const url = `${OSRM}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data: OsrmResponse = await res.json();
    if (data.code !== 'Ok' || !data.routes[0]) return null;
    // OSRM returns [lng, lat]; Yandex Maps uses [lat, lng]
    const coords = data.routes[0].geometry.coordinates.map(
      ([lng, lat]) => [lat, lng] as [number, number],
    );
    cache.set(key, coords);
    return coords;
  } catch {
    return null;
  }
}

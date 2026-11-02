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

export interface NavStep {
  /** OSRM maneuver type: turn, new name, continue, roundabout, arrive, … */
  type: string;
  /** left, slight right, straight, uturn, … */
  modifier: string | undefined;
  /** Street the step continues on (may be empty). */
  name: string;
  exit: number | undefined;
  /** Index into `coords` where the maneuver happens. */
  at: number;
}

export interface NavRoute {
  /** [lat, lng] pairs along the road. */
  coords: [number, number][];
  distanceM: number;
  durationS: number;
  steps: NavStep[];
}

interface OsrmStepsResponse {
  code: string;
  routes: Array<{
    geometry: { coordinates: [number, number][] };
    distance: number;
    duration: number;
    legs: Array<{
      steps: Array<{
        name: string;
        maneuver: { type: string; modifier?: string; exit?: number; location: [number, number] };
      }>;
    }>;
  }>;
}

/** Road route with turn-by-turn steps, for in-app navigation. Null when routing is unavailable. */
export async function fetchNavRoute(from: LatLng, to: LatLng): Promise<NavRoute | null> {
  try {
    const url =
      `${OSRM}/${from.lng},${from.lat};${to.lng},${to.lat}` +
      '?overview=full&geometries=geojson&steps=true';
    const res = await fetch(url);
    if (!res.ok) return null;
    const data: OsrmStepsResponse = await res.json();
    const route = data.routes[0];
    if (data.code !== 'Ok' || !route) return null;
    const coords = route.geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]);
    // Each maneuver point lies on the geometry; find its index, searching forward only.
    let from_ = 0;
    const steps: NavStep[] = [];
    for (const s of route.legs.flatMap((l) => l.steps)) {
      const [lng, lat] = s.maneuver.location;
      let best = from_;
      let bestD = Infinity;
      for (let i = from_; i < coords.length; i++) {
        const d = (coords[i]![0] - lat) ** 2 + (coords[i]![1] - lng) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      from_ = best;
      steps.push({
        type: s.maneuver.type,
        modifier: s.maneuver.modifier,
        name: s.name,
        exit: s.maneuver.exit,
        at: best,
      });
    }
    return { coords, distanceM: route.distance, durationS: route.duration, steps };
  } catch {
    return null;
  }
}

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

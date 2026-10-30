import { isInAddis, roundCoord, type LatLng, type Place, type PlaceSuggestion } from '@dp/shared';
import type { GeoProvider } from './types.ts';

/** Offline stand-in for tests and for development without a Yandex key. */
const PLACES: Place[] = [
  {
    name: 'Meskel Square',
    description: 'Kirkos, Addis Ababa',
    lat: 9.0105,
    lng: 38.7614,
    subCity: 'kirkos',
    inServiceArea: true,
  },
  {
    name: 'Bole Medhanialem',
    description: 'Bole, Addis Ababa',
    lat: 8.9958,
    lng: 38.7869,
    subCity: 'bole',
    inServiceArea: true,
  },
  {
    name: 'Piassa',
    description: 'Arada, Addis Ababa',
    lat: 9.0326,
    lng: 38.7541,
    subCity: 'arada',
    inServiceArea: true,
  },
  {
    name: 'Megenagna',
    description: 'Yeka, Addis Ababa',
    lat: 9.0197,
    lng: 38.8027,
    subCity: 'yeka',
    inServiceArea: true,
  },
  {
    name: 'Merkato',
    description: 'Addis Ketema, Addis Ababa',
    lat: 9.0336,
    lng: 38.7404,
    subCity: 'addis-ketema',
    inServiceArea: true,
  },
  {
    name: 'Lideta',
    description: 'Lideta, Addis Ababa',
    lat: 9.0094,
    lng: 38.7347,
    subCity: 'lideta',
    inServiceArea: true,
  },
  {
    name: 'Akaki',
    description: 'Akaki Kality, Addis Ababa',
    lat: 8.8711,
    lng: 38.7864,
    subCity: 'akaki-kality',
    inServiceArea: true,
  },
];

export class FakeGeoProvider implements GeoProvider {
  readonly name = 'fake';

  async suggest(query: string): Promise<PlaceSuggestion[]> {
    const q = query.trim().toLowerCase();
    return PLACES.filter((p) => `${p.name} ${p.description}`.toLowerCase().includes(q)).map(
      (p) => ({
        ref: `fake:${p.name}`,
        name: p.name,
        description: p.description,
        subCity: p.subCity,
      }),
    );
  }

  async resolve(ref: string): Promise<Place | null> {
    return PLACES.find((p) => `fake:${p.name}` === ref) ?? null;
  }

  async reverse(point: LatLng): Promise<Place | null> {
    let best: Place | null = null;
    let bestD = Infinity;
    for (const p of PLACES) {
      const d = (p.lat - point.lat) ** 2 + (p.lng - point.lng) ** 2;
      if (d < bestD) [best, bestD] = [p, d];
    }
    if (!best) return null;
    return {
      ...best,
      name: `Near ${best.name}`,
      lat: roundCoord(point.lat),
      lng: roundCoord(point.lng),
      inServiceArea: isInAddis(point),
    };
  }
}

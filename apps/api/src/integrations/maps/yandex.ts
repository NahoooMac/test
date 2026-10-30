// Yandex Geosuggest + Geocoder, verified against Addis Ababa on 2026-10-31:
//  - Geosuggest knows landmarks and businesses (Edna Mall, Meskel Square) with sub-city + kebele.
//  - Geocoder resolves a suggestion's URI to exact coordinates, and reverse-geocodes map pins to
//    sub-city / woreda / street. On its own it does NOT find most landmarks by name.
import {
  ADDIS_BOUNDS,
  ADDIS_CENTER,
  isInAddis,
  roundCoord,
  type LatLng,
  type Place,
  type PlaceSuggestion,
} from '@dp/shared';
import { GeoProviderError, type GeoProvider } from './types.ts';
import { matchSubCity } from './sub-city.ts';

interface YandexComponent {
  kind: string;
  name: string;
}
interface YandexGeoObject {
  name?: string;
  Point?: { pos?: string };
  metaDataProperty?: { GeocoderMetaData?: { Address?: { Components?: YandexComponent[] } } };
}
interface GeocoderResponse {
  response?: { GeoObjectCollection?: { featureMember?: Array<{ GeoObject: YandexGeoObject }> } };
}
interface SuggestResponse {
  results?: Array<{ title?: { text?: string }; subtitle?: { text?: string }; uri?: string }>;
}

/** Tiny TTL cache: repeated searches and pin drops must not each cost a paid request. */
class TtlCache<V> {
  private readonly map = new Map<string, { value: V; expires: number }>();
  private readonly ttlMs: number;
  private readonly max: number;

  constructor(ttlMs: number, max = 2000) {
    this.ttlMs = ttlMs;
    this.max = max;
  }

  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expires < Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: V) {
    if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value!);
    this.map.set(key, { value, expires: Date.now() + this.ttlMs });
  }
}

export interface YandexGeoOptions {
  geocoderKey: string;
  suggestKey: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

const unique = (xs: string[]) => xs.filter((x, i) => x && xs.indexOf(x) === i);

export class YandexGeoProvider implements GeoProvider {
  readonly name = 'yandex';
  private readonly opts: YandexGeoOptions;
  private readonly fetchImpl: typeof fetch;
  private readonly suggestCache = new TtlCache<PlaceSuggestion[]>(10 * 60_000);
  private readonly resolveCache = new TtlCache<Place | null>(24 * 60 * 60_000);
  private readonly reverseCache = new TtlCache<Place | null>(24 * 60 * 60_000);

  constructor(opts: YandexGeoOptions) {
    this.opts = opts;
    this.fetchImpl = opts.fetch ?? fetch;
  }

  async suggest(query: string): Promise<PlaceSuggestion[]> {
    const key = query.trim().toLowerCase();
    const cached = this.suggestCache.get(key);
    if (cached) return cached;

    const b = ADDIS_BOUNDS;
    const params = new URLSearchParams({
      apikey: this.opts.suggestKey,
      text: query.trim(),
      ll: `${ADDIS_CENTER.lng},${ADDIS_CENTER.lat}`,
      spn: `${(b.east - b.west).toFixed(2)},${(b.north - b.south).toFixed(2)}`,
      strict_bounds: '1',
      lang: 'en',
      attrs: 'uri',
      print_address: '1',
      results: '7',
    });
    const body = await this.get<SuggestResponse>(
      `https://suggest-maps.yandex.ru/v1/suggest?${params}`,
    );
    const out = (body.results ?? []).flatMap((r) => {
      if (!r.uri || !r.title?.text) return [];
      const subtitle = r.subtitle?.text ?? '';
      // "Shopping mall · Addis Ababa, Bole, Kebele 30" → address parts after the category.
      const address = subtitle.includes('·') ? subtitle.split('·').slice(1).join('·') : subtitle;
      return [
        {
          ref: r.uri,
          name: r.title.text,
          description: subtitle || 'Addis Ababa',
          subCity: matchSubCity(address.split(',').map((s) => s.trim())),
        },
      ];
    });
    this.suggestCache.set(key, out);
    return out;
  }

  async resolve(ref: string): Promise<Place | null> {
    const cached = this.resolveCache.get(ref);
    if (cached !== undefined) return cached;
    const [place] = await this.geocode({ uri: ref }, 1);
    const result = place ?? null;
    this.resolveCache.set(ref, result);
    return result;
  }

  async reverse(point: LatLng): Promise<Place | null> {
    // ~11 m grid: nearby pin drops share a cache entry.
    const key = `${point.lat.toFixed(4)},${point.lng.toFixed(4)}`;
    const cached = this.reverseCache.get(key);
    if (cached !== undefined) return cached;
    const [first] = await this.geocode({ geocode: `${point.lng},${point.lat}` }, 1);
    // Keep the exact pin position; only the label comes from the geocoder.
    const place = first
      ? {
          ...first,
          lat: roundCoord(point.lat),
          lng: roundCoord(point.lng),
          inServiceArea: isInAddis(point),
        }
      : null;
    this.reverseCache.set(key, place);
    return place;
  }

  private async geocode(query: Record<string, string>, results: number): Promise<Place[]> {
    const b = ADDIS_BOUNDS;
    const params = new URLSearchParams({
      apikey: this.opts.geocoderKey,
      ...query,
      format: 'json',
      lang: 'en_US',
      results: String(results),
      bbox: `${b.west},${b.south}~${b.east},${b.north}`,
    });
    const body = await this.get<GeocoderResponse>(`https://geocode-maps.yandex.ru/v1/?${params}`);
    const members = body.response?.GeoObjectCollection?.featureMember ?? [];
    return members.flatMap(({ GeoObject: g }) => {
      const [lng, lat] = (g.Point?.pos ?? '').split(' ').map(Number);
      if (lng === undefined || lat === undefined || Number.isNaN(lat) || Number.isNaN(lng))
        return [];
      const components = g.metaDataProperty?.GeocoderMetaData?.Address?.Components ?? [];
      const names = unique(components.filter((c) => c.kind !== 'country').map((c) => c.name));
      const point = { lat: roundCoord(lat), lng: roundCoord(lng) };
      const name = g.name ?? names.at(-1) ?? 'Unnamed place';
      return [
        {
          name,
          // Broadest → narrowest, without repeating the name: "Addis Ababa, Kirkos, Kebele 63".
          description:
            names
              .filter((n) => n !== name)
              .slice(0, 3)
              .join(', ') || 'Addis Ababa',
          ...point,
          subCity: matchSubCity(names),
          inServiceArea: isInAddis(point),
        },
      ];
    });
  }

  private async get<T>(url: string): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, { signal: AbortSignal.timeout(this.opts.timeoutMs ?? 8000) });
    } catch {
      throw new GeoProviderError('UNAVAILABLE', 'Address search is unavailable right now.');
    }
    if (res.status === 401 || res.status === 403) {
      throw new GeoProviderError('AUTH', 'Address search is not configured correctly.');
    }
    if (res.status === 429) throw new GeoProviderError('QUOTA', 'Address search limit reached.');
    if (!res.ok)
      throw new GeoProviderError('UNAVAILABLE', 'Address search is unavailable right now.');
    return (await res.json()) as T;
  }
}

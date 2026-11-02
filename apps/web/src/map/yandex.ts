// Lazy loader for the Yandex Maps JavaScript API **v2.1**. The project's browser key is valid for
// v2.1 (verified 2026-10-31: renders Addis Ababa) but rejected by v3 ("Invalid api key"), so v2.1 is
// used until a v3 key exists. Only this public, domain-restrictable key is used in the browser;
// geocoding goes through our API so its key stays server-side.
// v2.1 coordinates are [lat, lng].

export type YCoords = [number, number];

export interface YGeoObject {
  readonly __brand?: 'YGeoObject';
  geometry?: { setCoordinates(coords: YCoords): void; getCoordinates(): YCoords };
  options?: { set(key: string, value: unknown): void };
}

export interface YRoutePath {
  geometry: { getCoordinates(): YCoords[] };
}

export interface YRoute extends YGeoObject {
  getPaths(): { get(i: number): YRoutePath; getLength(): number };
}

export interface YMap {
  getCenter(): YCoords;
  setCenter(center: YCoords, zoom?: number, options?: object): Promise<void>;
  getZoom(): number;
  setZoom(zoom: number, options?: object): Promise<void>;
  setBounds(bounds: [YCoords, YCoords], options?: object): Promise<void>;
  geoObjects: { add(o: YGeoObject): void; remove(o: YGeoObject): void };
  behaviors: { disable(names: string[]): void };
  events: { add(type: string, handler: () => void): void };
  container: { fitToViewport(): void };
  converter: { globalToPage(coords: YCoords): [number, number] };
  destroy(): void;
}

export interface Ymaps21 {
  ready(cb: () => void, err?: (e: unknown) => void): void;
  Map: new (el: HTMLElement, state: object, options?: object) => YMap;
  Placemark: new (coords: YCoords, properties: object, options: object) => YGeoObject;
  Polyline: new (coords: YCoords[], properties: object, options: object) => YGeoObject;
  templateLayoutFactory: { createClass(template: string): unknown };
  route(points: YCoords[], params?: object): Promise<YRoute>;
  projection: { fromGlobalPixels(gp: [number, number], zoom: number): YCoords };
}

declare global {
  interface Window {
    ymaps?: Ymaps21;
  }
}

const KEY = import.meta.env.VITE_YANDEX_JS_KEY;
let loading: Promise<Ymaps21 | null> | null = null;

/** Why the map could not load, for the dev-only hint in MapView. */
export let ymapsFailure: string | null = null;

/** Resolves to null (never throws) when the key is missing or the API cannot load. */
export function loadYmaps(): Promise<Ymaps21 | null> {
  if (loading) return loading;
  loading = new Promise((resolve) => {
    const fail = (why: string) => {
      ymapsFailure = why;
      console.error(`[map] ${why}`);
      loading = null; // the next map that mounts tries again
      resolve(null);
    };
    if (!KEY) return fail('VITE_YANDEX_JS_KEY is not set');
    const done = () =>
      window.ymaps!.ready(
        () => resolve(window.ymaps!),
        (e) => fail(`ymaps.ready failed: ${(e as Error)?.message ?? String(e)}`),
      );
    if (window.ymaps) return done();
    document.querySelector('script[data-ymaps]')?.remove();
    const script = document.createElement('script');
    script.src = `https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(KEY)}&lang=en_US`;
    script.async = true;
    script.dataset.ymaps = '';
    // Slow phone connections can take a while for the first, large download.
    const timer = setTimeout(() => fail('timed out loading api-maps.yandex.ru'), 30_000);
    script.onload = () => {
      clearTimeout(timer);
      if (window.ymaps) done();
      else fail('script loaded but window.ymaps is missing');
    };
    script.onerror = () => {
      clearTimeout(timer);
      fail('could not download api-maps.yandex.ru (blocked or offline)');
    };
    document.head.appendChild(script);
  });
  return loading;
}

// Lazy loader for the Yandex Maps JavaScript API **v2.1**. The project's browser key is valid for
// v2.1 (verified 2026-10-31: renders Addis Ababa) but rejected by v3 ("Invalid api key"), so v2.1 is
// used until a v3 key exists. Only this public, domain-restrictable key is used in the browser;
// geocoding goes through our API so its key stays server-side.
// v2.1 coordinates are [lat, lng].

export type YCoords = [number, number];

export interface YGeoObject {
  readonly __brand?: 'YGeoObject';
}

export interface YMap {
  getCenter(): YCoords;
  setCenter(center: YCoords, zoom?: number, options?: object): Promise<void>;
  setBounds(bounds: [YCoords, YCoords], options?: object): Promise<void>;
  geoObjects: { add(o: YGeoObject): void; remove(o: YGeoObject): void };
  behaviors: { disable(names: string[]): void };
  events: { add(type: string, handler: () => void): void };
  container: { fitToViewport(): void };
  destroy(): void;
}

export interface Ymaps21 {
  ready(cb: () => void, err?: (e: unknown) => void): void;
  Map: new (el: HTMLElement, state: object, options?: object) => YMap;
  Placemark: new (coords: YCoords, properties: object, options: object) => YGeoObject;
  Polyline: new (coords: YCoords[], properties: object, options: object) => YGeoObject;
  templateLayoutFactory: { createClass(template: string): unknown };
}

declare global {
  interface Window {
    ymaps?: Ymaps21;
  }
}

const KEY = import.meta.env.VITE_YANDEX_JS_KEY;
let loading: Promise<Ymaps21 | null> | null = null;

/** Resolves to null (never throws) when the key is missing or the API cannot load. */
export function loadYmaps(): Promise<Ymaps21 | null> {
  if (loading) return loading;
  loading = new Promise((resolve) => {
    if (!KEY) return resolve(null);
    const done = () =>
      window.ymaps!.ready(
        () => resolve(window.ymaps!),
        () => resolve(null),
      );
    if (window.ymaps) return done();
    const script = document.createElement('script');
    script.src = `https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(KEY)}&lang=en_US`;
    script.async = true;
    const timer = setTimeout(() => resolve(null), 15_000);
    script.onload = () => {
      clearTimeout(timer);
      if (window.ymaps) done();
      else resolve(null);
    };
    script.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    document.head.appendChild(script);
  });
  return loading;
}

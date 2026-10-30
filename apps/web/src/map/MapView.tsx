import { useEffect, useRef, useState } from 'react';
import { MapPinOff } from 'lucide-react';
import { ADDIS_CENTER, type LatLng } from '@dp/shared';
import { cn, Spinner } from '../ui/index.ts';
import { loadYmaps, type YCoords, type YGeoObject, type YMap, type Ymaps21 } from './yandex.ts';

export interface MapMarker {
  id: string;
  point: LatLng;
  kind: 'pickup' | 'dropoff' | 'rider';
}

const toCoords = (p: LatLng): YCoords => [p.lat, p.lng];

// HTML layouts are positioned with their top-left at the coordinate, so each is offset to sit on it.
const MARKER_HTML: Record<MapMarker['kind'], string> = {
  pickup:
    '<div style="position:absolute;left:-11px;top:-11px;width:22px;height:22px;border-radius:999px;background:var(--c-surface);border:5px solid var(--c-ink);box-sizing:border-box;box-shadow:0 2px 6px rgba(0,0,0,.3)"></div>',
  dropoff:
    '<svg style="position:absolute;left:-15px;top:-38px" width="30" height="38" viewBox="0 0 30 38"><path d="M15 0C6.7 0 0 6.6 0 14.8 0 26 15 38 15 38s15-12 15-23.2C30 6.6 23.3 0 15 0z" fill="var(--c-ink)"/><circle cx="15" cy="14.5" r="6" fill="var(--c-accent)"/></svg>',
  rider:
    '<div style="position:absolute;left:-15px;top:-15px;width:30px;height:30px;border-radius:999px;background:var(--c-accent);border:3px solid var(--c-surface);box-sizing:border-box;box-shadow:0 2px 8px rgba(0,0,0,.35)"></div>',
};

/**
 * Yandex map with our markers and a pickup→drop-off line. Falls back to a neutral panel when the
 * map cannot load, so booking still works through address search.
 */
export function MapView({
  center = ADDIS_CENTER,
  zoom = 13,
  markers = [],
  line,
  fit = false,
  interactive = true,
  onMoveEnd,
  className,
}: {
  center?: LatLng;
  zoom?: number;
  markers?: MapMarker[];
  line?: [LatLng, LatLng] | null;
  /** Zoom to show all markers. */
  fit?: boolean;
  interactive?: boolean;
  onMoveEnd?: (center: LatLng) => void;
  className?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const api = useRef<{ ymaps: Ymaps21; map: YMap } | null>(null);
  const overlays = useRef<YGeoObject[]>([]);
  const moveEnd = useRef(onMoveEnd);
  moveEnd.current = onMoveEnd;
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    void loadYmaps().then((ymaps) => {
      if (cancelled || !container.current) return;
      if (!ymaps) return setState('unavailable');
      try {
        const map = new ymaps.Map(
          container.current,
          { center: toCoords(center), zoom, controls: [] },
          { suppressMapOpenBlock: true, yandexMapDisablePoiInteractivity: true },
        );
        if (!interactive) {
          map.behaviors.disable([
            'drag',
            'scrollZoom',
            'dblClickZoom',
            'multiTouch',
            'rightMouseButtonMagnifier',
          ]);
        }
        map.events.add('actionend', () => {
          const [lat, lng] = map.getCenter();
          moveEnd.current?.({ lat, lng });
        });
        api.current = { ymaps, map };
        setState('ready');
      } catch {
        setState('unavailable');
      }
    });
    return () => {
      cancelled = true;
      api.current?.map.destroy();
      api.current = null;
    };
    // The map is created once; later prop changes are applied by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Markers and route line.
  const overlayKey = JSON.stringify(markers) + JSON.stringify(line);
  useEffect(() => {
    const a = api.current;
    if (state !== 'ready' || !a) return;
    for (const o of overlays.current) a.map.geoObjects.remove(o);
    overlays.current = [];
    if (line) {
      const polyline = new a.ymaps.Polyline(
        line.map(toCoords),
        {},
        {
          strokeColor: '#15171a',
          strokeWidth: 4,
          strokeStyle: 'shortdash',
          strokeOpacity: 0.8,
        },
      );
      a.map.geoObjects.add(polyline);
      overlays.current.push(polyline);
    }
    for (const m of markers) {
      const placemark = new a.ymaps.Placemark(
        toCoords(m.point),
        {},
        {
          iconLayout: a.ymaps.templateLayoutFactory.createClass(MARKER_HTML[m.kind]),
          iconShape: { type: 'Circle', coordinates: [0, 0], radius: 16 },
        },
      );
      a.map.geoObjects.add(placemark);
      overlays.current.push(placemark);
    }
    if (fit && markers.length > 1) {
      const lats = markers.map((m) => m.point.lat);
      const lngs = markers.map((m) => m.point.lng);
      void a.map.setBounds(
        [
          [Math.min(...lats), Math.min(...lngs)],
          [Math.max(...lats), Math.max(...lngs)],
        ],
        { checkZoomRange: true, zoomMargin: 48, duration: 250 },
      );
    }
    // overlayKey captures markers/line by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, overlayKey, fit]);

  // Recentre when the caller moves the centre (e.g. a search result was chosen).
  const centerKey = `${center.lat},${center.lng}`;
  useEffect(() => {
    if (state === 'ready' && !fit)
      void api.current?.map.setCenter(toCoords(center), undefined, { duration: 250 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, centerKey]);

  return (
    // The caller sizes/positions the outer box (a height, or absolute inset-0); the inner box is
    // always the positioning context, so caller classes can never collapse the map to 0 px.
    <div className={cn('overflow-hidden bg-surface-2', className)}>
      <div className="relative h-full w-full">
        <div ref={container} className="absolute inset-0" />
        {state === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center text-ink-3">
            <Spinner className="size-6" />
          </div>
        )}
        {state === 'unavailable' && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-sm text-ink-3"
            style={{
              backgroundImage:
                'linear-gradient(var(--c-line) 1px, transparent 1px), linear-gradient(90deg, var(--c-line) 1px, transparent 1px)',
              backgroundSize: '40px 40px',
            }}
          >
            <MapPinOff className="size-6" aria-hidden />
            <span className="rounded-full bg-surface px-3 py-1">
              Map unavailable — address search still works
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

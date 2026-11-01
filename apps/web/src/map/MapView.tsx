import { useEffect, useRef, useState } from 'react';
import { MapPinOff } from 'lucide-react';
import { ADDIS_CENTER, type LatLng } from '@dp/shared';
import { cn, Spinner } from '../ui/index.ts';
import { loadYmaps, type YCoords, type YGeoObject, type YMap, type Ymaps21 } from './yandex.ts';
import { fetchRouteGeometry } from './route.ts';
import { buildVehiclePlacemarkHtml } from './vehicle3d.ts';
import { animateMarker, headingBetween, stopAnimation } from './animate.ts';

export interface MapMarker {
  id: string;
  point: LatLng;
  kind: 'pickup' | 'dropoff' | 'rider';
  vehicleType?: 'motorcycle' | 'bicycle';
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


const riderHtml = (vehicleType?: 'motorcycle' | 'bicycle') => {
  if (vehicleType) return buildVehiclePlacemarkHtml(vehicleType);
  return MARKER_HTML.rider;
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
  const riderPlacemarks = useRef<Map<string, { obj: YGeoObject; coords: YCoords; kind: string }>>(new Map());
  const routeCoords = useRef<YCoords[]>([]);
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
    let cancelled = false;
    for (const o of overlays.current) a.map.geoObjects.remove(o);
    overlays.current = [];

    const addRoute = (coords: YCoords[]) => {
      if (cancelled) return;
      const polyline = new a.ymaps.Polyline(coords, {}, {
        strokeColor: '#0e6b4a',
        strokeWidth: 5,
        strokeOpacity: 0.9,
      });
      a.map.geoObjects.add(polyline);
      overlays.current.push(polyline);
    };

    if (line) {
      const from = toCoords(line[0]);
      const to = toCoords(line[1]);
      void fetchRouteGeometry(line[0], line[1]).then((coords) => {
        if (cancelled) return;
        if (coords) {
          routeCoords.current = coords;
          addRoute(coords);
        } else {
          routeCoords.current = [from, to];
          addRoute([from, to]);
        }
      });
    }

    const seenRiders = new Set<string>();

    for (const m of markers) {
      if (m.kind === 'rider') {
        seenRiders.add(m.id);
        const newCoords = toCoords(m.point);
        const existing = riderPlacemarks.current.get(m.id);

        if (existing) {
          // Animate to new position if it changed
          const moved = existing.coords[0] !== newCoords[0] || existing.coords[1] !== newCoords[1];
          if (moved) {
            const heading = headingBetween(existing.coords, newCoords);
            // Re-render the 3D icon with updated heading
            if (m.vehicleType) {
              const newHtml = buildVehiclePlacemarkHtml(m.vehicleType, heading);
              const newLayout = a.ymaps.templateLayoutFactory.createClass(newHtml);
              existing.obj.options?.set('iconLayout', newLayout);
            }
            animateMarker(m.id, existing.obj, existing.coords, newCoords, 1000);
            existing.coords = newCoords;
          }
        } else {
          const html = riderHtml(m.vehicleType);
          const isVehicleRider = !!m.vehicleType;
          const placemark = new a.ymaps.Placemark(
            newCoords,
            {},
            {
              iconLayout: a.ymaps.templateLayoutFactory.createClass(html),
              iconShape: isVehicleRider
                ? { type: 'Circle', coordinates: [0, 0], radius: 48 }
                : { type: 'Circle', coordinates: [0, 0], radius: 16 },
            },
          );
          a.map.geoObjects.add(placemark);
          riderPlacemarks.current.set(m.id, {
            obj: placemark,
            coords: newCoords,
            kind: m.vehicleType ?? 'rider',
          });
        }
      } else {
        const html = MARKER_HTML[m.kind];
        const placemark = new a.ymaps.Placemark(
          toCoords(m.point),
          {},
          {
            iconLayout: a.ymaps.templateLayoutFactory.createClass(html),
            iconShape: { type: 'Circle', coordinates: [0, 0], radius: 16 },
          },
        );
        a.map.geoObjects.add(placemark);
        overlays.current.push(placemark);
      }
    }

    // Remove stale rider placemarks
    for (const [id, entry] of riderPlacemarks.current) {
      if (!seenRiders.has(id)) {
        stopAnimation(id);
        a.map.geoObjects.remove(entry.obj);
        riderPlacemarks.current.delete(id);
      }
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
    return () => {
      cancelled = true;
      // Clean up rider placemarks and animations
      for (const [id, entry] of riderPlacemarks.current) {
        stopAnimation(id);
        a.map.geoObjects.remove(entry.obj);
      }
      riderPlacemarks.current.clear();
    };
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

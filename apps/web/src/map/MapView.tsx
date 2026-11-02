import { useEffect, useRef, useState } from 'react';
import { MapPinOff, Minus, Plus } from 'lucide-react';
import { ADDIS_CENTER, type LatLng } from '@dp/shared';
import { cn, Spinner } from '../ui/index.ts';
import { loadYmaps, ymapsFailure, type YCoords, type YGeoObject, type YMap, type Ymaps21 } from './yandex.ts';
import { fetchRouteGeometry } from './route.ts';
import { animateMarker, headingBetween, stopAnimation } from './animate.ts';

export interface MapMarker {
  id: string;
  point: LatLng;
  kind: 'pickup' | 'dropoff' | 'rider';
  vehicleType?: 'motorcycle' | 'bicycle' | 'scooter';
  /** Rider direction in radians (0 = north, clockwise), e.g. from GPS. */
  heading?: number;
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

const labeledMarkerHtml = (kind: 'pickup' | 'dropoff', label: string): string => {
  const pin = MARKER_HTML[kind];
  const offsetY = kind === 'dropoff' ? -48 : -22;
  return (
    `<div style="position:relative">` +
    pin +
    `<div style="position:absolute;left:50%;top:${offsetY}px;transform:translateX(-50%);` +
    `white-space:nowrap;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;letter-spacing:0.02em;` +
    `background:var(--c-surface);color:var(--c-ink);box-shadow:0 2px 8px rgba(0,0,0,.18);` +
    `pointer-events:none">${label}</div>` +
    `</div>`
  );
};


/**
 * Rider marker: a navigation arrow (like turn-by-turn apps) that points along `heading` (radians,
 * 0 = north, clockwise). Plain SVG, so maps never pull in a 3D library.
 */
const riderHtml = (heading = 0) =>
  `<div style="position:absolute;left:-19px;top:-19px;width:38px;height:38px;` +
  `transform:rotate(${(heading * 180) / Math.PI}deg);filter:drop-shadow(0 2px 4px rgba(15,23,42,.35))">` +
  `<svg width="38" height="38" viewBox="0 0 38 38"><circle cx="19" cy="19" r="17" fill="var(--c-accent)" opacity=".16"/>` +
  `<path d="M19 6l10 24-10-6-10 6z" fill="var(--c-accent)" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"/></svg></div>`;

/**
 * Yandex map with our markers and a pickup→drop-off line. Falls back to a neutral panel when the
 * map cannot load, so booking still works through address search.
 */
export function MapView({
  center = ADDIS_CENTER,
  zoom = 13,
  markers = [],
  line,
  path,
  fit = false,
  interactive = true,
  scrollZoom = false,
  zoomControls = interactive,
  recenterKey,
  onMoveEnd,
  onUserGesture,
  labels,
  className,
}: {
  center?: LatLng;
  zoom?: number;
  markers?: MapMarker[];
  /** Two stops; the road route between them is fetched and drawn. */
  line?: [LatLng, LatLng] | null;
  /** A ready-made route to draw as-is (e.g. in-app navigation). */
  path?: LatLng[] | null;
  /** Zoom to show all markers (when the stops change; a moving rider does not re-zoom). */
  fit?: boolean;
  /** Drag and pinch-zoom. */
  interactive?: boolean;
  /** Mouse-wheel zoom. Off by default so a map inside a scrolling page does not trap the wheel. */
  scrollZoom?: boolean;
  /** + / − buttons. */
  zoomControls?: boolean;
  /** Change it to recentre on `center` even when `center` itself has not changed. */
  recenterKey?: number | string;
  onMoveEnd?: (center: LatLng) => void;
  /** The user touched or dragged the map. */
  onUserGesture?: () => void;
  labels?: { pickup?: string; dropoff?: string };
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
  const [failure, setFailure] = useState<string | null>(null);

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    void loadYmaps().then((ymaps) => {
      if (cancelled || !container.current) return;
      if (!ymaps) {
        setFailure(ymapsFailure);
        return setState('unavailable');
      }
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
        } else if (!scrollZoom) {
          map.behaviors.disable(['scrollZoom']);
        }
        map.events.add('actionend', () => {
          const [lat, lng] = map.getCenter();
          moveEnd.current?.({ lat, lng });
        });
        api.current = { ymaps, map };
        setState('ready');
      } catch (err) {
        console.error('[map] could not create the map', err);
        setFailure(`new ymaps.Map failed: ${(err as Error)?.message ?? String(err)}`);
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
  const overlayKey =
    JSON.stringify(markers) + JSON.stringify(line) + JSON.stringify(path) + JSON.stringify(labels);
  // Re-fit only when the stops change, so a live rider update never undoes the user's zoom.
  const fitKey = JSON.stringify(
    markers.map((m) => (m.kind === 'rider' ? m.id : [m.id, m.point.lat, m.point.lng])),
  );
  const fittedKey = useRef<string | null>(null);
  useEffect(() => {
    const a = api.current;
    if (state !== 'ready' || !a) return;
    let cancelled = false;
    const placemarks = riderPlacemarks.current;
    for (const o of overlays.current) a.map.geoObjects.remove(o);
    overlays.current = [];

    const addRoute = (coords: YCoords[]) => {
      if (cancelled) return;
      const polyline = new a.ymaps.Polyline(coords, {}, {
        strokeColor: '#2563eb',
        strokeWidth: 5,
        strokeOpacity: 0.95,
      });
      a.map.geoObjects.add(polyline);
      overlays.current.push(polyline);
    };

    if (path && path.length > 1) {
      addRoute(path.map(toCoords));
    } else if (line) {
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
        const existing = placemarks.get(m.id);

        if (existing) {
          // Animate to new position if it changed
          const moved = existing.coords[0] !== newCoords[0] || existing.coords[1] !== newCoords[1];
          if (moved) {
            // Point the arrow the way the rider just moved.
            const heading = m.heading ?? headingBetween(existing.coords, newCoords);
            const newLayout = a.ymaps.templateLayoutFactory.createClass(riderHtml(heading));
            existing.obj.options?.set('iconLayout', newLayout);
            animateMarker(m.id, existing.obj, existing.coords, newCoords, 1000);
            existing.coords = newCoords;
          }
        } else {
          const placemark = new a.ymaps.Placemark(
            newCoords,
            {},
            {
              iconLayout: a.ymaps.templateLayoutFactory.createClass(riderHtml(m.heading ?? 0)),
              iconShape: { type: 'Circle', coordinates: [0, 0], radius: 19 },
            },
          );
          a.map.geoObjects.add(placemark);
          placemarks.set(m.id, {
            obj: placemark,
            coords: newCoords,
            kind: m.vehicleType ?? 'rider',
          });
        }
      } else {
        const lbl = labels && (m.kind === 'pickup' ? labels.pickup : m.kind === 'dropoff' ? labels.dropoff : undefined);
        const html = lbl ? labeledMarkerHtml(m.kind as 'pickup' | 'dropoff', lbl) : MARKER_HTML[m.kind];
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
    for (const [id, entry] of placemarks) {
      if (!seenRiders.has(id)) {
        stopAnimation(id);
        a.map.geoObjects.remove(entry.obj);
        placemarks.delete(id);
      }
    }
    if (fit && markers.length > 1 && fittedKey.current !== fitKey) {
      fittedKey.current = fitKey;
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
      for (const [id, entry] of placemarks) {
        stopAnimation(id);
        a.map.geoObjects.remove(entry.obj);
      }
      placemarks.clear();
    };
    // overlayKey captures markers/line by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, overlayKey, fit]);

  // Recentre when the caller moves the centre (e.g. a search result was chosen).
  const centerKey = `${center.lat},${center.lng},${recenterKey ?? ''}`;
  useEffect(() => {
    if (state === 'ready' && !fit)
      void api.current?.map.setCenter(toCoords(center), undefined, { duration: 250 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, centerKey]);

  const zoomBy = (delta: number) => {
    const map = api.current?.map;
    if (map) void map.setZoom(map.getZoom() + delta, { checkZoomRange: true, duration: 200 });
  };

  return (
    // The caller sizes/positions the outer box (a height, or absolute inset-0); the inner box is
    // always the positioning context, so caller classes can never collapse the map to 0 px.
    <div className={cn('overflow-hidden bg-surface-2', className)}>
      <div className="relative h-full w-full">
        <div
          ref={container}
          className="absolute inset-0"
          onPointerDown={onUserGesture}
          onTouchStart={onUserGesture}
        />
        {state === 'ready' && zoomControls && (
          <div className="absolute top-1/2 right-3 z-10 flex -translate-y-1/2 flex-col overflow-hidden rounded-[var(--radius-md)] border border-line bg-surface shadow-[var(--shadow-md)]">
            <button
              type="button"
              aria-label="Zoom in"
              onClick={() => zoomBy(1)}
              className="flex size-10 items-center justify-center text-ink hover:bg-surface-2 active:bg-surface-2"
            >
              <Plus className="size-5" aria-hidden />
            </button>
            <span className="mx-2 h-px bg-line" aria-hidden />
            <button
              type="button"
              aria-label="Zoom out"
              onClick={() => zoomBy(-1)}
              className="flex size-10 items-center justify-center text-ink hover:bg-surface-2 active:bg-surface-2"
            >
              <Minus className="size-5" aria-hidden />
            </button>
          </div>
        )}
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
            {import.meta.env.DEV && failure && (
              <span className="max-w-xs font-mono text-xs break-words text-danger">{failure}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

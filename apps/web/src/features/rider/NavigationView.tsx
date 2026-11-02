import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  CornerUpLeft,
  CornerUpRight,
  Flag,
  LocateFixed,
  Phone,
  RefreshCw,
  Undo2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { haversineKm, type LatLng, type VehicleType } from '@dp/shared';
import { geoProblemNow } from '../../lib/geo.ts';
import { MapView, type MapMarker } from '../../map/MapView.tsx';
import { fetchNavRoute, type NavRoute, type NavStep } from '../../map/route.ts';
import { Button, Notice, Spinner } from '../../ui/index.ts';

const OFF_ROUTE_M = 60;
const ARRIVED_M = 40;
const REROUTE_MIN_GAP_MS = 8000;

const meters = (a: LatLng, b: LatLng) => haversineKm(a, b) * 1000;
const pt = (c: [number, number]): LatLng => ({ lat: c[0], lng: c[1] });

/** Closest route vertex to `p`, and how far away it is. */
function nearest(coords: [number, number][], p: LatLng): { index: number; distM: number } {
  let index = 0;
  let distM = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const d = meters(p, pt(coords[i]!));
    if (d < distM) {
      distM = d;
      index = i;
    }
  }
  return { index, distM };
}

/** Distance along the route from vertex `from` to vertex `to`. */
function along(coords: [number, number][], from: number, to: number): number {
  let m = 0;
  for (let i = from; i < to; i++) m += meters(pt(coords[i]!), pt(coords[i + 1]!));
  return m;
}

function maneuverIcon(step: NavStep): LucideIcon {
  if (step.type === 'arrive') return Flag;
  if (step.type === 'roundabout' || step.type === 'rotary') return RefreshCw;
  switch (step.modifier) {
    case 'left':
    case 'sharp left':
      return CornerUpLeft;
    case 'right':
    case 'sharp right':
      return CornerUpRight;
    case 'slight left':
      return ArrowUpLeft;
    case 'slight right':
      return ArrowUpRight;
    case 'uturn':
      return Undo2;
    default:
      return ArrowUp;
  }
}

const MODIFIER_KEY: Record<string, string> = {
  left: 'left',
  right: 'right',
  'slight left': 'slightLeft',
  'slight right': 'slightRight',
  'sharp left': 'sharpLeft',
  'sharp right': 'sharpRight',
  straight: 'straight',
  uturn: 'uturn',
};

/**
 * Turn-by-turn navigation inside the app: follows the rider's GPS on the map, draws the road route
 * to the stop, shows the next turn, and re-routes when the rider leaves the route.
 */
export function NavigationView({
  target,
  title,
  contactPhone,
  position,
  vehicleType,
  onClose,
}: {
  target: LatLng & { address: string };
  title: string;
  contactPhone: string;
  position: LatLng | null;
  vehicleType: VehicleType;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [route, setRoute] = useState<NavRoute | null>(null);
  const [routeFailed, setRouteFailed] = useState(false);
  const [following, setFollowing] = useState(true);
  const [recenter, setRecenter] = useState(0);
  const lastFetch = useRef(0);
  const fetching = useRef(false);
  // While following, the map centre tracks the rider; after the user pans it stays put.
  const viewCenter = useRef<LatLng>(position ?? target);
  if (following && position) viewCenter.current = position;

  const near = useMemo(
    () => (route && position ? nearest(route.coords, position) : null),
    [route, position],
  );
  const toTargetM = position ? meters(position, target) : null;
  const arrived = toTargetM !== null && toTargetM < ARRIVED_M;

  // Route from where the rider is; again whenever they wander off it.
  const offRoute = !!near && near.distM > OFF_ROUTE_M;
  const needRoute = !!position && !arrived && (!route || offRoute);
  useEffect(() => {
    if (!needRoute || !position || fetching.current) return;
    const wait = Math.max(0, lastFetch.current + REROUTE_MIN_GAP_MS - Date.now());
    const id = setTimeout(async () => {
      fetching.current = true;
      lastFetch.current = Date.now();
      const r = await fetchNavRoute(position, target);
      fetching.current = false;
      if (r) {
        setRoute(r);
        setRouteFailed(false);
      } else {
        setRouteFailed(true);
      }
    }, wait);
    return () => clearTimeout(id);
  }, [needRoute, position, target]);

  const nextStep =
    route && near
      ? route.steps.find((s) => s.at > near.index && s.type !== 'depart') ??
        route.steps[route.steps.length - 1]
      : undefined;
  const toStepM = route && near && nextStep ? along(route.coords, near.index, nextStep.at) : null;
  const remainingM =
    route && near && position
      ? near.distM + along(route.coords, near.index, route.coords.length - 1)
      : null;
  const remainingMin =
    route && remainingM !== null
      ? Math.max(1, Math.round((route.durationS * (remainingM / Math.max(route.distanceM, 1))) / 60))
      : null;

  const fmt = (m: number) =>
    m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(1)} km`;

  const instruction = (s: NavStep) => {
    if (s.type === 'arrive') return t('rider.nav.arrive');
    if (s.type === 'roundabout' || s.type === 'rotary')
      return s.exit ? t('rider.nav.roundaboutExit', { n: s.exit }) : t('rider.nav.roundabout');
    const key = s.modifier ? MODIFIER_KEY[s.modifier] : undefined;
    return key ? t(`rider.nav.turn.${key}`) : t('rider.nav.continue');
  };

  const markers: MapMarker[] = [
    { id: 'target', point: target, kind: 'dropoff' },
    ...(position ? [{ id: 'me', point: position, kind: 'rider' as const, vehicleType }] : []),
  ];
  const remainingPath = route && near ? route.coords.slice(near.index).map(pt) : null;
  const gpsProblem = geoProblemNow();
  const StepIcon = nextStep ? maneuverIcon(nextStep) : ArrowUp;

  return (
    <div className="fixed inset-0 z-50 mx-auto flex max-w-md flex-col bg-canvas" role="dialog" aria-label={title}>
      <div className="relative flex-1">
        <MapView
          className="absolute inset-0"
          center={viewCenter.current}
          zoom={17}
          recenterKey={recenter}
          markers={markers}
          path={remainingPath ?? (position ? [position, target] : null)}
          fit={!position}
          scrollZoom
          onUserGesture={() => setFollowing(false)}
        />

        {/* Next turn */}
        <div className="absolute inset-x-0 top-0 p-3">
          <div className="flex items-center gap-3 rounded-[var(--radius-xl)] bg-navy p-4 text-navy-ink shadow-[var(--shadow-xl)]">
            {arrived ? (
              <>
                <Flag className="size-9 shrink-0 text-accent-2" aria-hidden />
                <p className="text-xl font-bold">{t('rider.nav.arrived')}</p>
              </>
            ) : nextStep && toStepM !== null ? (
              <>
                <StepIcon className="size-10 shrink-0 text-accent-2" aria-hidden />
                <div className="min-w-0">
                  <p className="text-[26px] leading-none font-bold tabular">{fmt(toStepM)}</p>
                  <p className="mt-1 truncate text-[15px] font-semibold">
                    {instruction(nextStep)}
                    {nextStep.name && nextStep.type !== 'arrive' && (
                      <span className="font-normal text-navy-ink/70"> · {nextStep.name}</span>
                    )}
                  </p>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-3 text-[15px] font-medium">
                {position ? <Spinner className="size-5" /> : <LocateFixed className="size-5" aria-hidden />}
                {position ? t('rider.nav.routing') : t('rider.nav.waitingGps')}
              </div>
            )}
          </div>
          {routeFailed && !route && (
            <Notice tone="warning" className="mt-2">
              {t('rider.nav.routeError')}
            </Notice>
          )}
          {!position && gpsProblem && (
            <Notice tone="warning" className="mt-2">
              {t(gpsProblem === 'insecure' ? 'rider.nav.insecure' : 'rider.nav.noGps')}
            </Notice>
          )}
        </div>

        {!following && position && (
          <button
            type="button"
            onClick={() => {
              setFollowing(true);
              setRecenter((n) => n + 1);
            }}
            className="absolute bottom-4 left-4 flex h-11 items-center gap-2 rounded-full bg-surface px-4 text-sm font-semibold shadow-[var(--shadow-lg)]"
          >
            <LocateFixed className="size-4 text-accent" aria-hidden />
            {t('rider.nav.recenter')}
          </button>
        )}
      </div>

      <div className="rounded-t-[var(--radius-2xl)] border-t border-line bg-surface px-4 pt-4 pb-safe shadow-[var(--shadow-xl)]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {remainingM !== null && remainingMin !== null && !arrived && (
              <p className="text-[22px] font-bold tabular">
                {remainingMin} min <span className="text-base font-medium text-ink-3">· {fmt(remainingM)}</span>
              </p>
            )}
            <p className="text-xs font-medium tracking-wide text-ink-3 uppercase">{title}</p>
            <p className="truncate text-[15px] font-semibold">{target.address}</p>
          </div>
          <a
            href={`tel:${contactPhone}`}
            aria-label={t('rider.job.call')}
            className="inline-flex size-12 shrink-0 items-center justify-center rounded-[var(--radius-lg)] bg-accent-soft text-accent"
          >
            <Phone className="size-5" aria-hidden />
          </a>
        </div>
        <Button
          variant="secondary"
          size="lg"
          block
          className="mt-3"
          icon={<X className="size-5" aria-hidden />}
          onClick={onClose}
        >
          {t('rider.nav.exit')}
        </Button>
      </div>
    </div>
  );
}

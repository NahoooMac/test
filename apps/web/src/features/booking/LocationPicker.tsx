import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, LocateFixed, Map as MapIcon, MapPin, Search } from 'lucide-react';
import {
  ADDIS_CENTER,
  haversineKm,
  isInAddis,
  type LatLng,
  type Place,
  type PlaceSuggestion,
} from '@dp/shared';
import { api } from '../../lib/api.ts';
import { MapView } from '../../map/MapView.tsx';
import { Button, IconButton, Notice, Skeleton, Spinner, cn } from '../../ui/index.ts';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

const resolve = (ref: string) => api<Place | null>(`/geo/resolve?ref=${encodeURIComponent(ref)}`);

const reverse = (p: LatLng) =>
  api<Place | null>(`/geo/reverse?lat=${p.lat.toFixed(6)}&lng=${p.lng.toFixed(6)}`);

/**
 * Full-screen location chooser: landmark search first (Yandex knows areas and landmarks well,
 * individual buildings less so), then "my location" or a draggable map pin as the precise fallback.
 */
export function LocationPicker({
  title,
  initial,
  onPick,
  onClose,
}: {
  title: string;
  initial: Place | null;
  onPick: (place: Place) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'search' | 'map'>('search');
  const [query, setQuery] = useState('');
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState(false);
  const [mapStart, setMapStart] = useState<LatLng>(initial ?? ADDIS_CENTER);
  // A named place (from search) keeps its name unless the user moves the pin away from it.
  const [named, setNamed] = useState<Place | null>(initial);
  const [resolving, setResolving] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const debounced = useDebounced(query.trim(), 350);

  const results = useQuery({
    queryKey: ['geo', 'search', debounced],
    queryFn: () => api<PlaceSuggestion[]>(`/geo/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length >= 2,
    staleTime: 10 * 60_000,
  });

  const useMyLocation = () => {
    setGeoError(false);
    if (!navigator.geolocation) return setGeoError(true);
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        // Open the map at the GPS fix so the user can fine-tune the pin to their gate.
        setMapStart({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setNamed(null);
        setMode('map');
      },
      () => {
        setLocating(false);
        setGeoError(true);
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    );
  };

  if (mode === 'map') {
    return (
      <PinOnMap
        title={title}
        start={mapStart}
        named={named}
        onBack={() => setMode('search')}
        onConfirm={onPick}
      />
    );
  }

  return (
    <div
      className="fixed inset-0 z-40 mx-auto flex max-w-md flex-col bg-canvas"
      role="dialog"
      aria-label={title}
    >
      <header className="flex items-center gap-3 px-4 pt-4 pb-3">
        <IconButton label={t('common.back')} onClick={onClose}>
          <ChevronLeft className="size-5" aria-hidden />
        </IconButton>
        <h2 className="text-lg font-semibold">{title}</h2>
      </header>

      <div className="px-4">
        <label className="flex h-14 items-center gap-3 rounded-[var(--radius-lg)] border border-line-strong bg-surface px-4 shadow-[var(--shadow-xs)] transition-shadow duration-[var(--dur-fast)] focus-within:border-accent focus-within:shadow-[var(--shadow-sm)] focus-within:ring-2 focus-within:ring-accent/20">
          <Search className="size-5 shrink-0 text-ink-3" aria-hidden />
          <span className="sr-only">{t('booking.searchPlaceholder')}</span>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('booking.searchPlaceholder')}
            className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-ink-3"
            enterKeyHint="search"
          />
          {results.isFetching && <Spinner className="size-4 text-ink-3" />}
        </label>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 px-4">
        <Button
          variant="secondary"
          onClick={useMyLocation}
          loading={locating}
          icon={<LocateFixed className="size-4" aria-hidden />}
        >
          {locating ? t('booking.locating') : t('booking.useCurrent')}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            setMapStart(initial ?? ADDIS_CENTER);
            setNamed(initial);
            setMode('map');
          }}
          icon={<MapIcon className="size-4" aria-hidden />}
        >
          {t('booking.chooseOnMap')}
        </Button>
      </div>
      {geoError && (
        <Notice tone="warning" className="mx-4 mt-3">
          {t('booking.locationDenied')}
        </Notice>
      )}

      <div className="mt-3 flex-1 overflow-y-auto px-4 pb-6">
        {debounced.length < 2 && (
          <p className="px-1 pt-2 text-sm text-ink-3">{t('booking.searchHint')}</p>
        )}
        {results.isLoading && debounced.length >= 2 && (
          <div className="flex flex-col gap-2 pt-1">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        )}
        {results.isError && <Notice tone="danger">{(results.error as Error).message}</Notice>}
        {resolveError && (
          <Notice tone="danger" className="mb-2">
            {resolveError}
          </Notice>
        )}
        {results.data && results.data.length === 0 && (
          <p className="px-1 pt-2 text-sm text-ink-2">{t('booking.noResults')}</p>
        )}
        {results.data && results.data.length > 0 && (
          <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface shadow-[var(--shadow-xs)]">
            {results.data.map((p) => (
              <li key={p.ref}>
                <button
                  type="button"
                  disabled={resolving !== null}
                  onClick={async () => {
                    setResolving(p.ref);
                    setResolveError(null);
                    try {
                      const place = await resolve(p.ref);
                      if (!place || !place.inServiceArea) {
                        setResolveError(t('booking.outsideArea'));
                        return;
                      }
                      // Keep the friendly landmark name; confirm the exact spot on the map.
                      const withName = {
                        ...place,
                        name: p.name,
                        subCity: place.subCity ?? p.subCity,
                      };
                      setNamed(withName);
                      setMapStart(withName);
                      setMode('map');
                    } catch (e) {
                      setResolveError((e as Error).message);
                    } finally {
                      setResolving(null);
                    }
                  }}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2 disabled:opacity-60"
                >
                  {resolving === p.ref ? (
                    <Spinner className="size-5 shrink-0 text-ink-3" />
                  ) : (
                    <MapPin className="size-5 shrink-0 text-ink-3" aria-hidden />
                  )}
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{p.name}</span>
                    <span className="block truncate text-sm text-ink-3">{p.description}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function PinOnMap({
  title,
  start,
  named,
  onBack,
  onConfirm,
}: {
  title: string;
  start: LatLng;
  named: Place | null;
  onBack: () => void;
  onConfirm: (p: Place) => void;
}) {
  const { t } = useTranslation();
  const [center, setCenter] = useState<LatLng>(start);
  const settled = useDebounced(center, 400);
  const inArea = isInAddis(settled);
  // Still on the searched landmark (within ~25 m)? Then keep its name instead of a street label.
  const onNamed = !!named && haversineKm(named, settled) < 0.025;

  const reversed = useQuery({
    queryKey: ['geo', 'reverse', settled.lat.toFixed(5), settled.lng.toFixed(5)],
    queryFn: () => reverse(settled),
    enabled: inArea && !onNamed,
    staleTime: 60 * 60_000,
  });
  const place = onNamed
    ? {
        data: { ...named, lat: settled.lat, lng: settled.lng },
        isFetching: false,
        isError: false,
        error: null,
      }
    : reversed;

  const label = place.data?.name ?? t('booking.moveMap');
  const canConfirm = inArea && !place.isFetching && !!place.data;

  return (
    <div
      className="fixed inset-0 z-40 mx-auto flex max-w-md flex-col bg-canvas"
      role="dialog"
      aria-label={title}
    >
      <div className="relative flex-1">
        <MapView center={start} zoom={16} onMoveEnd={setCenter} className="absolute inset-0" />
        {/* Fixed centre pin: the map moves underneath it. */}
        <div
          className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-full"
          aria-hidden
        >
          <svg width="36" height="46" viewBox="0 0 30 38" className="drop-shadow-md">
            <path
              d="M15 0C6.7 0 0 6.6 0 14.8 0 26 15 38 15 38s15-12 15-23.2C30 6.6 23.3 0 15 0z"
              fill="var(--c-ink)"
            />
            <circle cx="15" cy="14.5" r="6" fill="var(--c-accent)" />
          </svg>
        </div>
        <div className="absolute inset-x-0 top-0 flex items-center gap-2 p-4">
          <IconButton label={t('common.back')} onClick={onBack}>
            <ChevronLeft className="size-5" aria-hidden />
          </IconButton>
          <span className="flex h-11 flex-1 items-center rounded-full border border-line bg-surface px-4 text-sm font-semibold shadow-[var(--shadow-sm)]">
            {title}
          </span>
        </div>
      </div>
      <div className="rounded-t-[var(--radius-2xl)] border-t border-line bg-surface px-4 pt-4 pb-safe shadow-[var(--shadow-xl)]">
        <p className="text-xs text-ink-3">{t('booking.moveMap')}</p>
        <p
          className={cn(
            'mt-1 min-h-6 truncate text-lg font-semibold',
            place.isFetching && 'text-ink-3',
          )}
        >
          {place.isFetching ? <Skeleton className="h-6 w-2/3" /> : label}
        </p>
        {place.data?.description && (
          <p className="truncate text-sm text-ink-2">{place.data.description}</p>
        )}
        {!inArea && (
          <Notice tone="warning" className="mt-3">
            {t('booking.outsideArea')}
          </Notice>
        )}
        {place.isError && (
          <Notice tone="danger" className="mt-3">
            {(place.error as Error).message}
          </Notice>
        )}
        <Button
          size="lg"
          block
          className="mt-4"
          disabled={!canConfirm}
          onClick={() => place.data && onConfirm(place.data)}
        >
          {t('booking.confirmLocation')}
        </Button>
      </div>
    </div>
  );
}

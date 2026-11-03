import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Check, ChevronLeft, MapPin } from 'lucide-react';
import { ADDIS_CENTER, SUB_CITIES, type LatLng, type RiderPreferences } from '@dp/shared';
import { api } from '../../lib/api.ts';
import { MapView } from '../../map/MapView.tsx';
import { Button, cn, Notice, Panel, Skeleton, useToast } from '../../ui/index.ts';
import { riderKeys, usePreferences, useRiderCopy } from './features.ts';

/** Service areas (sub-cities) and the optional, private home location. */
export function AreasScreen() {
  const c = useRiderCopy();
  const prefs = usePreferences();
  return (
    <div className="flex flex-col gap-4 px-4 pt-4 pb-6">
      <Link to="/rider/account" className="inline-flex items-center gap-1 text-sm font-semibold text-accent">
        <ChevronLeft className="size-4" aria-hidden /> {c.areas.title}
      </Link>
      {prefs.isPending && <Skeleton className="h-72 w-full" />}
      {prefs.data && <AreasForm initial={prefs.data} />}
    </div>
  );
}

function AreasForm({ initial }: { initial: RiderPreferences }) {
  const c = useRiderCopy();
  const { i18n } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const [areas, setAreas] = useState<string[]>(initial.serviceAreas);
  const [home, setHome] = useState(initial.home);
  const [center, setCenter] = useState<LatLng>(initial.home ?? ADDIS_CENTER);
  useEffect(() => setAreas(initial.serviceAreas), [initial.serviceAreas]);

  const save = useMutation({
    mutationFn: () =>
      api<RiderPreferences>('/rider/preferences', { method: 'PUT', body: { serviceAreas: areas, home } }),
    onSuccess: (data) => {
      qc.setQueryData(riderKeys.preferences, data);
      void qc.invalidateQueries({ queryKey: riderKeys.pool });
      toast(c.areas.saved, 'success');
    },
  });
  const toggle = (slug: string) =>
    setAreas((xs) => (xs.includes(slug) ? xs.filter((x) => x !== slug) : [...xs, slug]));

  return (
    <>
      <Panel className="p-4">
        <h1 className="text-lg font-bold tracking-tight">{c.areas.title}</h1>
        <p className="mt-1 text-sm text-ink-3">{c.areas.subtitle}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Chip active={areas.length === 0} onClick={() => setAreas([])}>
            {c.areas.all}
          </Chip>
          {SUB_CITIES.map((s) => (
            <Chip key={s.slug} active={areas.includes(s.slug)} onClick={() => toggle(s.slug)}>
              {i18n.language === 'am' ? s.nameAm : s.nameEn}
            </Chip>
          ))}
        </div>
      </Panel>

      <Panel className="overflow-hidden">
        <div className="p-4 pb-3">
          <h2 className="font-semibold">{c.areas.home}</h2>
          <p className="mt-1 text-sm text-ink-3">{c.areas.homeHint}</p>
        </div>
        <div className="relative">
          <MapView
            className="h-64"
            center={center}
            zoom={14}
            onMoveEnd={setCenter}
            markers={home ? [{ id: 'home', kind: 'pickup', point: home }] : []}
            circle={home ? { center: home, radiusKm: home.radiusKm } : null}
          />
          {/* Fixed pin in the middle: the rider moves the map under it. */}
          <MapPin
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-1/2 size-8 -translate-x-1/2 -translate-y-full text-accent drop-shadow"
          />
        </div>
        <div className="flex flex-col gap-3 p-4">
          <p className="text-xs text-ink-3">{c.areas.moveMap}</p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              block
              onClick={() => setHome({ lat: center.lat, lng: center.lng, radiusKm: home?.radiusKm ?? 3 })}
            >
              {c.areas.setHome}
            </Button>
            {home && (
              <Button variant="ghost" onClick={() => setHome(null)}>
                {c.areas.clearHome}
              </Button>
            )}
          </div>
          {home && (
            <label className="flex flex-col gap-1 text-sm">
              <span>
                {c.areas.radius} <b>{home.radiusKm} km</b>
              </span>
              <input
                type="range"
                min={1}
                max={15}
                value={home.radiusKm}
                onChange={(e) => setHome({ ...home, radiusKm: Number(e.target.value) })}
                className="accent-[var(--c-accent)]"
              />
            </label>
          )}
        </div>
      </Panel>

      {save.error && <Notice tone="danger">{save.error.message}</Notice>}
      <Button size="lg" block loading={save.isPending} onClick={() => save.mutate()}>
        {c.areas.save}
      </Button>
    </>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-9 items-center gap-1 rounded-full border px-3 text-sm font-medium',
        active ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong bg-surface text-ink',
      )}
    >
      {active && <Check className="size-3.5" aria-hidden />}
      {children}
    </button>
  );
}

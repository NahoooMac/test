import { useTranslation } from 'react-i18next';
import { Phone } from 'lucide-react';
import type { VehicleType } from '@dp/shared';
import { PlateBadge, StatusProgress } from '../../ui/index.ts';
import { VehicleIcon } from './VehicleIcon.tsx';
import { STAGE_KEYS } from './status.ts';

interface Stop {
  title: string;
  sub?: string | undefined;
}

/** Navy status card that overlaps the bottom of the tracking map. */
export function TrackingSheet({
  status,
  subtitle,
  vehicleType,
  stage,
  rider,
  pickup,
  dropoff,
}: {
  status: string;
  subtitle: string;
  vehicleType: VehicleType;
  stage: number;
  rider: { name: string; plate: string | null; phone: string | null } | null;
  pickup: Stop;
  dropoff: Stop;
}) {
  const { t } = useTranslation();
  const initials = rider?.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');

  return (
    <section className="relative z-10 mx-3 -mt-10 overflow-hidden rounded-[26px] bg-navy p-5 text-navy-ink shadow-[var(--shadow-xl)]">
      <div className="pointer-events-none absolute -top-16 -right-16 size-48 rounded-full bg-accent/25 blur-3xl" aria-hidden />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[24px] leading-tight font-bold tracking-tight text-accent-2">{status}</h1>
          <p className="mt-1 text-sm text-navy-ink/65 tabular">{subtitle}</p>
        </div>
        <span className="flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-3 text-xs font-semibold">
          <VehicleIcon type={vehicleType} className="size-4" />
          {t(`booking.vehicles.${vehicleType}`)}
        </span>
      </div>

      {stage >= 0 && (
        <div className="relative mt-5">
          <StatusProgress
            tone="dark"
            label={t('delivery.progress')}
            stages={STAGE_KEYS.map((k) => t(`delivery.stages.${k}`))}
            current={stage}
          />
        </div>
      )}

      {rider && (
        <div className="relative mt-4 flex items-center gap-3 rounded-[var(--radius-lg)] bg-white/[0.06] p-3 ring-1 ring-white/10">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent-2 to-accent text-[15px] font-bold text-white ring-2 ring-white/20">
            {initials || '•'}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-navy-ink/60">{t('delivery.rider')}</p>
            <p className="truncate text-[15px] font-semibold">{rider.name}</p>
          </div>
          {rider.plate && <PlateBadge>{rider.plate}</PlateBadge>}
          {rider.phone && (
            <a
              href={`tel:${rider.phone}`}
              aria-label={t('delivery.call')}
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent text-white shadow-[0_6px_16px_-4px_rgba(37,99,235,0.7)] transition-transform duration-[var(--dur-fast)] hover:bg-accent-hover active:scale-95"
            >
              <Phone className="size-5" aria-hidden />
            </a>
          )}
        </div>
      )}

      <ol className="relative mt-4 flex flex-col gap-3">
        <span className="absolute top-3 bottom-3 left-[7px] w-px border-l-2 border-dashed border-white/20" aria-hidden />
        <StopRow label={t('delivery.pickupLabel')} stop={pickup} dot="pickup" />
        <StopRow label={t('delivery.dropoffLabel')} stop={dropoff} dot="dropoff" />
      </ol>
    </section>
  );
}

function StopRow({ label, stop, dot }: { label: string; stop: Stop; dot: 'pickup' | 'dropoff' }) {
  return (
    <li className="relative flex gap-3">
      <span
        aria-hidden
        className={
          dot === 'pickup'
            ? 'relative mt-1 size-4 shrink-0 rounded-full border-[3px] border-accent-2 bg-navy'
            : 'relative mt-1 size-4 shrink-0 rounded-full bg-accent-2 ring-4 ring-accent-2/25'
        }
      />
      <div className="min-w-0">
        <p className="text-xs text-navy-ink/55">{label}</p>
        <p className="truncate text-[15px] font-semibold">{stop.title}</p>
        {stop.sub && <p className="truncate text-sm text-navy-ink/60 tabular">{stop.sub}</p>}
      </div>
    </li>
  );
}

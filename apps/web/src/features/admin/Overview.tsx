import { useState, type ComponentType } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bike, CheckCircle2, Coins, Landmark } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { Panel, Skeleton, cn } from '../../ui/index.ts';

interface ReconTotals {
  riders: { deliveries: number }[];
  totals: { faresCollectedByRiders: string; commissionOwed: string };
}

const CHART_LIMIT = 200;

function Stat({
  label,
  value,
  unit,
  icon: Icon,
  loading,
  hint,
}: {
  label: string;
  value: string | number;
  unit?: string;
  icon: ComponentType<{ className?: string }>;
  loading?: boolean;
  hint?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-[var(--radius-xl)] bg-surface p-4 shadow-[var(--shadow-sm)] ring-1 ring-line/70">
      <div className="min-w-0">
        <dt className="text-sm text-ink-3">{label}</dt>
        <dd className="mt-1 text-[26px] leading-tight font-bold tracking-tight tabular">
          {loading ? <Skeleton className="h-8 w-20" /> : value}
          {!loading && unit && <span className="ml-1 text-sm font-semibold text-ink-3">{unit}</span>}
        </dd>
        {hint && <p className="mt-0.5 text-xs text-ink-3">{hint}</p>}
      </div>
      <span className="flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-accent-soft text-accent">
        <Icon className="size-5" />
      </span>
    </div>
  );
}

/** Headline numbers and recent booking volume, from existing admin endpoints. */
export function Overview({ ridersOnline, loading }: { ridersOnline: number; loading: boolean }) {
  const recon = useQuery({
    queryKey: ['admin', 'reconciliation'],
    queryFn: () => api<ReconTotals>('/admin/reconciliation'),
  });
  const recent = useQuery({
    queryKey: ['admin', 'deliveries', 'overview'],
    queryFn: () => api<{ createdAt: string }[]>(`/admin/deliveries?limit=${CHART_LIMIT}`),
  });
  const completed = recon.data?.riders.reduce((s, r) => s + r.deliveries, 0) ?? 0;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <dl className="grid grid-cols-2 gap-3">
        <Stat label="Completed deliveries" value={completed} icon={CheckCircle2} loading={recon.isPending} />
        <Stat label="Riders online" value={ridersOnline} icon={Bike} loading={loading} />
        <Stat
          label="Fares collected"
          value={recon.data?.totals.faresCollectedByRiders ?? '—'}
          unit="ETB"
          icon={Coins}
          loading={recon.isPending}
        />
        <Stat
          label="Commission earned"
          value={recon.data?.totals.commissionOwed ?? '—'}
          unit="ETB"
          icon={Landmark}
          loading={recon.isPending}
        />
      </dl>
      <BookingsChart dates={recent.data?.map((d) => d.createdAt)} capped={recent.data?.length === CHART_LIMIT} />
    </div>
  );
}

function BookingsChart({ dates, capped }: { dates: string[] | undefined; capped: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (6 - i));
    return d;
  });
  const counts = days.map((day) => {
    const key = day.toDateString();
    return dates?.filter((iso) => new Date(iso).toDateString() === key).length ?? 0;
  });
  const max = Math.max(1, ...counts);
  const ticks = [max, Math.round(max / 2), 0];
  const label = (d: Date) => d.toLocaleDateString('en-GB', { weekday: 'short' });
  const total = counts.reduce((a, b) => a + b, 0);

  return (
    <Panel className="flex flex-col p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-semibold">Bookings, last 7 days</h2>
        <span className="text-sm text-ink-3 tabular">{dates ? `${total} total` : ''}</span>
      </div>
      {!dates ? (
        <Skeleton className="mt-4 h-40 w-full" />
      ) : (
        <div className="mt-4 flex flex-1 gap-2">
          <div className="flex h-40 flex-col justify-between text-right text-[11px] text-ink-3 tabular" aria-hidden>
            {ticks.map((t, i) => (
              <span key={i} className="-translate-y-1.5 leading-none last:translate-y-0">
                {t}
              </span>
            ))}
          </div>
          <div className="relative flex-1">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-40" aria-hidden>
              {[0, 50, 100].map((p) => (
                <span key={p} className="absolute inset-x-0 border-t border-line" style={{ top: `${p}%` }} />
              ))}
            </div>
            <div className="relative flex h-40 items-end gap-[2px]" aria-hidden>
              {counts.map((c, i) => (
                <div
                  key={i}
                  className="relative flex h-full flex-1 items-end justify-center"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                >
                  <div
                    className={cn(
                      'w-full max-w-9 rounded-t-[4px] bg-accent transition-opacity duration-[var(--dur-fast)]',
                      hover !== null && hover !== i && 'opacity-50',
                    )}
                    style={{ height: c ? `${(c / max) * 100}%` : '2px' }}
                  />
                  {hover === i && (
                    <div className="absolute bottom-full z-10 mb-1 rounded-[var(--radius-sm)] bg-navy px-2.5 py-1.5 text-xs whitespace-nowrap text-navy-ink shadow-[var(--shadow-md)]">
                      <span className="font-semibold tabular">{c}</span> bookings ·{' '}
                      {days[i]!.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-[2px] text-[11px] text-ink-3" aria-hidden>
              {days.map((d, i) => (
                <span key={i} className={cn('flex-1 text-center', i === 6 && 'font-semibold text-ink')}>
                  {label(d)}
                </span>
              ))}
            </div>
            <table className="sr-only">
              <caption>Bookings per day, last 7 days</caption>
              <tbody>
                {days.map((d, i) => (
                  <tr key={i}>
                    <th scope="row">{d.toDateString()}</th>
                    <td>{counts[i]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {capped && (
        <p className="mt-2 text-xs text-ink-3">Based on the latest {CHART_LIMIT} bookings.</p>
      )}
    </Panel>
  );
}

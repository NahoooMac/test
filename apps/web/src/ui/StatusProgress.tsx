import { Check } from 'lucide-react';
import { cn } from './cn.ts';

/**
 * Delivery progress as connected check circles. `current` is the index of the stage in progress;
 * stages before it are complete. Pass `current = stages.length` when finished.
 */
export function StatusProgress({
  stages,
  current,
  label = 'Progress',
  showLabels = true,
  tone = 'light',
}: {
  stages: string[];
  current: number;
  /** Accessible name, e.g. "Delivery progress" (translated by the caller). */
  label?: string;
  showLabels?: boolean;
  /** "dark" for use on navy cards. */
  tone?: 'light' | 'dark';
}) {
  const dark = tone === 'dark';
  return (
    <div>
      <div
        className="flex items-center"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={stages.length}
        aria-valuenow={Math.min(current + 1, stages.length)}
        aria-valuetext={stages[Math.min(current, stages.length - 1)]}
      >
        {stages.map((s, i) => (
          <div key={s} className={cn('flex items-center', i > 0 && 'flex-1')}>
            {i > 0 && (
              <span
                className={cn(
                  'mx-1 h-[3px] flex-1 rounded-full transition-colors duration-[var(--dur-slow)]',
                  i <= current ? 'bg-accent' : dark ? 'bg-white/15' : 'bg-surface-3',
                )}
              />
            )}
            <span
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full transition-all duration-[var(--dur-slow)]',
                i < current && 'bg-accent text-white shadow-[0_2px_6px_rgba(37,99,235,0.35)]',
                i === current && 'bg-accent/15 ring-2 ring-accent',
                i > current && (dark ? 'bg-white/10' : 'bg-surface-2'),
              )}
            >
              {i < current ? (
                <Check className="size-3.5" strokeWidth={3} aria-hidden />
              ) : (
                <span
                  className={cn(
                    'size-2 rounded-full',
                    i === current ? 'animate-pulse bg-accent' : dark ? 'bg-white/30' : 'bg-line-strong',
                  )}
                />
              )}
            </span>
          </div>
        ))}
      </div>
      {showLabels && (
        <div className="relative mt-2 h-7" aria-hidden>
          {stages.map((s, i) => (
            <span
              key={s}
              style={
                i === 0
                  ? { left: 0 }
                  : i === stages.length - 1
                    ? { right: 0 }
                    : { left: `${(i / (stages.length - 1)) * 100}%`, transform: 'translateX(-50%)' }
              }
              className={cn(
                'absolute top-0 text-[11px] leading-tight',
                i === 0
                  ? 'max-w-[20%] text-left'
                  : i === stages.length - 1
                    ? 'max-w-[18%] text-right'
                    : 'w-max max-w-[17%] text-center',
                i === current
                  ? cn('font-semibold', dark ? 'text-white' : 'text-ink')
                  : dark
                    ? 'text-white/55'
                    : i < current
                      ? 'text-ink-2'
                      : 'text-ink-3',
              )}
            >
              {s}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

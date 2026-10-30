import { cn } from './cn.ts';

/**
 * Segmented delivery progress. `current` is the index of the stage in progress;
 * stages before it are complete. Pass `current = stages.length` when finished.
 */
export function StatusProgress({ stages, current }: { stages: string[]; current: number }) {
  return (
    <div>
      <div
        className="flex gap-1"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={stages.length}
        aria-valuenow={Math.min(current + 1, stages.length)}
        aria-valuetext={stages[Math.min(current, stages.length - 1)]}
      >
        {stages.map((s, i) => (
          <span
            key={s}
            className={cn(
              'h-1.5 flex-1 rounded-full',
              i < current ? 'bg-accent' : i === current ? 'bg-accent/45' : 'bg-surface-2',
            )}
          />
        ))}
      </div>
      <div className="mt-2 flex gap-1" aria-hidden>
        {stages.map((s, i) => (
          <span
            key={s}
            className={cn(
              'flex-1 truncate text-[11px] leading-tight',
              i === current ? 'font-semibold text-ink' : i < current ? 'text-ink-2' : 'text-ink-3',
            )}
          >
            {s}
          </span>
        ))}
      </div>
    </div>
  );
}

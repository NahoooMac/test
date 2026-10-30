import { Check } from 'lucide-react';
import { cn } from './cn.ts';

/** Compact step indicator for multi-step flows (booking). `current` is 0-based. */
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex items-center gap-2" aria-label="Progress">
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li
            key={label}
            className={cn(
              'flex items-center gap-2',
              active ? 'min-w-0 flex-1' : 'shrink-0',
              i < steps.length - 1 && !active && 'flex-1',
            )}
            aria-current={active ? 'step' : undefined}
          >
            <span
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                done && 'bg-accent text-accent-ink',
                active && 'bg-ink text-canvas',
                !done && !active && 'bg-surface-2 text-ink-3',
              )}
            >
              {done ? <Check className="size-3.5" strokeWidth={3} aria-hidden /> : i + 1}
            </span>
            {/* Only the active label is shown, so steps stay legible on narrow phones. */}
            <span className={active ? 'truncate text-sm font-semibold text-ink' : 'sr-only'}>
              {label}
              {done && <span className="sr-only"> (done)</span>}
            </span>
            {i < steps.length - 1 && (
              <span
                aria-hidden
                className={cn('h-px min-w-3 flex-1', done ? 'bg-accent' : 'bg-line-strong')}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

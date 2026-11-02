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
            // Connector lines absorb the spare width; the active label never shrinks.
            className={cn(
              'flex items-center gap-2',
              i < steps.length - 1 ? 'min-w-0 flex-1' : 'shrink-0',
            )}
            aria-current={active ? 'step' : undefined}
          >
            <span
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                'transition-all duration-[var(--dur-normal)] ease-[var(--ease-out)]',
                done && 'bg-accent text-accent-ink shadow-[var(--shadow-xs)]',
                active && 'bg-accent text-white shadow-[0_4px_10px_-2px_rgba(37,99,235,0.55)]',
                !done && !active && 'bg-surface-2 text-ink-3',
              )}
            >
              {done ? <Check className="size-3.5" strokeWidth={3} aria-hidden /> : i + 1}
            </span>
            {/* Only the active label is shown, so steps stay legible on narrow phones. */}
            <span
              className={
                active ? 'shrink-0 text-sm font-semibold whitespace-nowrap text-ink' : 'sr-only'
              }
            >
              {label}
              {done && <span className="sr-only"> (done)</span>}
            </span>
            {i < steps.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  'h-px min-w-3 flex-1 transition-colors duration-[var(--dur-normal)]',
                  done ? 'bg-accent' : 'bg-line-strong',
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

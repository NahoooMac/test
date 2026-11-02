import { cn } from './cn.ts';

/** Pill tabs that filter a list in place (not routes). */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string;
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn('flex gap-1 rounded-full bg-surface-2 p-1', className)}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full px-3 text-sm font-semibold whitespace-nowrap',
              'transition-all duration-[var(--dur-fast)] ease-[var(--ease-out)]',
              active ? 'bg-surface text-accent shadow-[var(--shadow-sm)]' : 'text-ink-3 hover:text-ink',
            )}
          >
            {o.label}
            {o.count !== undefined && o.count > 0 && (
              <span
                className={cn(
                  'rounded-full px-1.5 text-[11px] tabular',
                  active ? 'bg-accent-soft text-accent-soft-ink' : 'bg-surface-3 text-ink-2',
                )}
              >
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

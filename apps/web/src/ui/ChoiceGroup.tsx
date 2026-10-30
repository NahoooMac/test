import { useId, type ReactNode } from 'react';
import { cn } from './cn.ts';

export interface Choice<T extends string> {
  value: T;
  label: string;
  description?: string;
  icon?: ReactNode;
  aside?: ReactNode;
}

/** Large radio cards — vehicle type, payer, payment method. Native radios for accessibility. */
export function ChoiceGroup<T extends string>({
  legend,
  choices,
  value,
  onChange,
  columns = 2,
}: {
  legend: string;
  choices: Choice<T>[];
  value: T | undefined;
  onChange: (value: T) => void;
  columns?: 1 | 2 | 3;
}) {
  const name = useId();
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-ink">{legend}</legend>
      <div
        className={cn('grid gap-2', columns === 2 && 'grid-cols-2', columns === 3 && 'grid-cols-3')}
      >
        {choices.map((c) => {
          const checked = c.value === value;
          return (
            <label
              key={c.value}
              className={cn(
                'relative flex cursor-pointer items-center gap-3 rounded-xl border bg-surface p-3 transition-colors',
                'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus',
                checked ? 'border-ink ring-1 ring-ink' : 'border-line-strong hover:bg-surface-2',
              )}
            >
              <input
                type="radio"
                name={name}
                value={c.value}
                checked={checked}
                onChange={() => onChange(c.value)}
                className="sr-only"
              />
              {c.icon && (
                <span
                  className={cn(
                    'flex size-10 shrink-0 items-center justify-center rounded-lg',
                    checked ? 'bg-accent-soft text-accent-soft-ink' : 'bg-surface-2 text-ink-2',
                  )}
                >
                  {c.icon}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold text-ink">{c.label}</span>
                {c.description && <span className="block text-sm text-ink-3">{c.description}</span>}
              </span>
              {c.aside}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

import { useId, type InputHTMLAttributes, type ReactNode, type Ref } from 'react';
import { cn } from './cn.ts';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  label: string;
  hint?: string;
  error?: string | undefined;
  prefix?: ReactNode;
  suffix?: ReactNode;
  ref?: Ref<HTMLInputElement>;
}

export function TextField({
  label,
  hint,
  error,
  prefix,
  suffix,
  className,
  id,
  ...input
}: TextFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={inputId} className="text-sm font-medium text-ink">
        {label}
      </label>
      <div
        className={cn(
          'flex h-14 items-center rounded-[var(--radius-lg)] border bg-surface shadow-[var(--shadow-xs)]',
          'transition-all duration-[var(--dur-fast)] ease-[var(--ease-out)]',
          'focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/12',
          error ? 'border-danger ring-1 ring-danger/20' : 'border-line hover:border-line-strong',
        )}
      >
        {prefix && (
          <span className="flex h-full items-center gap-2 border-r border-line pl-4 pr-3 text-base font-medium text-ink-2 tabular">
            {prefix}
          </span>
        )}
        <input
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={cn(hint && hintId, error && errorId) || undefined}
          className="h-full min-w-0 flex-1 bg-transparent px-4 text-base text-ink outline-none placeholder:text-ink-3 tabular"
          {...input}
        />
        {suffix && <span className="pr-3">{suffix}</span>}
      </div>
      {hint && !error && (
        <p id={hintId} className="text-sm text-ink-3">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

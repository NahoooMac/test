import { useEffect, useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { cn } from './cn.ts';

interface OtpInputProps {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  label: string;
  error?: boolean;
  disabled?: boolean;
  /** Blocks typing but keeps focus (e.g. while the code is being checked). */
  busy?: boolean;
  autoFocus?: boolean;
}

/** Six separate boxes, one digit each; paste and SMS autofill (one-time-code) fill all boxes. */
export function OtpInput({
  value,
  onChange,
  length = 6,
  label,
  error,
  disabled,
  busy,
  autoFocus,
}: OtpInputProps) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length }, (_, i) => value[i] ?? '');

  const focus = (i: number) => refs.current[Math.max(0, Math.min(length - 1, i))]?.focus();

  // When the code is cleared (wrong code, new code sent), put the cursor back in the first box.
  const hadValue = useRef(false);
  useEffect(() => {
    if (value === '' && hadValue.current && !disabled) refs.current[0]?.focus();
    hadValue.current = value !== '';
  }, [value, disabled]);

  const setAt = (i: number, d: string) => {
    const next = digits.slice();
    next[i] = d;
    onChange(next.join('').slice(0, length));
  };

  const fill = (raw: string, from: number) => {
    const clean = raw.replace(/\D/g, '');
    if (!clean) return;
    const next = digits.slice();
    for (let k = 0; k < clean.length && from + k < length; k++) next[from + k] = clean[k]!;
    onChange(next.join(''));
    focus(Math.min(from + clean.length, length - 1));
  };

  const onKeyDown = (i: number) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[i]) {
      e.preventDefault();
      setAt(i - 1, '');
      focus(i - 1);
    } else if (e.key === 'ArrowLeft') focus(i - 1);
    else if (e.key === 'ArrowRight') focus(i + 1);
  };

  return (
    <div role="group" aria-label={label} className="flex justify-between gap-2">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={d}
          disabled={disabled}
          readOnly={busy}
          autoFocus={autoFocus && i === 0}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          aria-label={`${label} ${i + 1}`}
          aria-invalid={error || undefined}
          maxLength={length}
          onChange={(e) => {
            const v = e.target.value;
            if (v.length > 1) fill(v, i);
            else if (/^\d?$/.test(v)) {
              setAt(i, v);
              if (v) focus(i + 1);
            }
          }}
          onKeyDown={onKeyDown(i)}
          onPaste={(e: ClipboardEvent<HTMLInputElement>) => {
            e.preventDefault();
            fill(e.clipboardData.getData('text'), i);
          }}
          onFocus={(e) => e.currentTarget.select()}
          className={cn(
            'h-14 w-full min-w-0 rounded-[var(--radius-md)] border bg-surface text-center text-2xl font-semibold text-ink tabular outline-none',
            'shadow-[var(--shadow-xs)] transition-all duration-[var(--dur-fast)] ease-[var(--ease-out)]',
            'focus:border-accent focus:ring-2 focus:ring-accent/20 focus:shadow-[var(--shadow-sm)] focus:scale-105',
            'disabled:opacity-50 disabled:focus:scale-100',
            error ? 'border-danger ring-1 ring-danger/20' : 'border-line-strong',
          )}
        />
      ))}
    </div>
  );
}

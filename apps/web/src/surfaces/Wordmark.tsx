import { APP_NAME } from '../lib/brand.ts';
import { cn } from '../ui/index.ts';

/** Placeholder wordmark until the brand is decided. `inverse` is for dark panels. */
export function Wordmark({
  suffix,
  inverse,
  className,
  size = 'md',
}: {
  suffix?: string;
  inverse?: boolean;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const sizes = {
    sm: { box: 'size-6 rounded-md', dot: 'size-2', text: 'text-[15px]' },
    md: { box: 'size-8 rounded-[10px]', dot: 'size-2.5', text: 'text-[17px]' },
    lg: { box: 'size-10 rounded-xl', dot: 'size-3', text: 'text-xl' },
  };
  const s = sizes[size];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2.5 font-bold tracking-tight',
        s.text,
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'flex items-center justify-center shadow-[var(--shadow-sm)]',
          s.box,
          inverse ? 'bg-inverse-ink' : 'bg-ink',
        )}
      >
        <span className={cn('rounded-full bg-accent', s.dot)} />
      </span>
      {APP_NAME}
      {suffix && (
        <span className={cn('font-medium', inverse ? 'opacity-60' : 'text-ink-3')}>{suffix}</span>
      )}
    </span>
  );
}

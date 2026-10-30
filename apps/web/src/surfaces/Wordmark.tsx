import { APP_NAME } from '../lib/brand.ts';
import { cn } from '../ui/index.ts';

/** Placeholder wordmark until the brand is decided. `inverse` is for dark panels. */
export function Wordmark({
  suffix,
  inverse,
  className,
}: {
  suffix?: string;
  inverse?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 text-[17px] font-bold tracking-tight',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'flex size-7 items-center justify-center rounded-lg',
          inverse ? 'bg-inverse-ink' : 'bg-ink',
        )}
      >
        <span className="size-2.5 rounded-full bg-accent" />
      </span>
      {APP_NAME}
      {suffix && (
        <span className={cn('font-medium', inverse ? 'opacity-60' : 'text-ink-3')}>{suffix}</span>
      )}
    </span>
  );
}

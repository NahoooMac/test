import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from './cn.ts';
import { Spinner } from './Spinner.tsx';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-soft';
type Size = 'sm' | 'md' | 'lg';

const variants: Record<Variant, string> = {
  primary:
    'bg-accent text-accent-ink shadow-[var(--shadow-sm)] hover:bg-accent-hover active:scale-[0.98]',
  secondary:
    'bg-surface text-ink border border-line-strong shadow-[var(--shadow-xs)] hover:bg-surface-2 active:scale-[0.98]',
  ghost: 'text-ink hover:bg-surface-2 active:bg-surface-2',
  danger: 'bg-danger text-white shadow-[var(--shadow-sm)] hover:brightness-110 active:scale-[0.98]',
  'danger-soft': 'bg-danger-soft text-danger hover:brightness-95 active:scale-[0.98]',
};

const sizes: Record<Size, string> = {
  sm: 'h-9 px-3 text-sm gap-1.5 rounded-[var(--radius-sm)]',
  md: 'h-11 px-4 text-[15px] gap-2 rounded-[var(--radius-md)]',
  lg: 'h-14 px-6 text-base gap-2.5 rounded-[var(--radius-lg)]',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  trailingIcon?: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  block,
  loading,
  icon,
  trailingIcon,
  disabled,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex select-none items-center justify-center font-semibold',
        'transition-all duration-[var(--dur-fast)] ease-[var(--ease-out)]',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100',
        variants[variant],
        sizes[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner className="size-5" /> : icon}
      <span className="truncate">{children}</span>
      {!loading && trailingIcon}
    </button>
  );
}

export function IconButton({
  label,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-11 items-center justify-center rounded-full bg-surface text-ink',
        'border border-line shadow-[var(--shadow-sm)]',
        'transition-all duration-[var(--dur-fast)] ease-[var(--ease-out)]',
        'hover:bg-surface-2 hover:shadow-[var(--shadow-md)] active:scale-95 disabled:opacity-50',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

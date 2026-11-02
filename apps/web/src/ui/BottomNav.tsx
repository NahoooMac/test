import type { ComponentType } from 'react';
import { Link, NavLink } from 'react-router';
import { cn } from './cn.ts';

type Icon = ComponentType<{ className?: string; strokeWidth?: number; 'aria-hidden'?: boolean }>;

export interface NavItem {
  to: string;
  label: string;
  icon: Icon;
  end?: boolean;
}

/** Floating navy tab bar. An optional raised centre action sits between the left and right items. */
export function BottomNav({
  label,
  left,
  right = [],
  action,
}: {
  label: string;
  left: NavItem[];
  right?: NavItem[];
  action?: { to: string; label: string; icon: Icon };
}) {
  return (
    <div className="sticky bottom-0 z-30 px-3 pb-safe pt-2">
      <nav
        aria-label={label}
        className="relative flex h-16 items-stretch rounded-[22px] bg-navy px-2 text-navy-ink shadow-[0_12px_32px_-8px_rgba(15,23,42,0.55)]"
      >
        <div className="flex flex-1">{left.map((i) => <Tab key={i.to} item={i} />)}</div>
        {action && (
          <div className="flex w-20 shrink-0 justify-center">
            <Link
              to={action.to}
              aria-label={action.label}
              title={action.label}
              className={cn(
                '-mt-6 flex size-16 items-center justify-center rounded-full bg-gradient-to-br from-accent-2 to-accent text-white',
                'shadow-[0_10px_24px_-6px_rgba(37,99,235,0.75)] ring-[6px] ring-canvas',
                'transition-transform duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:scale-105 active:scale-95',
              )}
            >
              <action.icon className="size-7" strokeWidth={2.2} aria-hidden />
            </Link>
          </div>
        )}
        {right.length > 0 && (
          <div className="flex flex-1">{right.map((i) => <Tab key={i.to} item={i} />)}</div>
        )}
      </nav>
    </div>
  );
}

function Tab({ item }: { item: NavItem }) {
  const { to, label, icon: Icon, end } = item;
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-semibold',
          'transition-colors duration-[var(--dur-fast)]',
          isActive ? 'text-accent-2' : 'text-navy-ink/60 hover:text-navy-ink',
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon className="size-[22px]" strokeWidth={isActive ? 2.4 : 1.9} aria-hidden />
          {label}
        </>
      )}
    </NavLink>
  );
}

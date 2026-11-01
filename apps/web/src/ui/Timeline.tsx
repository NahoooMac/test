import { cn } from './cn.ts';

export interface TimelineItem {
  id: string;
  title: string;
  detail?: string;
  time?: string;
  state: 'done' | 'current' | 'upcoming';
}

export function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <ol className="relative">
      {items.map((item, i) => (
        <li key={item.id} className="relative flex gap-3 pb-4 last:pb-0">
          {i < items.length - 1 && (
            <span
              aria-hidden
              className={cn(
                'absolute top-5 left-[7px] h-[calc(100%-12px)] w-0.5',
                item.state === 'done' ? 'bg-accent' : 'bg-line',
              )}
            />
          )}
          <span
            aria-hidden
            className={cn(
              'relative mt-1 size-4 shrink-0 rounded-full border-2 transition-all duration-[var(--dur-normal)]',
              item.state === 'done' && 'border-accent bg-accent shadow-[var(--shadow-xs)]',
              item.state === 'current' && 'border-accent bg-surface ring-4 ring-accent/20 shadow-[var(--shadow-sm)]',
              item.state === 'upcoming' && 'border-line-strong bg-surface',
            )}
          />
          <div className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
            <div className="min-w-0">
              <p
                className={cn(
                  'text-[15px]',
                  item.state === 'upcoming' ? 'text-ink-3' : 'font-medium text-ink',
                )}
              >
                {item.title}
              </p>
              {item.detail && <p className="text-sm text-ink-3">{item.detail}</p>}
            </div>
            {item.time && <time className="shrink-0 text-sm text-ink-3 tabular">{item.time}</time>}
          </div>
        </li>
      ))}
    </ol>
  );
}

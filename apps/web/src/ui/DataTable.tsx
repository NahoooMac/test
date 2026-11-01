import type { ReactNode } from 'react';
import { cn } from './cn.ts';
import { Skeleton } from './States.tsx';

export interface Column<Row> {
  key: string;
  header: string;
  /** Keep the header for screen readers only (e.g. an actions column). */
  hideHeader?: boolean;
  cell: (row: Row) => ReactNode;
  align?: 'left' | 'right';
  className?: string;
}

/** Admin data table: dense, scannable, with built-in loading and empty rows. */
export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  loading,
  empty,
  onRowClick,
  caption,
}: {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  loading?: boolean;
  empty?: ReactNode;
  onRowClick?: (row: Row) => void;
  caption?: string;
}) {
  return (
    // Focusable so keyboard users can scroll a table wider than a phone screen.
    <div
      role="region"
      aria-label={caption}
      tabIndex={0}
      className="overflow-x-auto rounded-[var(--radius-lg)] border border-line bg-surface shadow-[var(--shadow-xs)]"
    >
      <table className="w-full border-collapse text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-line">
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn(
                  'h-10 px-4 text-xs font-semibold tracking-wide whitespace-nowrap text-ink-3 uppercase',
                  c.align === 'right' ? 'text-right' : 'text-left',
                )}
              >
                {c.hideHeader ? <span className="sr-only">{c.header}</span> : c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading &&
            Array.from({ length: 4 }, (_, i) => (
              <tr key={i} className="border-b border-line last:border-0">
                {columns.map((c) => (
                  <td key={c.key} className="h-12 px-4">
                    <Skeleton className="h-4 w-3/4" />
                  </td>
                ))}
              </tr>
            ))}
          {!loading && rows.length === 0 && (
            <tr>
              <td colSpan={columns.length}>{empty}</td>
            </tr>
          )}
          {!loading &&
            rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  'border-b border-line last:border-0 transition-colors duration-[var(--dur-fast)]',
                  onRowClick && 'cursor-pointer hover:bg-surface-2',
                )}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      'h-12 px-4 text-ink',
                      c.align === 'right' && 'text-right tabular',
                      c.className,
                    )}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

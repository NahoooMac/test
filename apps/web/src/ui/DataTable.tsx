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
    <>
      <CardList
        columns={columns}
        rows={rows}
        rowKey={rowKey}
        loading={loading}
        empty={empty}
        onRowClick={onRowClick}
        caption={caption}
      />
      {/* Focusable so keyboard users can scroll a table wider than the screen. */}
      <div
        role="region"
        aria-label={caption}
        tabIndex={0}
        className="hidden overflow-x-auto rounded-[var(--radius-lg)] border border-line bg-surface shadow-[var(--shadow-xs)] md:block"
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
    </>
  );
}

/**
 * Phones: each row is a card. The first column is the card's title, the others are label/value
 * lines, and columns without a visible header (actions) sit full-width at the bottom.
 */
function CardList<Row>({
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
  const [title, ...rest] = columns;
  const fields = rest.filter((c) => !c.hideHeader);
  const actions = rest.filter((c) => c.hideHeader);
  return (
    <ul aria-label={caption} className="flex flex-col gap-3 md:hidden">
      {loading &&
        Array.from({ length: 3 }, (_, i) => (
          <li key={i} className="rounded-[var(--radius-lg)] border border-line bg-surface p-4">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="mt-3 h-3 w-full" />
            <Skeleton className="mt-2 h-3 w-5/6" />
          </li>
        ))}
      {!loading && rows.length === 0 && (
        <li className="rounded-[var(--radius-lg)] border border-line bg-surface">{empty}</li>
      )}
      {!loading &&
        rows.map((row) => (
          <li
            key={rowKey(row)}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className={cn(
              'rounded-[var(--radius-lg)] border border-line bg-surface p-4 text-sm shadow-[var(--shadow-xs)]',
              onRowClick && 'cursor-pointer active:bg-surface-2',
            )}
          >
            {title && <div className="min-w-0 text-[15px] text-ink">{title.cell(row)}</div>}
            {fields.length > 0 && (
              <dl className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
                {fields.map((c) => (
                  <div key={c.key} className="flex items-start justify-between gap-4">
                    <dt className="shrink-0 text-xs font-medium text-ink-3 uppercase">
                      {c.header}
                    </dt>
                    <dd
                      className={cn(
                        'min-w-0 text-right text-ink',
                        c.align === 'right' && 'tabular',
                      )}
                    >
                      {c.cell(row)}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {actions.map((c) => (
              <div
                key={c.key}
                className="mt-3 flex flex-wrap justify-end gap-2 border-t border-line pt-3"
                // Buttons inside a card act on their own, not as a tap on the card.
                onClick={(e) => e.stopPropagation()}
              >
                {c.cell(row)}
              </div>
            ))}
          </li>
        ))}
    </ul>
  );
}

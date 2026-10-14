/**
 * 表（TanStack Table v9）。見た目は共通にし、列ごとにセルの描き方を渡す。
 */
import { createColumnHelper, tableFeatures, useTable, type RowData } from '@tanstack/react-table';
import { cn } from 'cn';
import { useMemo, type ReactNode } from 'react';

const features = tableFeatures({});

export interface Col<T> {
  id: string;
  header: ReactNode;
  cell: (row: T, index: number) => ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
}

interface Props<T extends RowData> {
  rows: T[];
  cols: Col<T>[];
  rowKey: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
  empty?: ReactNode;
  className?: string;
  /** 見出しを固定する（親がスクロールするとき） */
  stickyHeader?: boolean;
}

export function DataTable<T extends RowData>({ rows, cols, rowKey, onRowClick, rowClassName, empty, className, stickyHeader }: Props<T>) {
  const columns = useMemo(() => {
    const helper = createColumnHelper<typeof features, T>();
    return cols.map((c) => helper.display({ id: c.id, header: () => c.header, cell: (ctx) => c.cell(ctx.row.original, ctx.row.index) }));
  }, [cols]);
  const byId = useMemo(() => new Map(cols.map((c) => [c.id, c])), [cols]);
  const table = useTable({ features, columns, data: rows, getRowId: (r: T, i: number) => rowKey(r, i) });
  const align = (id: string) => {
    const a = byId.get(id)?.align;
    return a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left';
  };

  return (
    <table className={cn('w-full border-collapse text-sm', className)}>
      <thead className={cn(stickyHeader && 'sticky top-0 z-10')}>
        {table.getHeaderGroups().map((g) => (
          <tr key={g.id} className="border-b bg-muted">
            {g.headers.map((h) => (
              <th key={h.id} className={cn('px-2 py-1.5 font-medium whitespace-nowrap', align(h.column.id), byId.get(h.column.id)?.className)}>
                {h.isPlaceholder ? null : <table.FlexRender header={h} />}
              </th>
            ))}
          </tr>
        ))}
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr>
            <td colSpan={cols.length} className="px-2 py-3 text-center text-muted-foreground">
              {empty}
            </td>
          </tr>
        )}
        {table.getRowModel().rows.map((row) => (
          <tr
            key={row.id}
            className={cn('border-b last:border-b-0', onRowClick && 'cursor-pointer hover:bg-muted/60', rowClassName?.(row.original))}
            onClick={onRowClick ? () => onRowClick(row.original) : undefined}
          >
            {row.getAllCells().map((cell) => (
              <td key={cell.id} className={cn('px-2 py-1 align-middle', align(cell.column.id), byId.get(cell.column.id)?.className)}>
                <table.FlexRender cell={cell} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

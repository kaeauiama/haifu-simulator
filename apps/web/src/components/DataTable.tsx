/**
 * 表（TanStack Table v9）。見た目は共通にし、列ごとにセルの描き方を渡す。
 * セルは cols の関数を直接呼んで描く。FlexRender に渡すと関数がコンポーネント扱いになり、
 * 親が描き直すたびに入力欄が作り直されて、フォーカスが外れる（Tab で右のセルへ移れない）
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
  const ids = cols.map((c) => c.id).join('|');
  const columns = useMemo(() => {
    const helper = createColumnHelper<typeof features, T>();
    return ids.split('|').map((id) => helper.display({ id }));
  }, [ids]);
  const table = useTable({ features, columns, data: rows, getRowId: (r: T, i: number) => rowKey(r, i) });
  const align = (c: Col<T>) => (c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left');

  return (
    <table className={cn('w-full border-collapse text-sm', className)}>
      <thead className={cn(stickyHeader && 'sticky top-0 z-10')}>
        <tr className="border-b bg-muted">
          {cols.map((c) => (
            <th key={c.id} className={cn('px-2 py-1.5 font-medium whitespace-nowrap', align(c), c.className)}>
              {c.header}
            </th>
          ))}
        </tr>
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
            {cols.map((c) => (
              <td key={c.id} className={cn('px-2 py-1 align-middle', align(c), c.className)}>
                {c.cell(row.original, row.index)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

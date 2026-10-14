import { Plus, Trash2 } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { DataTable, type Col } from '@/components/DataTable';
import { Button } from '@/components/ui/button';
import { ja } from '@/i18n/ja';

const byIndex = (_: unknown, i: number) => String(i);

/**
 * 編集できる表。行の追加・削除ボタンを付ける。
 * 行は並び順で見分ける。識別子を書き換えても入力欄が作り直されず、Tab で右のセルへ移れる
 */
export function EditGrid<T extends object>({
  title,
  note,
  rows,
  cols,
  onAdd,
  onDelete,
  toolbar,
}: {
  title?: ReactNode;
  note?: ReactNode;
  rows: T[];
  cols: Col<T>[];
  onAdd?: () => void;
  onDelete?: (row: T, index: number) => void;
  toolbar?: ReactNode;
}) {
  const all = useMemo<Col<T>[]>(
    () =>
      onDelete
        ? [
            ...cols,
            {
              id: '__delete',
              header: ja.table.actions,
              align: 'center',
              className: 'w-10',
              cell: (r, i) => (
                <Button size="icon-xs" variant="ghost" aria-label={ja.table.delete} title={ja.table.delete} onClick={() => onDelete(r, i)}>
                  <Trash2 />
                </Button>
              ),
            },
          ]
        : cols,
    [cols, onDelete],
  );
  return (
    <section className="space-y-2">
      {(title || onAdd || toolbar) && (
        <div className="flex flex-wrap items-center gap-2">
          {title && <h3 className="font-semibold">{title}</h3>}
          <div className="ml-auto flex flex-wrap gap-1">
            {toolbar}
            {onAdd && (
              <Button size="sm" variant="outline" onClick={onAdd}>
                <Plus />
                {ja.table.add}
              </Button>
            )}
          </div>
        </div>
      )}
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      <div className="overflow-auto rounded-md border">
        <DataTable rows={rows} cols={all} rowKey={byIndex} empty={ja.table.empty} stickyHeader />
      </div>
    </section>
  );
}

/**
 * 対象を種類ごとの列に並べ、選んだ時点の残高を出す（6章「表示の決めごと」の下地。線は M4 のフロー図で引く）。
 * 残高が残る原価センタ・WBS は枠を強調する（V-16）。
 */
import type { ObjType, ObjectRow } from '@alloc-sim/engine';
import { cn } from 'cn';
import { useState } from 'react';
import { Delta, Money } from '@/components/cells';
import { Checkbox } from '@/components/ui/checkbox';
import { ja } from '@/i18n/ja';
import { useRunStore } from '@/store/run';
import { useUiStore } from '@/store/ui';

const COLUMNS: ObjType[] = ['PCTR', 'CCTR', 'WBS', 'PSEG'];

export function ObjectBoard() {
  const view = useRunStore((s) => s.stepView);
  const selected = useUiStore((s) => s.selectedObj);
  const setUi = useUiStore((s) => s.set);
  const [showZero, setShowZero] = useState(true);
  if (!view) return null;
  const visible = view.objects.filter((o) => showZero || o.balance !== 0 || o.delta !== 0);
  const columns = COLUMNS.map((t) => ({ type: t, rows: visible.filter((o) => o.type === t) })).filter((c) => c.rows.length > 0 || c.type !== 'PCTR');

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">{ja.board.heading}</h2>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Checkbox checked={showZero} onCheckedChange={(c) => setShowZero(c === true)} />
          {ja.board.showZero}
        </label>
      </div>
      <div className="grid min-h-0 min-w-0 flex-1 gap-3 overflow-auto" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(12rem, 1fr))` }}>
        {columns.map((c) => (
          <div key={c.type} className="space-y-1.5">
            <h3 className="sticky top-0 z-10 bg-background py-1 text-xs font-medium text-muted-foreground">{ja.objType[c.type]}</h3>
            {c.rows.map((o) => (
              <Node key={o.key} o={o} selected={selected === o.key} onClick={() => setUi({ selectedObj: o.key })} />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function Node({ o, selected, onClick }: { o: ObjectRow; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full rounded-lg border bg-card px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-muted',
        o.residual && 'border-2 border-amber-500',
        selected && 'ring-2 ring-primary',
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-medium" title={o.label}>
          {o.type === 'PSEG' ? o.name : `${o.id} ${o.name}`}
        </span>
        <span className="text-xs whitespace-nowrap text-muted-foreground">{o.profitCenter || ja.board.pcUnassigned}</span>
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <Money value={o.balance} className="text-base font-semibold" />
        <span className="text-xs">
          <Delta value={o.delta} />
        </span>
      </div>
    </button>
  );
}

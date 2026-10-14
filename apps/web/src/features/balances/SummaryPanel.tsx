/**
 * この時点の利益センタ別・セグメント別の残高、ゼロサム検査（F6-03）、検証結果（F6-01）。
 */
import type { AmountRow, Issue } from '@alloc-sim/engine';
import { cn } from 'cn';
import { useState } from 'react';
import { DataTable, type Col } from '@/components/DataTable';
import { Money } from '@/components/cells';
import { Badge } from '@/components/ui/badge';
import { ja } from '@/i18n/ja';
import { useScenario } from '@/store/project';
import { useCursorStepId, useRunStore } from '@/store/run';

const AMOUNT_COLS = (title: string): Col<AmountRow>[] => [
  { id: 'label', header: title, cell: (r) => r.label || ja.totals.unassigned },
  { id: 'amount', header: '', cell: (r) => <Money value={r.amount} />, align: 'right' },
];
const PC_COLS = AMOUNT_COLS(ja.totals.byPC);
const SEG_COLS = AMOUNT_COLS(ja.totals.bySegment);

export function SummaryPanel() {
  const summary = useRunStore((s) => s.summary);
  const view = useRunStore((s) => s.stepView);
  if (!summary || !view) return null;
  return (
    <section className="flex min-h-0 flex-col gap-3 overflow-auto">
      <div className={cn('rounded-md border px-3 py-2 text-sm', summary.zeroSumOk ? 'border-emerald-300 bg-emerald-50' : 'border-destructive bg-destructive/10')}>
        <div className="font-medium">{summary.zeroSumOk ? ja.run.zeroSumOk : ja.run.zeroSumNg}</div>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{ja.run.primaryTotal}</span>
          <Money value={summary.primaryTotal} />
        </div>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{ja.run.finalTotal}</span>
          <Money value={summary.finalTotal} />
        </div>
      </div>
      <DataTable rows={view.byProfitCenter} cols={PC_COLS} rowKey={(r) => r.key || '-'} />
      <DataTable rows={view.bySegment} cols={SEG_COLS} rowKey={(r) => r.key} />
      <IssueList issues={summary.issues} />
    </section>
  );
}

const SEVERITY_CLASS: Record<Issue['severity'], string> = {
  ERROR: 'bg-destructive/10 text-destructive',
  WARNING: 'bg-amber-100 text-amber-900',
  INFO: 'bg-sky-100 text-sky-900',
};

function IssueList({ issues }: { issues: Issue[] }) {
  const [onlyUpToCursor, setOnlyUpToCursor] = useState(false);
  const scenario = useScenario();
  const cursor = useCursorStepId();
  const order = ['PRIMARY', ...scenario.steps.map((s) => s.id)];
  const upTo = order.indexOf(cursor);
  const stepName = (id?: string) => scenario.steps.find((s) => s.id === id)?.name;
  // 実行前（PRE）の検証と、ステップに結びつかない結果は常に出す
  const shown = onlyUpToCursor ? issues.filter((i) => !i.stepId || i.phase === 'PRE' || order.indexOf(i.stepId) <= upTo) : issues;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{ja.issues.heading}</h3>
        <div className="flex gap-1 text-xs">
          <button type="button" className={cn('rounded px-1.5', !onlyUpToCursor && 'bg-muted font-medium')} onClick={() => setOnlyUpToCursor(false)}>
            {ja.issues.all}
          </button>
          <button type="button" className={cn('rounded px-1.5', onlyUpToCursor && 'bg-muted font-medium')} onClick={() => setOnlyUpToCursor(true)}>
            {ja.issues.thisStep}
          </button>
        </div>
      </div>
      {shown.length === 0 && <p className="text-sm text-muted-foreground">{ja.issues.none}</p>}
      <ul className="space-y-1.5">
        {shown.map((i, n) => (
          <li key={n} className="rounded-md border px-2 py-1.5 text-sm">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge className={SEVERITY_CLASS[i.severity]}>{ja.severity[i.severity]}</Badge>
              <span className="font-mono text-xs">{i.code}</span>
              {stepName(i.stepId) && <span className="text-xs text-muted-foreground">{stepName(i.stepId)}</span>}
            </div>
            <p className="mt-0.5">{i.message}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

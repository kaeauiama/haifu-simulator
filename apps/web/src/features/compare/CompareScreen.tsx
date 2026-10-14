/**
 * シナリオ比較（F8-02、F4-04、F8-03）。2案の差を表で示し、金額の流れを並べて、差の出た流れだけを強調する。
 */
import type { CompareRow, CompareStep, CompareView, SankeyData } from '@alloc-sim/engine';
import { cn } from 'cn';
import { ArrowLeftRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { DataTable, type Col } from '@/components/DataTable';
import { Delta, Money } from '@/components/cells';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ja } from '@/i18n/ja';
import { useProjectStore } from '@/store/project';
import { useRunStore } from '@/store/run';
import { useUiStore } from '@/store/ui';
import { engine } from '@/worker/client';
import { Sankey, linkKey } from './Sankey';

const C = ja.compare;
type DiffTab = 'byProfitCenter' | 'bySegment' | 'byAccount' | 'byObject';
const DIFF_TABS: DiffTab[] = ['byProfitCenter', 'bySegment', 'byAccount', 'byObject'];

const diffCols = (a: string, b: string): Col<CompareRow>[] => [
  { id: 'label', header: C.key, cell: (r) => r.label || ja.totals.unassigned, className: 'whitespace-nowrap' },
  { id: 'a', header: a, cell: (r) => <Money value={r.a} />, align: 'right' },
  { id: 'b', header: b, cell: (r) => <Money value={r.b} />, align: 'right' },
  { id: 'diff', header: C.diff, cell: (r) => <Delta value={r.diff} />, align: 'right' },
];

const STEP_COLS: Col<CompareStep>[] = [
  { id: 'name', header: C.stepCol, cell: (s) => s.name },
  { id: 'a', header: C.a, cell: (s) => s.indexA ?? '', align: 'right' },
  { id: 'b', header: C.b, cell: (s) => s.indexB ?? '', align: 'right' },
  { id: 'changed', header: '', cell: (s) => (s.changed ? <Badge className="bg-amber-100 text-amber-900">{C.changed}</Badge> : null) },
];

export function CompareScreen() {
  const project = useProjectStore((s) => s.project);
  const current = useProjectStore((s) => s.scenarioId);
  const version = useRunStore((s) => s.version);
  const ui = useUiStore();
  const ids = project.scenarios.map((s) => s.id);
  const a = ui.compareA && ids.includes(ui.compareA) ? ui.compareA : current;
  const b = ui.compareB && ids.includes(ui.compareB) && ui.compareB !== a ? ui.compareB : (ids.find((x) => x !== a) ?? a);
  const steps = ui.sankeySteps;

  const [view, setView] = useState<CompareView | null>(null);
  const [sankeys, setSankeys] = useState<[SankeyData, SankeyData] | null>(null);
  const [tab, setTab] = useState<DiffTab>('byProfitCenter');
  const [onlyDiff, setOnlyDiff] = useState(true);

  useEffect(() => {
    if (version < 0 || a === b) return;
    let cancelled = false;
    void Promise.all([engine.compare(version, a, b), engine.sankey(version, a, steps), engine.sankey(version, b, steps)]).then(([v, sa, sb]) => {
      if (cancelled || !v || !sa || !sb) return;
      setView(v);
      setSankeys([sa, sb]);
    });
    return () => {
      cancelled = true;
    };
  }, [version, a, b, steps]);

  // 2案で額が違う流れ（片方にしかない流れを含む）だけを強調する
  const highlight = useMemo(() => {
    if (!sankeys) return undefined;
    const va = new Map(sankeys[0].links.map((l) => [linkKey(l), l.value]));
    const vb = new Map(sankeys[1].links.map((l) => [linkKey(l), l.value]));
    return new Set([...new Set([...va.keys(), ...vb.keys()])].filter((k) => va.get(k) !== vb.get(k)));
  }, [sankeys]);

  const scenarioName = (id: string) => project.scenarios.find((s) => s.id === id)?.name ?? id;
  const allSteps = project.scenarios.find((s) => s.id === a)?.steps ?? [];
  const toggleStep = (id: string) => {
    const base = steps ?? allSteps.filter((s) => s.enabled).map((s) => s.id);
    const next = base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
    ui.set({ sankeySteps: next });
  };
  const cols = useMemo(() => diffCols(C.a, C.b), []);

  const select = (value: string, onChange: (v: string) => void) => (
    <select className="h-8 rounded-md border bg-background px-2 text-sm" value={value} onChange={(e) => onChange(e.target.value)}>
      {project.scenarios.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{C.a}</span>
        {select(a, (v) => ui.set({ compareA: v }))}
        <Button size="icon-sm" variant="ghost" title={C.swap} aria-label={C.swap} onClick={() => ui.set({ compareA: b, compareB: a })}>
          <ArrowLeftRight />
        </Button>
        <span className="font-semibold">{C.b}</span>
        {select(b, (v) => ui.set({ compareB: v }))}
        {a === b && <span className="text-sm text-destructive">{C.sameScenario}</span>}
      </div>

      {view && sankeys && a !== b && (
        <div className="grid min-h-0 gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="min-w-0 space-y-3">
            <section className="rounded-lg border bg-background p-3">
              <Tabs value={tab} onValueChange={(v) => setTab(v as DiffTab)}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <TabsList className="h-auto flex-wrap">
                    {DIFF_TABS.map((t) => (
                      <TabsTrigger key={t} value={t}>
                        {C[t]}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Checkbox checked={onlyDiff} onCheckedChange={(c) => setOnlyDiff(c === true)} />
                    {C.onlyDiff}
                  </label>
                </div>
                {DIFF_TABS.map((t) => (
                  <TabsContent key={t} value={t} className="mt-2 overflow-auto">
                    <DataTable
                      rows={onlyDiff ? view[t].filter((r) => r.diff !== 0) : view[t]}
                      cols={cols}
                      rowKey={(r) => r.key || '-'}
                      rowClassName={(r) => (r.diff !== 0 ? 'bg-amber-50' : undefined)}
                      empty={ja.issues.none}
                    />
                  </TabsContent>
                ))}
              </Tabs>
            </section>
            <section className="space-y-2 rounded-lg border bg-background p-3">
              <h3 className="font-semibold">{C.steps}</h3>
              <DataTable rows={view.steps} cols={STEP_COLS} rowKey={(s) => s.id} rowClassName={(s) => (s.changed ? 'bg-amber-50' : undefined)} />
            </section>
          </div>
          <div className="min-w-0 space-y-3">
            <section className="space-y-2 rounded-lg border bg-background p-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <h3 className="mr-2 font-semibold">{C.sankey}</h3>
                <button
                  type="button"
                  className={cn('rounded-md border px-2 py-0.5 text-xs', steps === null && 'bg-primary text-primary-foreground')}
                  onClick={() => ui.set({ sankeySteps: null })}
                >
                  {C.allSteps}
                </button>
                {allSteps.map((s, i) => {
                  const on = steps === null ? s.enabled : steps.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      title={s.name}
                      className={cn('max-w-40 truncate rounded-md border px-2 py-0.5 text-xs', on ? 'border-primary bg-primary/10' : 'text-muted-foreground')}
                      onClick={() => toggleStep(s.id)}
                    >
                      {`${i + 1}. ${s.name}`}
                    </button>
                  );
                })}
              </div>
              {([a, b] as const).map((id, i) => (
                <div key={id} className="space-y-1">
                  <div className="text-sm font-medium">{`${i === 0 ? C.a : C.b}：${scenarioName(id)}`}</div>
                  <Sankey data={sankeys[i]!} highlight={highlight} />
                  <Memo scenarioId={id} />
                </div>
              ))}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

/** シナリオごとのメモ（F8-03：採用理由、懸念） */
function Memo({ scenarioId }: { scenarioId: string }) {
  const memo = useProjectStore((s) => s.project.scenarios.find((x) => x.id === scenarioId)?.memo ?? '');
  const [draft, setDraft] = useState(memo);
  useEffect(() => setDraft(memo), [memo]);
  return (
    <textarea
      aria-label={C.memo}
      placeholder={C.memo}
      className="min-h-16 w-full rounded-md border bg-background px-2 py-1 text-sm"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft === memo) return;
        useProjectStore.getState().edit((p) => {
          const s = p.scenarios.find((x) => x.id === scenarioId);
          if (s) s.memo = draft || undefined;
        });
      }}
    />
  );
}

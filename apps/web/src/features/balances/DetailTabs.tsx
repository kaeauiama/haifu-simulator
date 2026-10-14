/**
 * 選んだ対象の残高表（F7-03）、選んだステップの仕訳（F5-03）、残高の来歴（F7-04）。
 */
import type { LineRow, LineageRow } from '@alloc-sim/engine';
import { cn } from 'cn';
import { useMemo } from 'react';
import { DataTable, type Col } from '@/components/DataTable';
import { Money } from '@/components/cells';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ja } from '@/i18n/ja';
import { useCursorStepId, useRunStore } from '@/store/run';
import { useUiStore, type DetailTab } from '@/store/ui';

export function DetailTabs() {
  const tab = useUiStore((s) => s.detailTab);
  const setUi = useUiStore((s) => s.set);
  return (
    <Tabs value={tab} onValueChange={(v) => setUi({ detailTab: v as DetailTab })} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <TabsList className="h-auto flex-wrap">
        <TabsTrigger value="table">{ja.detail.tableTab}</TabsTrigger>
        <TabsTrigger value="journal">{ja.detail.journalTab}</TabsTrigger>
        <TabsTrigger value="lineage">{ja.detail.lineageTab}</TabsTrigger>
      </TabsList>
      <div className="min-h-0 min-w-0 flex-1 overflow-auto rounded-md border">
        <TabsContent value="table">
          <ObjectTable />
        </TabsContent>
        <TabsContent value="journal">
          <Journal />
        </TabsContent>
        <TabsContent value="lineage">
          <Lineage />
        </TabsContent>
      </div>
    </Tabs>
  );
}

function ObjectTable() {
  const t = useRunStore((s) => s.objectTable);
  const selected = useUiStore((s) => s.selectedObj);
  const cursor = useCursorStepId();
  const cols = useMemo<Col<{ i: number }>[]>(() => {
    if (!t) return [];
    return [
      {
        id: 'account',
        header: ja.detail.account,
        cell: ({ i }) => (i < 0 ? ja.detail.total : `${t.accounts[i]!.id} ${t.accounts[i]!.name}`),
        className: 'whitespace-nowrap',
      },
      ...t.steps.map((s, j) => ({
        id: s.id,
        header: <span title={s.name}>{j === 0 ? s.name : `${j}. ${s.name}`}</span>,
        cell: ({ i }: { i: number }) => <Money value={i < 0 ? t.totals[j]! : t.cells[i]![j]!} />,
        align: 'right' as const,
        className: cn('min-w-24', s.id === cursor && 'bg-primary/5 font-semibold'),
      })),
    ];
  }, [t, cursor]);
  if (!selected || !t) return <p className="p-3 text-sm text-muted-foreground">{ja.detail.selectObject}</p>;
  const rows = [...t.accounts.map((_, i) => ({ i })), { i: -1 }];
  return (
    <div className="p-1">
      <p className="px-2 py-1 text-sm font-medium">{t.label}</p>
      <DataTable rows={rows} cols={cols} rowKey={(r) => String(r.i)} rowClassName={(r) => (r.i < 0 ? 'font-semibold bg-muted/40' : undefined)} stickyHeader />
    </div>
  );
}

const JOURNAL_COLS: Col<LineRow>[] = [
  { id: 'doc', header: ja.detail.doc, cell: (l) => l.docId.split('#').pop(), className: 'text-muted-foreground' },
  { id: 'rule', header: ja.detail.rule, cell: (l) => l.ruleId },
  { id: 'row', header: ja.detail.row, cell: (l) => l.rowId ?? '' },
  { id: 'role', header: ja.detail.role, cell: (l) => ja.detail.roleLabel[l.role] },
  { id: 'obj', header: ja.detail.object, cell: (l) => l.objLabel, className: 'whitespace-nowrap' },
  { id: 'partner', header: ja.detail.partner, cell: (l) => l.partnerLabel ?? '', className: 'whitespace-nowrap text-muted-foreground' },
  { id: 'account', header: ja.detail.account, cell: (l) => `${l.account} ${l.accountName}`, className: 'whitespace-nowrap' },
  { id: 'pc', header: ja.detail.pc, cell: (l) => l.profitCenter },
  { id: 'amount', header: ja.detail.amount, cell: (l) => <Money value={l.amount} />, align: 'right' },
];

function Journal() {
  const view = useRunStore((s) => s.stepView);
  const selected = useUiStore((s) => s.selectedObj);
  if (!view) return null;
  return (
    <DataTable
      rows={view.lines}
      cols={JOURNAL_COLS}
      rowKey={(l) => l.id}
      empty={ja.detail.noLines}
      rowClassName={(l) => (l.objKey === selected ? 'bg-primary/5' : undefined)}
      stickyHeader
    />
  );
}

const LINEAGE_COLS: Col<LineageRow>[] = [
  { id: 'id', header: ja.detail.primaryId, cell: (r) => r.primaryId },
  { id: 'obj', header: ja.detail.object, cell: (r) => r.objLabel, className: 'whitespace-nowrap' },
  { id: 'account', header: ja.detail.account, cell: (r) => `${r.account} ${r.accountName}`, className: 'whitespace-nowrap' },
  { id: 'text', header: ja.detail.text, cell: (r) => r.text },
  { id: 'amount', header: ja.detail.contribution, cell: (r) => <Money value={r.amount} />, align: 'right' },
];

function Lineage() {
  const l = useRunStore((s) => s.lineage);
  const selected = useUiStore((s) => s.selectedObj);
  const summary = useRunStore((s) => s.summary);
  if (!selected) return <p className="p-3 text-sm text-muted-foreground">{ja.detail.selectObject}</p>;
  if (!l) return <p className="p-3 text-sm text-muted-foreground">{ja.run.running}</p>;
  const stepName = summary?.steps.find((s) => s.id === l.stepId)?.name ?? l.stepId;
  return (
    <div className="space-y-2 p-1">
      <p className="flex items-baseline justify-between px-2 py-1 text-sm">
        <span className="font-medium">{ja.detail.lineageFor(l.label, stepName)}</span>
        <span>
          {ja.detail.balance} <Money value={l.balance} className="font-semibold" />
        </span>
      </p>
      <DataTable rows={l.rows} cols={LINEAGE_COLS} rowKey={(r) => r.primaryId} stickyHeader />
      {Math.abs(l.unattributed) >= 0.5 && (
        <p className="flex justify-between px-2 text-sm text-muted-foreground">
          <span>{ja.detail.unattributed}</span>
          <Money value={l.unattributed} />
        </p>
      )}
    </div>
  );
}

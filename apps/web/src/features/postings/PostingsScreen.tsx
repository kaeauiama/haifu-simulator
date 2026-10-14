/**
 * 期中実績（F2）。一次仕訳の入力、CSV の取り込み・書き出し（F2-02）、対象別の合計表示。
 * 合計はエンジンが返す一次仕訳時点の残高をそのまま出す（画面では足し算しない）。
 */
import { PRIMARY_STEP_ID, postingsFromCsv, postingsToCsv, type ObjType, type ObjectRow, type PrimaryPosting } from '@alloc-sim/engine';
import { ChevronLeft, ChevronRight, FileDown, FileUp } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { DataTable, type Col } from '@/components/DataTable';
import { Money, NumberCell, SelectCell, TextCell } from '@/components/cells';
import { alertDialog, confirmDialog } from '@/components/dialogs';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ja } from '@/i18n/ja';
import { downloadText, pickTextFile, stamp } from '@/lib/files';
import { useProjectStore } from '@/store/project';
import { useRunStore } from '@/store/run';
import { engine } from '@/worker/client';
import { EditGrid } from '../master/EditGrid';
import { edit, newId, opts, project } from '../master/masterEdit';

const PAGE = 100;
const P = ja.postings.col;
const OBJ_TYPES: ObjType[] = ['CCTR', 'WBS', 'PSEG', 'PCTR'];

export function PostingsScreen() {
  const postings = useProjectStore((s) => s.project.primaryPostings);
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(postings.length / PAGE));
  const current = Math.min(page, pages - 1);
  const rows = postings.slice(current * PAGE, current * PAGE + PAGE);
  const offset = current * PAGE;

  const set = (i: number, recipe: (x: PrimaryPosting) => void) => edit((p) => recipe(p.primaryPostings[offset + i]!));
  const typeOptions = OBJ_TYPES.map((t) => ({ value: t, label: ja.objType[t] }));
  const cols: Col<PrimaryPosting>[] = [
    {
      id: 'id',
      header: P.id,
      cell: (x, i) => (
        <TextCell
          mono
          value={x.id}
          commit={(v) => {
            if (!v) return ja.table.emptyId;
            if (v !== x.id && project().primaryPostings.some((y) => y.id === v)) return ja.table.duplicateId(v);
            set(i, (y) => void (y.id = v));
          }}
        />
      ),
    },
    { id: 'account', header: P.account, cell: (x, i) => <SelectCell value={x.account} options={opts.accounts(project())} commit={(v) => set(i, (y) => void (y.account = v))} /> },
    {
      id: 'type',
      header: P.objType,
      cell: (x, i) => <SelectCell value={x.obj.type} options={typeOptions} commit={(v) => set(i, (y) => void (y.obj = { type: v as ObjType, id: opts.objects(project(), v)[0]?.value ?? '' }))} />,
    },
    { id: 'obj', header: P.objId, cell: (x, i) => <SelectCell value={x.obj.id} options={opts.objects(project(), x.obj.type)} commit={(v) => set(i, (y) => void (y.obj.id = v))} /> },
    { id: 'amount', header: P.amount, align: 'right', cell: (x, i) => <NumberCell integer value={x.amount} commit={(v) => set(i, (y) => void (y.amount = v))} /> },
    { id: 'text', header: P.text, cell: (x, i) => <TextCell value={x.text ?? ''} commit={(v) => set(i, (y) => void (y.text = v || undefined))} /> },
  ];

  const importCsv = async (mode: 'replace' | 'append') => {
    const f = await pickTextFile('.csv,text/csv');
    if (!f) return;
    const r = postingsFromCsv(f.text);
    const existing = new Set(mode === 'append' ? project().primaryPostings.map((x) => x.id) : []);
    const fresh = r.postings.filter((x) => !existing.has(x.id));
    const errors = [
      ...r.errors.map((e) => `${ja.postings.csvRow(e.row)}：${e.message}`),
      ...r.postings.filter((x) => existing.has(x.id)).map((x) => ja.table.duplicateId(x.id)),
    ];
    if (errors.length && !(await confirmDialog(ja.postings.csvErrors(errors.length), errors.slice(0, 20)))) return;
    edit((p) => {
      p.primaryPostings = mode === 'replace' ? fresh : [...p.primaryPostings, ...fresh];
    });
    await alertDialog(ja.postings.csvImported(fresh.length));
  };

  return (
    <div className="grid h-full min-h-0 gap-3 overflow-auto p-3 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="min-h-0 space-y-2">
        <EditGrid
          title={`${ja.postings.heading}（${ja.postings.count(postings.length)}）`}
          rows={rows}
          cols={cols}
          rowKey={(x) => x.id}
          onAdd={() =>
            edit((p) => {
              p.primaryPostings.push({ id: newId(p.primaryPostings.map((x) => x.id), 'PP-'), account: p.master.accounts[0]?.id ?? '', obj: { type: 'CCTR', id: p.master.costCenters[0]?.id ?? '' }, amount: 0 });
              setPage(Math.floor((p.primaryPostings.length - 1) / PAGE));
            })
          }
          onDelete={(_, i) => edit((p) => void p.primaryPostings.splice(offset + i, 1))}
          toolbar={
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline">
                    <FileUp />
                    {ja.postings.importCsv}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onSelect={() => void importCsv('replace')}>{ja.postings.csvReplace}</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void importCsv('append')}>{ja.postings.csvAppend}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button size="sm" variant="outline" onClick={() => downloadText(`primary-postings-${stamp()}.csv`, postingsToCsv(project().primaryPostings), 'text/csv')}>
                <FileDown />
                {ja.postings.exportCsv}
              </Button>
            </>
          }
        />
        {pages > 1 && (
          <div className="flex items-center justify-end gap-2 text-sm">
            <Button size="icon-sm" variant="ghost" disabled={current === 0} onClick={() => setPage(current - 1)} aria-label="前へ">
              <ChevronLeft />
            </Button>
            <span className="tabular-nums">
              {current + 1} / {pages}
            </span>
            <Button size="icon-sm" variant="ghost" disabled={current >= pages - 1} onClick={() => setPage(current + 1)} aria-label="次へ">
              <ChevronRight />
            </Button>
          </div>
        )}
      </div>
      <PrimaryTotals />
    </div>
  );
}

const TOTAL_COLS: Col<ObjectRow>[] = [
  { id: 'obj', header: ja.detail.object, cell: (o) => o.label, className: 'whitespace-nowrap' },
  { id: 'pc', header: ja.detail.pc, cell: (o) => o.profitCenter },
  { id: 'amount', header: ja.detail.amount, cell: (o) => <Money value={o.balance} />, align: 'right' },
];

function PrimaryTotals() {
  const version = useRunStore((s) => s.version);
  const [rows, setRows] = useState<ObjectRow[]>([]);
  useEffect(() => {
    if (version < 0) return;
    let cancelled = false;
    void engine.stepView(version, PRIMARY_STEP_ID).then((v) => {
      if (!cancelled && v) setRows(v.objects.filter((o) => o.balance !== 0));
    });
    return () => {
      cancelled = true;
    };
  }, [version]);
  const cols = useMemo(() => TOTAL_COLS, []);
  return (
    <section className="min-h-0 space-y-2">
      <h3 className="font-semibold">{ja.postings.totalsHeading}</h3>
      <div className="overflow-auto rounded-md border">
        <DataTable rows={rows} cols={cols} rowKey={(o) => o.key} stickyHeader />
      </div>
    </section>
  );
}

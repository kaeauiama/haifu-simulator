/**
 * ルールの編集フォーム（F3-01〜F3-05）。入力は確定するたびにシナリオへ反映し、すぐ再計算される。
 */
import {
  CHAR_KEYS,
  deleteRule,
  type Issue,
  nextId,
  stepsOfRule,
  type ActivityAllocation,
  type AllocSegment,
  type AllocationCycle,
  type CharKey,
  type CostingSheet,
  type DistributionRule,
  type ObjSelector,
  type ObjType,
  type Project,
  type RuleKind,
  type Scenario,
  type SettlementRule,
  type TDDRule,
} from '@alloc-sim/engine';
import { cn } from 'cn';
import { Plus, Trash2 } from 'lucide-react';
import { CheckCell, NumberCell, SelectCell, TextCell, type Option } from '@/components/cells';
import { confirmDialog } from '@/components/dialogs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ja } from '@/i18n/ja';
import { useProjectStore, useScenario } from '@/store/project';
import { useRunStore } from '@/store/run';
import { useUiStore } from '@/store/ui';
import { opts } from '../master/masterEdit';
import { AccountRanges, Field, FactorEditor, ObjChips, SelectorEditor, boxed } from './editors';

const NO_ISSUES: readonly Issue[] = [];
const F = ja.form;
const SEVERITY_CLASS = { ERROR: 'bg-destructive/10 text-destructive', WARNING: 'bg-amber-100 text-amber-900', INFO: 'bg-sky-100 text-sky-900' } as const;

export function RuleDialog() {
  const editing = useUiStore((s) => s.editingRule);
  const setUi = useUiStore((s) => s.set);
  const scenario = useScenario();
  const summary = useRunStore((s) => s.summary);
  const issues = summary?.issues ?? NO_ISSUES;
  if (!editing) return null;
  const exists = ruleOf(scenario, editing.kind, editing.id);
  const close = () => setUi({ editingRule: null });
  const steps = stepsOfRule(scenario, editing.kind, editing.id).map((id) => scenario.steps.find((s) => s.id === id)!.name);
  const mine = issues.filter((i) => i.ruleId === editing.id);

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{ja.rules.edit(ja.ruleKind[editing.kind], editing.id)}</DialogTitle>
          <p className="text-xs text-muted-foreground">{`${ja.rules.steps}：${steps.length ? steps.join('、') : ja.rules.noStep}`}</p>
        </DialogHeader>
        {mine.length > 0 && (
          <ul className="space-y-1">
            {mine.map((i, n) => (
              <li key={n} className="flex items-start gap-1.5 text-sm">
                <Badge className={SEVERITY_CLASS[i.severity]}>{ja.severity[i.severity]}</Badge>
                <span>{i.message}</span>
              </li>
            ))}
          </ul>
        )}
        {exists && <RuleForm kind={editing.kind} id={editing.id} />}
        <div className="flex justify-between border-t pt-3">
          <Button
            size="sm"
            variant="destructive"
            onClick={async () => {
              if (!(await confirmDialog(ja.rules.confirmRemove(editing.id)))) return;
              const sid = useProjectStore.getState().scenarioId;
              useProjectStore.getState().edit((p) => deleteRule(p, sid, editing.kind, editing.id));
              setUi({ editingRule: null, selectedRule: null });
            }}
          >
            <Trash2 />
            {ja.rules.remove}
          </Button>
          <Button size="sm" onClick={close}>
            {ja.dialog.close}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ruleOf(s: Scenario, kind: RuleKind, id: string) {
  switch (kind) {
    case 'CYCLE':
      return s.cycles.find((x) => x.id === id);
    case 'TDD':
      return s.tddRules.find((x) => x.id === id);
    case 'SETTLEMENT':
      return s.settlementRules.find((x) => x.id === id);
    case 'ACTIVITY':
      return s.activityAllocs.find((x) => x.id === id);
    case 'COSTING':
      return s.costingSheets.find((x) => x.id === id);
  }
}

/** いまのシナリオのルールを書き換える */
function useRuleEdit<T>(kind: RuleKind, id: string) {
  const editScenario = useProjectStore((s) => s.editScenario);
  return (recipe: (r: T, p: Project) => void) =>
    editScenario((s, p) => {
      const r = ruleOf(s, kind, id) as T | undefined;
      if (r) recipe(r, p);
    });
}

function RuleForm({ kind, id }: { kind: RuleKind; id: string }) {
  switch (kind) {
    case 'CYCLE':
      return <CycleForm id={id} />;
    case 'SETTLEMENT':
      return <SettlementForm id={id} />;
    case 'ACTIVITY':
      return <ActivityForm id={id} />;
    case 'COSTING':
      return <CostingForm id={id} />;
    case 'TDD':
      return <TddForm id={id} />;
  }
}

const useStepOptions = (): Option[] => useScenario().steps.map((s, i) => ({ value: s.id, label: `${i + 1}. ${s.name}` }));
const enumOptions = <K extends string>(labels: Record<K, string>, keys?: K[]): Option[] => (keys ?? (Object.keys(labels) as K[])).map((k) => ({ value: k, label: labels[k] }));
const listIds = (sel: ObjSelector): string[] => (sel.mode === 'LIST' ? sel.ids : []);
type Factor = AllocSegment['receiver']['factor'];
const isFixed = (f: Factor): f is Extract<Factor, { kind: 'FIXED_PERCENT' | 'FIXED_PORTION' }> => f.kind === 'FIXED_PERCENT' || f.kind === 'FIXED_PORTION';

// ---------- 配賦サイクル（F3-01） ----------
function CycleForm({ id }: { id: string }) {
  const p = useProjectStore((s) => s.project);
  const c = useScenario().cycles.find((x) => x.id === id)!;
  const edit = useRuleEdit<AllocationCycle>('CYCLE', id);
  const stepOptions = useStepOptions();
  const receiverTypes: ObjType[] = c.context === 'MA' ? ['PSEG'] : ['CCTR', 'WBS'];
  const editSeg = (i: number, recipe: (s: AllocSegment) => void) => edit((r) => recipe(r.segments[i]!));

  return (
    <div className="space-y-3">
      <Field label={F.name}>
        <TextCell className={boxed} value={c.name} commit={(v) => edit((r) => void (r.name = v))} />
      </Field>
      <Field label={F.context}>
        <SelectCell
          value={c.context}
          options={enumOptions(F.contextLabel, ['CCTR', 'MA'])}
          commit={(v) =>
            edit((r) => {
              r.context = v as AllocationCycle['context'];
              const t: ObjType = v === 'MA' ? 'PSEG' : 'CCTR';
              for (const s of r.segments) {
                s.receiver.objects = { type: t, mode: 'LIST', ids: [] };
                s.receiver.factor = { kind: 'FIXED_PORTION', weights: [] };
              }
            })
          }
        />
      </Field>
      <Field label={F.type}>
        <SelectCell
          value={c.type}
          options={enumOptions(F.typeLabel)}
          commit={(v) =>
            edit((r, proj) => {
              r.type = v as AllocationCycle['type'];
              const acc = proj.master.accounts.find((a) => a.category === 'SEC42')?.id;
              for (const s of r.segments) {
                if (r.type === 'OVERHEAD' && !s.allocAccount && acc) s.allocAccount = acc;
                if (r.type === 'DISTRIBUTION') delete s.allocAccount;
              }
            })
          }
        />
      </Field>
      <Field label={F.iterative}>
        <CheckCell label={F.iterative} value={c.iterative} commit={(v) => edit((r) => void (r.iterative = v))} />
      </Field>

      {c.segments.map((seg, i) => (
        <section key={seg.id} className="space-y-2 rounded-md border p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{`${F.segment} ${seg.id}`}</span>
            <Button size="xs" variant="ghost" onClick={() => edit((r) => void r.segments.splice(i, 1))}>
              <Trash2 />
              {F.removeSegment}
            </Button>
          </div>
          <Field label={F.name}>
            <TextCell className={boxed} value={seg.name} commit={(v) => editSeg(i, (s) => void (s.name = v))} />
          </Field>
          <Field label={F.sender}>
            <SelectorEditor p={p} value={seg.sender.objects} types={['CCTR']} onChange={(v) => editSeg(i, (s) => void (s.sender.objects = v))} />
          </Field>
          <Field label={F.senderAccounts}>
            <AccountRanges value={seg.sender.accounts} onChange={(v) => editSeg(i, (s) => void (s.sender.accounts = v))} />
          </Field>
          <Field label={F.sharePct}>
            <div className="w-32">
              <NumberCell value={seg.sender.sharePct} commit={(v) => editSeg(i, (s) => void (s.sender.sharePct = v))} />
            </div>
          </Field>
          <Field label={F.receiver}>
            {isFixed(seg.receiver.factor) ? (
              // 固定%・固定比率では、配分基準の表に並べた対象が受信者になる（P-13）
              receiverTypes.length > 1 && (
                <SelectCell
                  value={seg.receiver.objects.type}
                  options={receiverTypes.map((t) => ({ value: t, label: ja.objType[t] }))}
                  commit={(v) =>
                    editSeg(i, (s) => {
                      s.receiver.objects = { type: v as ObjType, mode: 'LIST', ids: [] };
                      s.receiver.factor = { ...s.receiver.factor, weights: [] } as AllocSegment['receiver']['factor'];
                    })
                  }
                />
              )
            ) : (
              <SelectorEditor p={p} value={seg.receiver.objects} types={receiverTypes} onChange={(v) => editSeg(i, (s) => void (s.receiver.objects = v))} />
            )}
          </Field>
          <Field label={F.factor}>
            <FactorEditor
              p={p}
              value={seg.receiver.factor}
              receiverType={seg.receiver.objects.type}
              receiverIds={isFixed(seg.receiver.factor) ? seg.receiver.factor.weights.map((w) => w.obj.id) : listIds(seg.receiver.objects)}
              stepOptions={stepOptions}
              onChange={(v) =>
                editSeg(i, (s) => {
                  const prev = s.receiver.factor;
                  // 固定の表から統計KF・実績値に切り替えたら、表の対象を受信側の選択条件に引き継ぐ
                  if (isFixed(prev) && !isFixed(v)) s.receiver.objects = { type: s.receiver.objects.type, mode: 'LIST', ids: prev.weights.map((w) => w.obj.id) };
                  if (isFixed(v)) s.receiver.objects = { type: s.receiver.objects.type, mode: 'LIST', ids: v.weights.map((w) => w.obj.id) };
                  s.receiver.factor = v;
                })
              }
            />
          </Field>
          {c.type === 'OVERHEAD' && (
            <Field label={F.allocAccount}>
              <SelectCell value={seg.allocAccount ?? ''} allowEmpty options={opts.accounts(p, ['SEC42'])} commit={(v) => editSeg(i, (s) => void (s.allocAccount = v || undefined))} />
            </Field>
          )}
        </section>
      ))}
      <Button
        size="sm"
        variant="outline"
        onClick={() =>
          edit((r, proj) => {
            const prev = r.segments.at(-1);
            r.segments.push({
              id: nextId('SEG-', r.segments.map((s) => s.id)),
              name: '',
              sender: { objects: { type: 'CCTR', mode: 'LIST', ids: [] }, accounts: prev ? [...prev.sender.accounts] : [], sharePct: 100 },
              receiver: { objects: { type: r.context === 'MA' ? 'PSEG' : 'CCTR', mode: 'LIST', ids: [] }, factor: { kind: 'FIXED_PORTION', weights: [] } },
              ...(r.type === 'OVERHEAD' ? { allocAccount: prev?.allocAccount ?? proj.master.accounts.find((a) => a.category === 'SEC42')?.id ?? '' } : {}),
            });
          })
        }
      >
        <Plus />
        {F.addSegment}
      </Button>
    </div>
  );
}

// ---------- 決済規則（F3-02） ----------
const SETTLE_RECEIVERS: ObjType[] = ['CCTR', 'WBS', 'PSEG'];

function SettlementForm({ id }: { id: string }) {
  const p = useProjectStore((s) => s.project);
  const r = useScenario().settlementRules.find((x) => x.id === id)!;
  const edit = useRuleEdit<SettlementRule>('SETTLEMENT', id);
  const editRow = (i: number, recipe: (d: DistributionRule) => void) => edit((x) => recipe(x.rules[i]!));
  const typeOptions = SETTLE_RECEIVERS.map((t) => ({ value: t, label: ja.objType[t] }));

  return (
    <div className="space-y-3">
      <Field label={F.settlementSender}>
        <SelectCell value={r.sender.id} options={opts.wbs(p)} commit={(v) => edit((x) => void (x.sender = { type: 'WBS', id: v }))} />
      </Field>
      <div className="space-y-1">
        <span className="text-sm text-muted-foreground">{F.distRules}</span>
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="text-left font-normal">{F.receiverType}</th>
              <th className="text-left font-normal">{F.receiver}</th>
              <th className="text-left font-normal">{F.basis}</th>
              <th className="text-right font-normal">{F.value}</th>
              <th className="text-left font-normal">{F.settlementType}</th>
              <th className="text-right font-normal">{F.validFrom}</th>
              <th className="text-right font-normal">{F.validTo}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {r.rules.map((d, i) => (
              <tr key={i}>
                <td>
                  <SelectCell value={d.receiver.type} options={typeOptions} commit={(v) => editRow(i, (x) => void (x.receiver = { type: v as ObjType, id: opts.objects(p, v)[0]?.value ?? '' }))} />
                </td>
                <td>
                  <SelectCell value={d.receiver.id} options={opts.objects(p, d.receiver.type)} commit={(v) => editRow(i, (x) => void (x.receiver.id = v))} />
                </td>
                <td>
                  <SelectCell value={d.basis} options={enumOptions(F.basisLabel)} commit={(v) => editRow(i, (x) => void (x.basis = v as DistributionRule['basis']))} />
                </td>
                <td className="w-28">
                  <NumberCell value={d.value} commit={(v) => editRow(i, (x) => void (x.value = v))} />
                </td>
                <td>
                  <SelectCell value={d.settlementType} options={[{ value: 'FUL', label: 'FUL' }, { value: 'PER', label: 'PER' }]} commit={(v) => editRow(i, (x) => void (x.settlementType = v as DistributionRule['settlementType']))} />
                </td>
                <td className="w-24">
                  <NumberCell integer plain value={d.validFrom} commit={(v) => editRow(i, (x) => void (x.validFrom = v))} />
                </td>
                <td className="w-24">
                  <TextCell
                    className="text-right"
                    value={d.validTo === undefined ? '' : String(d.validTo)}
                    commit={(v) => {
                      if (v === '') return void editRow(i, (x) => void delete x.validTo);
                      if (!/^\d+$/.test(v)) return ja.table.notInteger;
                      editRow(i, (x) => void (x.validTo = Number(v)));
                    }}
                  />
                </td>
                <td>
                  <Button size="icon-xs" variant="ghost" aria-label={ja.table.delete} onClick={() => edit((x) => void x.rules.splice(i, 1))}>
                    <Trash2 />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Button
          size="xs"
          variant="outline"
          onClick={() =>
            edit((x, proj) => void x.rules.push({ receiver: { type: 'CCTR', id: proj.master.costCenters[0]?.id ?? '' }, basis: 'PCT', value: 0, settlementType: 'FUL', validFrom: proj.master.period }))
          }
        >
          <Plus />
          {F.addDistRule}
        </Button>
      </div>
    </div>
  );
}

// ---------- 直接活動配分（F3-03） ----------
function ActivityForm({ id }: { id: string }) {
  const p = useProjectStore((s) => s.project);
  const a = useScenario().activityAllocs.find((x) => x.id === id)!;
  const edit = useRuleEdit<ActivityAllocation>('ACTIVITY', id);
  const types: ObjType[] = ['CCTR', 'WBS'];
  return (
    <div className="space-y-3">
      <Field label={F.senderCctr}>
        <SelectCell value={a.senderCctr} options={opts.costCenters(p)} commit={(v) => edit((x) => void (x.senderCctr = v))} />
      </Field>
      <Field label={F.activityType}>
        <SelectCell value={a.activityType} options={opts.activityTypes(p)} commit={(v) => edit((x) => void (x.activityType = v))} />
      </Field>
      <Field label={F.receiverType}>
        <SelectCell
          value={a.receiver.type}
          options={types.map((t) => ({ value: t, label: ja.objType[t] }))}
          commit={(v) => edit((x) => void (x.receiver = { type: v as ObjType, id: opts.objects(p, v)[0]?.value ?? '' }))}
        />
      </Field>
      <Field label={F.receiver}>
        <SelectCell value={a.receiver.id} options={opts.objects(p, a.receiver.type)} commit={(v) => edit((x) => void (x.receiver.id = v))} />
      </Field>
      <Field label={F.quantity}>
        <div className="w-32">
          <NumberCell value={a.quantity} commit={(v) => edit((x) => void (x.quantity = v))} />
        </div>
      </Field>
    </div>
  );
}

// ---------- 間接費計算（F3-04） ----------
function CostingForm({ id }: { id: string }) {
  const p = useProjectStore((s) => s.project);
  const cs = useScenario().costingSheets.find((x) => x.id === id)!;
  const edit = useRuleEdit<CostingSheet>('COSTING', id);
  const editRow = (i: number, recipe: (r: CostingSheet['rows'][number]) => void) => edit((x) => recipe(x.rows[i]!));
  return (
    <div className="space-y-3">
      <Field label={F.targets}>
        <ObjChips p={p} type="WBS" ids={cs.targets.map((t) => t.id)} onChange={(ids) => edit((x) => void (x.targets = ids.map((tid) => ({ type: 'WBS' as const, id: tid }))))} />
      </Field>
      <div className="space-y-1">
        <span className="text-sm text-muted-foreground">{F.rows}</span>
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="text-left font-normal">{F.base}</th>
              <th className="text-right font-normal">{F.ratePct}</th>
              <th className="text-left font-normal">{F.creditCctr}</th>
              <th className="text-left font-normal">{F.overheadAccount}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {cs.rows.map((row, i) => (
              <tr key={i}>
                <td>
                  <AccountRanges value={row.base} onChange={(v) => editRow(i, (r) => void (r.base = v))} />
                </td>
                <td className="w-24">
                  <NumberCell value={row.ratePct} commit={(v) => editRow(i, (r) => void (r.ratePct = v))} />
                </td>
                <td>
                  <SelectCell value={row.creditCctr} options={opts.costCenters(p)} commit={(v) => editRow(i, (r) => void (r.creditCctr = v))} />
                </td>
                <td>
                  <SelectCell value={row.overheadAccount} options={opts.accounts(p, ['SEC41'])} commit={(v) => editRow(i, (r) => void (r.overheadAccount = v))} />
                </td>
                <td>
                  <Button size="icon-xs" variant="ghost" aria-label={ja.table.delete} onClick={() => edit((x) => void x.rows.splice(i, 1))}>
                    <Trash2 />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Button
          size="xs"
          variant="outline"
          onClick={() =>
            edit((x, proj) => {
              const prev = x.rows.at(-1);
              x.rows.push({
                base: prev ? [...prev.base] : [],
                ratePct: 0,
                creditCctr: prev?.creditCctr ?? proj.master.costCenters[0]?.id ?? '',
                overheadAccount: prev?.overheadAccount ?? proj.master.accounts.find((a) => a.category === 'SEC41')?.id ?? '',
              });
            })
          }
        >
          <Plus />
          {F.addRow}
        </Button>
      </div>
    </div>
  );
}

// ---------- TDD（F3-05） ----------
function TddForm({ id }: { id: string }) {
  const p = useProjectStore((s) => s.project);
  const r = useScenario().tddRules.find((x) => x.id === id)!;
  const edit = useRuleEdit<TDDRule>('TDD', id);
  const charLabel = ja.master.col;
  return (
    <div className="space-y-3">
      <Field label={F.name}>
        <TextCell className={boxed} value={r.name} commit={(v) => edit((x) => void (x.name = v))} />
      </Field>
      <Field label={F.senderSegments}>
        <SelectorEditor p={p} value={r.sender.segments} types={['PSEG']} onChange={(v) => edit((x) => void (x.sender.segments = v))} />
      </Field>
      <Field label={F.senderAccounts}>
        <AccountRanges value={r.sender.accounts} onChange={(v) => edit((x) => void (x.sender.accounts = v))} />
      </Field>
      <Field label={F.distributeChars}>
        <div className="flex flex-wrap gap-3">
          {CHAR_KEYS.map((k: CharKey) => (
            <label key={k} className={cn('flex items-center gap-1.5 text-sm')}>
              <Checkbox
                checked={r.distributeChars.includes(k)}
                onCheckedChange={(c) => edit((x) => void (x.distributeChars = c === true ? CHAR_KEYS.filter((y) => y === k || x.distributeChars.includes(y)) : x.distributeChars.filter((y) => y !== k)))}
              />
              {charLabel[k]}
            </label>
          ))}
        </div>
      </Field>
      <Field label={F.referenceAccounts}>
        <AccountRanges value={r.reference.accounts} onChange={(v) => edit((x) => void (x.reference.accounts = v))} />
      </Field>
    </div>
  );
}

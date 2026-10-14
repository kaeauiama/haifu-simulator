/**
 * マスタ画面（F1）。組織と科目を表形式で編集する。識別子を変えると参照ごと付け替える。
 */
import {
  CHAR_KEYS,
  formatIdList,
  formatStructure,
  parseIdList,
  parseStructure,
  renameReference,
  segmentKey,
  type ActivityType,
  type CharKey,
  type CostCenter,
  type GLAccount,
  type Group,
  type ObjType,
  type ProfitCenter,
  type ProfitabilitySegment,
  type SettlementProfile,
  type StatKeyFigure,
  type WBSElement,
} from '@alloc-sim/engine';
import type { Col } from '@/components/DataTable';
import { CheckCell, NumberCell, SelectCell, TextCell } from '@/components/cells';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ja } from '@/i18n/ja';
import { useProjectStore } from '@/store/project';
import { EditGrid } from './EditGrid';
import { deleteChecked, edit, newId, opts, project, renameCommit } from './masterEdit';

const C = ja.master.col;
const TABS = ['basic', 'accounts', 'profitCenters', 'costCenters', 'wbs', 'activityTypes', 'skfs', 'segments', 'groups', 'profiles'] as const;

export function MasterScreen() {
  return (
    <div className="h-full overflow-auto p-3">
      <Tabs defaultValue="costCenters" className="gap-3">
        <TabsList className="flex-wrap">
          {TABS.map((t) => (
            <TabsTrigger key={t} value={t}>
              {ja.master.tabs[t]}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="basic">
          <BasicForm />
        </TabsContent>
        <TabsContent value="accounts">
          <Accounts />
        </TabsContent>
        <TabsContent value="profitCenters">
          <ProfitCenters />
        </TabsContent>
        <TabsContent value="costCenters">
          <CostCenters />
        </TabsContent>
        <TabsContent value="wbs">
          <Wbs />
        </TabsContent>
        <TabsContent value="activityTypes" className="space-y-6">
          <ActivityTypes />
          <Rates />
        </TabsContent>
        <TabsContent value="skfs" className="space-y-6">
          <Skfs />
          <SkfValues />
        </TabsContent>
        <TabsContent value="segments">
          <Segments />
        </TabsContent>
        <TabsContent value="groups">
          <Groups />
        </TabsContent>
        <TabsContent value="profiles">
          <Profiles />
        </TabsContent>
      </Tabs>
    </div>
  );
}

const useMaster = () => useProjectStore((s) => s.project.master);

function BasicForm() {
  const m = useMaster();
  const B = ja.master.basic;
  const field = (label: string, node: React.ReactNode) => (
    <label className="grid grid-cols-[12rem_16rem] items-center gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {node}
    </label>
  );
  return (
    <div className="max-w-xl space-y-2 rounded-md border p-3">
      {field(B.controllingArea, <TextCell value={m.controllingArea ?? ''} commit={(v) => edit((p) => void (p.master.controllingArea = v || undefined))} className="border-border" />)}
      {field(B.companyCode, <TextCell value={m.companyCode ?? ''} commit={(v) => edit((p) => void (p.master.companyCode = v || undefined))} className="border-border" />)}
      {field(B.currency, <span className="px-1.5">{m.currency}</span>)}
      {field(
        B.period,
        <NumberCell
          value={m.period}
          commit={(v) => {
            if (!Number.isInteger(v)) return ja.table.notInteger;
            edit((p) => void (p.master.period = v));
          }}
        />,
      )}
    </div>
  );
}

function Accounts() {
  const m = useMaster();
  const ids = () => project().master.accounts.map((a) => a.id);
  const cols: Col<GLAccount>[] = [
    { id: 'id', header: C.id, cell: (a) => <TextCell mono value={a.id} commit={renameCommit('ACCOUNT', ids, a.id)} /> },
    { id: 'name', header: C.name, cell: (a, i) => <TextCell value={a.name} commit={(v) => edit((p) => void (p.master.accounts[i]!.name = v))} /> },
    {
      id: 'category',
      header: C.category,
      cell: (a, i) => (
        <SelectCell value={a.category} options={opts.enumOf(ja.accountCategory)} commit={(v) => edit((p) => void (p.master.accounts[i]!.category = v as GLAccount['category']))} />
      ),
    },
  ];
  return (
    <EditGrid
      note={ja.master.mockNote}
      rows={m.accounts}
      cols={cols}
      rowKey={(a) => a.id}
      onAdd={() => edit((p) => void p.master.accounts.push({ id: newId(ids(), 'ACC'), name: '', category: 'PRIMARY' }))}
      onDelete={(a) => deleteChecked('ACCOUNT', a.id, (p) => void (p.master.accounts = p.master.accounts.filter((x) => x.id !== a.id)))}
    />
  );
}

function ProfitCenters() {
  const m = useMaster();
  const ids = () => project().master.profitCenters.map((a) => a.id);
  const cols: Col<ProfitCenter>[] = [
    { id: 'id', header: C.id, cell: (x) => <TextCell mono value={x.id} commit={renameCommit('PCTR', ids, x.id)} /> },
    { id: 'name', header: C.name, cell: (x, i) => <TextCell value={x.name} commit={(v) => edit((p) => void (p.master.profitCenters[i]!.name = v))} /> },
    {
      id: 'group',
      header: C.group,
      cell: (x, i) => (
        <SelectCell allowEmpty value={x.groupId ?? ''} options={opts.groups(project(), 'PCTR')} commit={(v) => edit((p) => void (p.master.profitCenters[i]!.groupId = v || undefined))} />
      ),
    },
  ];
  return (
    <EditGrid
      rows={m.profitCenters}
      cols={cols}
      rowKey={(x) => x.id}
      onAdd={() => edit((p) => void p.master.profitCenters.push({ id: newId(ids(), 'PC'), name: '' }))}
      onDelete={(x) => deleteChecked('PCTR', x.id, (p) => void (p.master.profitCenters = p.master.profitCenters.filter((y) => y.id !== x.id)))}
    />
  );
}

function CostCenters() {
  const m = useMaster();
  const ids = () => project().master.costCenters.map((a) => a.id);
  const set = (i: number, recipe: (c: CostCenter) => void) => edit((p) => recipe(p.master.costCenters[i]!));
  const cols: Col<CostCenter>[] = [
    { id: 'id', header: C.id, cell: (x) => <TextCell mono value={x.id} commit={renameCommit('CCTR', ids, x.id)} /> },
    { id: 'name', header: C.name, cell: (x, i) => <TextCell value={x.name} commit={(v) => set(i, (c) => void (c.name = v))} /> },
    { id: 'pc', header: C.profitCenter, cell: (x, i) => <SelectCell value={x.profitCenter} options={opts.profitCenters(project())} commit={(v) => set(i, (c) => void (c.profitCenter = v))} /> },
    { id: 'kind', header: C.kind, cell: (x, i) => <SelectCell value={x.kind} options={opts.enumOf(ja.cctrKind)} commit={(v) => set(i, (c) => void (c.kind = v as CostCenter['kind']))} /> },
    {
      id: 'group',
      header: C.group,
      cell: (x, i) => <SelectCell allowEmpty value={x.groupId ?? ''} options={opts.groups(project(), 'CCTR')} commit={(v) => set(i, (c) => void (c.groupId = v || undefined))} />,
    },
  ];
  return (
    <EditGrid
      rows={m.costCenters}
      cols={cols}
      rowKey={(x) => x.id}
      onAdd={() => edit((p) => void p.master.costCenters.push({ id: newId(ids(), 'CC'), name: '', profitCenter: p.master.profitCenters[0]?.id ?? '', kind: 'ADMIN' }))}
      onDelete={(x) => deleteChecked('CCTR', x.id, (p) => void (p.master.costCenters = p.master.costCenters.filter((y) => y.id !== x.id)))}
    />
  );
}

function Wbs() {
  const m = useMaster();
  const ids = () => project().master.wbs.map((a) => a.id);
  const set = (i: number, recipe: (w: WBSElement) => void) => edit((p) => recipe(p.master.wbs[i]!));
  const cols: Col<WBSElement>[] = [
    { id: 'id', header: C.id, cell: (x) => <TextCell mono value={x.id} commit={renameCommit('WBS', ids, x.id)} /> },
    { id: 'name', header: C.name, cell: (x, i) => <TextCell value={x.name} commit={(v) => set(i, (w) => void (w.name = v))} /> },
    {
      id: 'type',
      header: C.projectType,
      cell: (x, i) => <SelectCell value={x.projectType} options={opts.enumOf(ja.projectType)} commit={(v) => set(i, (w) => void (w.projectType = v as WBSElement['projectType']))} />,
    },
    { id: 'resp', header: C.responsibleCctr, cell: (x, i) => <SelectCell value={x.responsibleCctr} options={opts.costCenters(project())} commit={(v) => set(i, (w) => void (w.responsibleCctr = v))} /> },
    { id: 'pc', header: C.profitCenter, cell: (x, i) => <SelectCell value={x.profitCenter} options={opts.profitCenters(project())} commit={(v) => set(i, (w) => void (w.profitCenter = v))} /> },
    { id: 'stat', header: C.statistical, align: 'center', cell: (x, i) => <CheckCell label={C.statistical} value={x.statistical} commit={(v) => set(i, (w) => void (w.statistical = v))} /> },
    {
      id: 'attr',
      header: C.attributedSegment,
      cell: (x, i) => (
        <SelectCell allowEmpty value={x.attributedSegment ?? ''} options={opts.segments(project())} commit={(v) => set(i, (w) => void (w.attributedSegment = v || undefined))} />
      ),
    },
    {
      id: 'profile',
      header: C.settlementProfile,
      cell: (x, i) => (
        <SelectCell allowEmpty value={x.settlementProfileId ?? ''} options={opts.profiles(project())} commit={(v) => set(i, (w) => void (w.settlementProfileId = v || undefined))} />
      ),
    },
  ];
  return (
    <EditGrid
      rows={m.wbs}
      cols={cols}
      rowKey={(x) => x.id}
      onAdd={() =>
        edit((p) =>
          void p.master.wbs.push({
            id: newId(ids(), 'P-'),
            name: '',
            projectType: 'OVERHEAD',
            responsibleCctr: p.master.costCenters[0]?.id ?? '',
            profitCenter: p.master.profitCenters[0]?.id ?? '',
            statistical: false,
          }),
        )
      }
      onDelete={(x) => deleteChecked('WBS', x.id, (p) => void (p.master.wbs = p.master.wbs.filter((y) => y.id !== x.id)))}
    />
  );
}

function ActivityTypes() {
  const m = useMaster();
  const ids = () => project().master.activityTypes.map((a) => a.id);
  const set = (i: number, recipe: (a: ActivityType) => void) => edit((p) => recipe(p.master.activityTypes[i]!));
  const cols: Col<ActivityType>[] = [
    { id: 'id', header: C.id, cell: (x) => <TextCell mono value={x.id} commit={renameCommit('ACTIVITY', ids, x.id)} /> },
    { id: 'name', header: C.name, cell: (x, i) => <TextCell value={x.name} commit={(v) => set(i, (a) => void (a.name = v))} /> },
    { id: 'unit', header: C.unit, cell: (x, i) => <TextCell value={x.unit} commit={(v) => set(i, (a) => void (a.unit = v))} /> },
    {
      id: 'acc',
      header: C.allocAccount,
      cell: (x, i) => <SelectCell value={x.allocAccount} options={opts.accounts(project(), ['SEC43'])} commit={(v) => set(i, (a) => void (a.allocAccount = v))} />,
    },
  ];
  return (
    <EditGrid
      title={ja.master.tabs.activityTypes}
      rows={m.activityTypes}
      cols={cols}
      rowKey={(x) => x.id}
      onAdd={() =>
        edit((p) => void p.master.activityTypes.push({ id: newId(ids(), 'AT'), name: '', unit: '時間', allocAccount: p.master.accounts.find((a) => a.category === 'SEC43')?.id ?? '', rates: [] }))
      }
      onDelete={(x) => deleteChecked('ACTIVITY', x.id, (p) => void (p.master.activityTypes = p.master.activityTypes.filter((y) => y.id !== x.id)))}
    />
  );
}

interface RateRow {
  type: string;
  index: number;
  cctr: string;
  planRate: number;
}

function Rates() {
  const m = useMaster();
  const rows: RateRow[] = m.activityTypes.flatMap((a) => a.rates.map((r, index) => ({ type: a.id, index, cctr: r.cctr, planRate: r.planRate })));
  const setRate = (r: RateRow, recipe: (x: { cctr: string; planRate: number }) => void) =>
    edit((p) => {
      const rate = p.master.activityTypes.find((a) => a.id === r.type)?.rates[r.index];
      if (rate) recipe(rate);
    });
  const cols: Col<RateRow>[] = [
    {
      id: 'type',
      header: C.activityType,
      cell: (r) => (
        <SelectCell
          value={r.type}
          options={opts.activityTypes(project())}
          commit={(v) =>
            edit((p) => {
              const from = p.master.activityTypes.find((a) => a.id === r.type)!;
              const [moved] = from.rates.splice(r.index, 1);
              p.master.activityTypes.find((a) => a.id === v)!.rates.push(moved!);
            })
          }
        />
      ),
    },
    { id: 'cctr', header: C.cctr, cell: (r) => <SelectCell value={r.cctr} options={opts.costCenters(project())} commit={(v) => setRate(r, (x) => void (x.cctr = v))} /> },
    { id: 'rate', header: C.planRate, align: 'right', cell: (r) => <NumberCell integer value={r.planRate} commit={(v) => setRate(r, (x) => void (x.planRate = v))} /> },
  ];
  return (
    <EditGrid
      title={ja.master.tabs.rates}
      rows={rows}
      cols={cols}
      rowKey={(r) => `${r.type}#${r.index}`}
      onAdd={
        m.activityTypes.length
          ? () => edit((p) => void p.master.activityTypes[0]!.rates.push({ cctr: p.master.costCenters[0]?.id ?? '', planRate: 0 }))
          : undefined
      }
      onDelete={(r) => edit((p) => void p.master.activityTypes.find((a) => a.id === r.type)!.rates.splice(r.index, 1))}
    />
  );
}

function Skfs() {
  const m = useMaster();
  const ids = () => project().master.skfs.map((a) => a.id);
  const set = (i: number, recipe: (s: StatKeyFigure) => void) => edit((p) => recipe(p.master.skfs[i]!));
  const cols: Col<StatKeyFigure>[] = [
    { id: 'id', header: C.id, cell: (x) => <TextCell mono value={x.id} commit={renameCommit('SKF', ids, x.id)} /> },
    { id: 'name', header: C.name, cell: (x, i) => <TextCell value={x.name} commit={(v) => set(i, (s) => void (s.name = v))} /> },
    { id: 'unit', header: C.unit, cell: (x, i) => <TextCell value={x.unit} commit={(v) => set(i, (s) => void (s.unit = v))} /> },
  ];
  return (
    <EditGrid
      title={ja.master.tabs.skfs}
      rows={m.skfs}
      cols={cols}
      rowKey={(x) => x.id}
      onAdd={() => edit((p) => void p.master.skfs.push({ id: newId(ids(), 'SKF'), name: '', unit: '', values: [] }))}
      onDelete={(x) => deleteChecked('SKF', x.id, (p) => void (p.master.skfs = p.master.skfs.filter((y) => y.id !== x.id)))}
    />
  );
}

interface SkfValueRow {
  skf: string;
  index: number;
  type: ObjType;
  id: string;
  value: number;
}

const OBJ_TYPES_FOR_VALUES: ObjType[] = ['CCTR', 'WBS', 'PSEG'];

function SkfValues() {
  const m = useMaster();
  const rows: SkfValueRow[] = m.skfs.flatMap((s) => s.values.map((v, index) => ({ skf: s.id, index, type: v.obj.type, id: v.obj.id, value: v.value })));
  const setValue = (r: SkfValueRow, recipe: (x: StatKeyFigure['values'][number]) => void) =>
    edit((p) => {
      const v = p.master.skfs.find((s) => s.id === r.skf)?.values[r.index];
      if (v) recipe(v);
    });
  const typeOptions = OBJ_TYPES_FOR_VALUES.map((t) => ({ value: t, label: ja.objType[t] }));
  const cols: Col<SkfValueRow>[] = [
    {
      id: 'skf',
      header: C.skf,
      cell: (r) => (
        <SelectCell
          value={r.skf}
          options={opts.skfs(project())}
          commit={(v) =>
            edit((p) => {
              const [moved] = p.master.skfs.find((s) => s.id === r.skf)!.values.splice(r.index, 1);
              p.master.skfs.find((s) => s.id === v)!.values.push(moved!);
            })
          }
        />
      ),
    },
    {
      id: 'type',
      header: C.objType,
      cell: (r) => (
        <SelectCell
          value={r.type}
          options={typeOptions}
          commit={(v) =>
            setValue(r, (x) => {
              x.obj = { type: v as ObjType, id: opts.objects(project(), v)[0]?.value ?? '' };
            })
          }
        />
      ),
    },
    { id: 'obj', header: C.objId, cell: (r) => <SelectCell value={r.id} options={opts.objects(project(), r.type)} commit={(v) => setValue(r, (x) => void (x.obj.id = v))} /> },
    { id: 'value', header: C.value, align: 'right', cell: (r) => <NumberCell value={r.value} commit={(v) => setValue(r, (x) => void (x.value = v))} /> },
  ];
  return (
    <EditGrid
      title={ja.master.tabs.skfValues}
      rows={rows}
      cols={cols}
      rowKey={(r) => `${r.skf}#${r.index}`}
      onAdd={m.skfs.length ? () => edit((p) => void p.master.skfs[0]!.values.push({ obj: { type: 'CCTR', id: p.master.costCenters[0]?.id ?? '' }, value: 0 })) : undefined}
      onDelete={(r) => edit((p) => void p.master.skfs.find((s) => s.id === r.skf)!.values.splice(r.index, 1))}
    />
  );
}

const CHAR_LABEL: Record<CharKey, string> = {
  customer: C.customer,
  customerGroup: C.customerGroup,
  product: C.product,
  productGroup: C.productGroup,
  region: C.region,
  profitCenter: C.profitCenter,
};

function Segments() {
  const m = useMaster();
  /** 特性を変えたら識別子を計算し直し、参照ごと付け替える（D-005） */
  const setChar = (seg: ProfitabilitySegment, k: CharKey, v: string): string | void => {
    const chars = { ...seg.chars };
    if (v) chars[k] = v;
    else delete chars[k];
    const next = segmentKey(chars);
    if (next !== seg.id && project().master.segments.some((s) => s.id === next)) return ja.table.duplicateId(next);
    edit((p) => {
      p.master.segments.find((s) => s.id === seg.id)!.chars = chars;
      renameReference(p, 'PSEG', seg.id, next);
    });
  };
  const cols: Col<ProfitabilitySegment>[] = [
    ...CHAR_KEYS.map(
      (k): Col<ProfitabilitySegment> => ({
        id: k,
        header: CHAR_LABEL[k],
        cell: (s) =>
          k === 'profitCenter' ? (
            <SelectCell allowEmpty emptyLabel="*" value={s.chars[k] ?? ''} options={opts.profitCenters(project())} commit={(v) => setChar(s, k, v)} />
          ) : (
            <TextCell value={s.chars[k] ?? ''} placeholder="*" commit={(v) => setChar(s, k, v)} />
          ),
      }),
    ),
    {
      id: 'attributed',
      header: C.attributed,
      align: 'center',
      cell: (s, i) => <CheckCell label={C.attributed} value={s.attributed} commit={(v) => edit((p) => void (p.master.segments[i]!.attributed = v))} />,
    },
    { id: 'id', header: C.id, cell: (s) => <span className="font-mono text-xs text-muted-foreground">{s.id}</span> },
  ];
  return (
    <EditGrid
      note={ja.master.segmentIdNote}
      rows={m.segments}
      cols={cols}
      rowKey={(s) => s.id}
      onAdd={() =>
        edit((p) => {
          const customers = p.master.segments.map((s) => s.chars.customer ?? '');
          const chars = { customer: newId(customers, 'NEW') };
          p.master.segments.push({ id: segmentKey(chars), chars, attributed: false });
        })
      }
      onDelete={(s) => deleteChecked('PSEG', s.id, (p) => void (p.master.segments = p.master.segments.filter((y) => y.id !== s.id)))}
    />
  );
}

function Groups() {
  const m = useMaster();
  const ids = () => project().master.groups.map((a) => a.id);
  const set = (i: number, recipe: (g: Group) => void) => edit((p) => recipe(p.master.groups[i]!));
  const typeOptions = (['CCTR', 'PCTR', 'WBS', 'PSEG'] as ObjType[]).map((t) => ({ value: t, label: ja.objType[t] }));
  const cols: Col<Group>[] = [
    { id: 'id', header: C.id, cell: (x) => <TextCell mono value={x.id} commit={renameCommit('GROUP', ids, x.id)} /> },
    { id: 'type', header: C.type, cell: (x, i) => <SelectCell value={x.type} options={typeOptions} commit={(v) => set(i, (g) => void (g.type = v as ObjType))} /> },
    { id: 'name', header: C.name, cell: (x, i) => <TextCell value={x.name} commit={(v) => set(i, (g) => void (g.name = v))} /> },
    { id: 'members', header: C.members, cell: (x, i) => <TextCell mono value={formatIdList(x.members)} commit={(v) => set(i, (g) => void (g.members = parseIdList(v)))} /> },
  ];
  return (
    <EditGrid
      rows={m.groups}
      cols={cols}
      rowKey={(x) => x.id}
      onAdd={() => edit((p) => void p.master.groups.push({ id: newId(ids(), 'G-'), type: 'CCTR', name: '', members: [] }))}
      onDelete={(x) => deleteChecked('GROUP', x.id, (p) => void (p.master.groups = p.master.groups.filter((y) => y.id !== x.id)))}
    />
  );
}

const PROFILE_TYPES: ObjType[] = ['CCTR', 'WBS', 'PSEG'];

function Profiles() {
  const m = useMaster();
  const ids = () => project().master.settlementProfiles.map((a) => a.id);
  const set = (i: number, recipe: (s: SettlementProfile) => void) => edit((p) => recipe(p.master.settlementProfiles[i]!));
  const cols: Col<SettlementProfile>[] = [
    { id: 'id', header: C.id, cell: (x) => <TextCell mono value={x.id} commit={renameCommit('PROFILE', ids, x.id)} /> },
    {
      id: 'allowed',
      header: C.allowed,
      cell: (x, i) => (
        <div className="flex gap-3">
          {PROFILE_TYPES.map((t) => (
            <label key={t} className="flex items-center gap-1 text-xs whitespace-nowrap">
              <Checkbox
                checked={x.allowed.includes(t)}
                onCheckedChange={(c) => set(i, (s) => void (s.allowed = c === true ? [...s.allowed.filter((y) => y !== t), t] : s.allowed.filter((y) => y !== t)))}
              />
              {ja.objType[t]}
            </label>
          ))}
        </div>
      ),
    },
    {
      id: 'structure',
      header: C.structure,
      cell: (x, i) => (
        <TextCell
          mono
          value={formatStructure(x.structure)}
          commit={(v) => {
            const r = parseStructure(v);
            if (!r.ok) return r.error;
            set(i, (s) => void (s.structure = r.value));
          }}
        />
      ),
    },
  ];
  return (
    <EditGrid
      rows={m.settlementProfiles}
      cols={cols}
      rowKey={(x) => x.id}
      onAdd={() => edit((p) => void p.master.settlementProfiles.push({ id: newId(ids(), 'SP-'), allowed: ['CCTR'], structure: [] }))}
      onDelete={(x) => deleteChecked('PROFILE', x.id, (p) => void (p.master.settlementProfiles = p.master.settlementProfiles.filter((y) => y.id !== x.id)))}
    />
  );
}

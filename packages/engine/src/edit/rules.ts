/**
 * ルールの作成と削除。フロー図でノード間に線を引いたとき（6章）と、ルール一覧から追加するときに使う。
 * 関数は渡されたプロジェクトをその場で書き換える（画面の Immer の下書きに対して呼ぶ）。
 */
import { cycleMethod, methodsFor, STEP_KIND_OF, type Method, type RuleKind } from '../graph/rules.ts';
import { parseSegmentKey } from '../model/keys.ts';
import { CHAR_KEYS } from '../model/schema.ts';
import type { AccountCategory, AccountSelector, AllocSegment, AllocationCycle, CharKey, Master, ObjRef, Project, Scenario } from '../model/types.ts';

/** 既存の識別子と重ならない「prefix + 2桁の連番」 */
export function nextId(prefix: string, existing: Iterable<string>): string {
  const used = new Set(existing);
  for (let n = 1; ; n++) {
    const id = `${prefix}${String(n).padStart(2, '0')}`;
    if (!used.has(id)) return id;
  }
}

/** シナリオの全ルールの識別子（ルールの種類をまたいで重ならないようにする） */
export const allRuleIds = (s: Scenario): string[] => [s.cycles, s.tddRules, s.settlementRules, s.activityAllocs, s.costingSheets].flatMap((xs) => xs.map((x) => x.id));

const ID_PREFIX: Record<RuleKind, string> = { CYCLE: 'CY-', TDD: 'TDD-', SETTLEMENT: 'SR-', ACTIVITY: 'AA-', COSTING: 'CS-' };

/** 勘定科目表から、区分に当てはまる勘定の最小〜最大を範囲にする */
export function accountRangeOf(m: Master, categories: AccountCategory[]): AccountSelector {
  const ids = m.accounts.filter((a) => categories.includes(a.category)).map((a) => a.id);
  if (!ids.length) return [];
  const sorted = [...ids].sort((a, b) => (a.length !== b.length ? a.length - b.length : a < b ? -1 : 1));
  return [{ from: sorted[0]!, to: sorted[sorted.length - 1]! }];
}

const PRIMARY: AccountCategory[] = ['PRIMARY'];
const COSTS: AccountCategory[] = ['PRIMARY', 'SEC21', 'SEC41', 'SEC42', 'SEC43'];
const firstAccount = (m: Master, c: AccountCategory) => m.accounts.find((a) => a.category === c)?.id;

/** 線を引いたときの選択肢 */
export type DragTarget =
  | { kind: 'NEW'; method: Method; activityType?: string }
  | { kind: 'ADD_TO_SEGMENT'; method: Method; cycleId: string; segmentId: string; label: string }
  | { kind: 'ADD_TO_SETTLEMENT'; method: 'SETTLEMENT'; ruleId: string }
  | { kind: 'ADD_TO_COSTING'; method: 'OVERHEAD_CALC'; sheetId: string };

export function dragOptions(p: Project, scenarioId: string, sender: ObjRef, receiver: ObjRef): DragTarget[] {
  const s = scenario(p, scenarioId);
  const out: DragTarget[] = [];
  for (const method of methodsFor(sender.type, receiver.type)) {
    if (method === 'DIST' || method === 'ASSESS' || method === 'MA') {
      for (const c of s.cycles) {
        if (cycleMethod(c) !== method) continue;
        for (const seg of c.segments) {
          const so = seg.sender.objects;
          if (so.mode !== 'LIST' || so.type !== sender.type || !so.ids.includes(sender.id)) continue;
          if (receiversOf(seg).some((r) => r.type === receiver.type && r.id === receiver.id)) continue;
          out.push({ kind: 'ADD_TO_SEGMENT', method, cycleId: c.id, segmentId: seg.id, label: `${c.name}／${seg.name}` });
        }
      }
    }
    if (method === 'SETTLEMENT') {
      const r = s.settlementRules.find((x) => x.sender.type === sender.type && x.sender.id === sender.id);
      if (r) {
        out.push({ kind: 'ADD_TO_SETTLEMENT', method, ruleId: r.id });
        continue;
      }
    }
    if (method === 'OVERHEAD_CALC') {
      for (const cs of s.costingSheets) {
        if (cs.rows.some((row) => row.creditCctr === sender.id) && !cs.targets.some((t) => t.type === receiver.type && t.id === receiver.id)) {
          out.push({ kind: 'ADD_TO_COSTING', method, sheetId: cs.id });
        }
      }
    }
    out.push({ kind: 'NEW', method });
  }
  return out;
}

function receiversOf(seg: AllocSegment): ObjRef[] {
  const f = seg.receiver.factor;
  if (f.kind === 'FIXED_PERCENT' || f.kind === 'FIXED_PORTION') return f.weights.map((w) => w.obj);
  const r = seg.receiver.objects;
  return r.mode === 'LIST' ? r.ids.map((id) => ({ type: r.type, id })) : [];
}

function scenario(p: Project, id: string): Scenario {
  const s = p.scenarios.find((x) => x.id === id);
  if (!s) throw new Error(`scenario not found: ${id}`);
  return s;
}

export interface CreatedRule {
  kind: RuleKind;
  id: string;
}

/**
 * 線を引いた結果をルールにする。新しいルールは、手法に合う標準テンプレートのステップに入れる（なければ作る）。
 * 作れないときは、理由を message に持つ Error を投げる。
 */
export function applyDrag(p: Project, scenarioId: string, sender: ObjRef, receiver: ObjRef, target: DragTarget, opts: { stepName: (m: Method) => string }): CreatedRule {
  const s = scenario(p, scenarioId);
  const m = p.master;
  switch (target.kind) {
    case 'ADD_TO_SEGMENT': {
      const c = s.cycles.find((x) => x.id === target.cycleId)!;
      const seg = c.segments.find((x) => x.id === target.segmentId)!;
      addReceiver(seg, receiver);
      return { kind: 'CYCLE', id: c.id };
    }
    case 'ADD_TO_SETTLEMENT': {
      const r = s.settlementRules.find((x) => x.id === target.ruleId)!;
      const used = r.rules.filter((d) => d.basis === 'PCT').reduce((t, d) => t + d.value, 0);
      r.rules.push({ receiver, basis: 'PCT', value: Math.max(0, 100 - used), settlementType: 'FUL', validFrom: m.period });
      return { kind: 'SETTLEMENT', id: r.id };
    }
    case 'ADD_TO_COSTING': {
      const cs = s.costingSheets.find((x) => x.id === target.sheetId)!;
      cs.targets.push(receiver);
      return { kind: 'COSTING', id: cs.id };
    }
    case 'NEW':
      break;
  }

  const method = target.method;
  const ids = allRuleIds(s);
  let created: CreatedRule;
  switch (method) {
    case 'DIST':
    case 'ASSESS':
    case 'MA': {
      const id = nextId(ID_PREFIX.CYCLE, ids);
      const cycle: AllocationCycle = {
        id,
        name: `${opts.stepName(method)} ${sender.id}`,
        context: method === 'MA' ? 'MA' : sender.type === 'PCTR' ? 'PCTR' : 'CCTR',
        type: method === 'DIST' ? 'DISTRIBUTION' : 'OVERHEAD',
        iterative: false,
        segments: [newSegment(m, method, sender, receiver)],
      };
      s.cycles.push(cycle);
      created = { kind: 'CYCLE', id };
      break;
    }
    case 'SETTLEMENT': {
      const id = nextId(ID_PREFIX.SETTLEMENT, ids);
      s.settlementRules.push({ id, sender, rules: [{ receiver, basis: 'PCT', value: 100, settlementType: 'FUL', validFrom: m.period }] });
      created = { kind: 'SETTLEMENT', id };
      break;
    }
    case 'OVERHEAD_CALC': {
      const id = nextId(ID_PREFIX.COSTING, ids);
      const account = firstAccount(m, 'SEC41');
      if (!account) throw new Error('カテゴリ41の勘定（間接費計算）が勘定科目表にありません');
      s.costingSheets.push({ id, rows: [{ base: accountRangeOf(m, PRIMARY), ratePct: 10, creditCctr: sender.id, overheadAccount: account }], targets: [receiver] });
      created = { kind: 'COSTING', id };
      break;
    }
    case 'ACTIVITY': {
      const requested = target.activityType;
      const at =
        (requested ? m.activityTypes.find((a) => a.id === requested) : undefined) ??
        m.activityTypes.find((a) => a.rates.some((r) => r.cctr === sender.id)) ??
        m.activityTypes[0];
      if (!at) throw new Error('活動タイプがありません（マスタの活動タイプで作ってください）');
      const id = nextId(ID_PREFIX.ACTIVITY, ids);
      s.activityAllocs.push({ id, senderCctr: sender.id, activityType: at.id, receiver, quantity: 0 });
      created = { kind: 'ACTIVITY', id };
      break;
    }
    case 'TDD': {
      const sc = parseSegmentKey(sender.id);
      const rc = parseSegmentKey(receiver.id);
      const distributeChars = CHAR_KEYS.filter((k): k is CharKey => sc[k] === undefined && rc[k] !== undefined);
      if (!distributeChars.length) throw new Error('受信側のセグメントに、送信側より細かい特性がありません');
      const id = nextId(ID_PREFIX.TDD, ids);
      s.tddRules.push({
        id,
        name: `${opts.stepName('TDD')} ${distributeChars.join('・')}`,
        sender: { segments: { type: 'PSEG', mode: 'LIST', ids: [sender.id] }, accounts: accountRangeOf(m, COSTS) },
        distributeChars,
        reference: { accounts: accountRangeOf(m, ['REVENUE']), source: 'CURRENT_PERIOD' },
      });
      created = { kind: 'TDD', id };
      break;
    }
  }
  assignToStep(s, created, method, receiver, opts.stepName(method));
  return created;
}

function newSegment(m: Master, method: Method, sender: ObjRef, receiver: ObjRef): AllocSegment {
  const seg: AllocSegment = {
    id: 'SEG-01',
    name: sender.id,
    sender: { objects: { type: sender.type, mode: 'LIST', ids: [sender.id] }, accounts: accountRangeOf(m, method === 'DIST' ? PRIMARY : COSTS), sharePct: 100 },
    // 受信者を足していけるよう、既定は等分（固定比率 1）
    receiver: { objects: { type: receiver.type, mode: 'LIST', ids: [receiver.id] }, factor: { kind: 'FIXED_PORTION', weights: [{ obj: receiver, portion: 1 }] } },
  };
  if (method !== 'DIST') {
    const acc = firstAccount(m, 'SEC42');
    if (acc) seg.allocAccount = acc;
  }
  return seg;
}

function addReceiver(seg: AllocSegment, receiver: ObjRef): void {
  const f = seg.receiver.factor;
  if (f.kind === 'FIXED_PERCENT') f.weights.push({ obj: receiver, pct: 0 });
  else if (f.kind === 'FIXED_PORTION') f.weights.push({ obj: receiver, portion: 1 });
  const r = seg.receiver.objects;
  if (r.mode === 'LIST' && r.type === receiver.type && !r.ids.includes(receiver.id)) r.ids.push(receiver.id);
}

/**
 * 表示中のサイクルに、送信 → 受信の関係を足す（手法別ビュー）。
 * 送信者を個別に選んでいるセグメントがあれば受信者を足し、なければ送信者の新しいセグメントを作る。
 */
export function connectInCycle(p: Project, scenarioId: string, cycleId: string, sender: ObjRef, receiver: ObjRef): void {
  const c = scenario(p, scenarioId).cycles.find((x) => x.id === cycleId);
  if (!c) throw new Error(`cycle not found: ${cycleId}`);
  const seg = c.segments.find((x) => x.sender.objects.mode === 'LIST' && x.sender.objects.type === sender.type && x.sender.objects.ids.includes(sender.id));
  if (seg) {
    if (!receiversOf(seg).some((r) => r.type === receiver.type && r.id === receiver.id)) addReceiver(seg, receiver);
    return;
  }
  const created = newSegment(p.master, cycleMethod(c), sender, receiver);
  // 送信者のない空のセグメント（追加したばかりのサイクル）があれば、それを使う
  const empty = c.segments.findIndex((x) => x.sender.objects.mode === 'LIST' && x.sender.objects.ids.length === 0);
  if (empty >= 0) {
    const old = c.segments[empty]!;
    created.id = old.id;
    created.sender.accounts = old.sender.accounts.length ? old.sender.accounts : created.sender.accounts;
    if (old.allocAccount) created.allocAccount = old.allocAccount;
    if (c.type === 'DISTRIBUTION') delete created.allocAccount;
    c.segments[empty] = created;
    return;
  }
  created.id = nextId('SEG-', c.segments.map((x) => x.id));
  if (c.type === 'DISTRIBUTION') delete created.allocAccount;
  else if (!created.allocAccount) {
    const acc = firstAccount(p.master, 'SEC42');
    if (acc) created.allocAccount = acc;
  }
  c.segments.push(created);
}

/** 標準テンプレート（5.1）の中で、手法に合うステップ */
const TEMPLATE_STEP: Record<Method, string> = {
  ACTIVITY: 'ST-01',
  OVERHEAD_CALC: 'ST-02',
  SETTLEMENT: 'ST-07',
  DIST: 'ST-04',
  ASSESS: 'ST-05',
  MA: 'ST-08',
  TDD: 'ST-09',
};

function assignToStep(s: Scenario, rule: CreatedRule, method: Method, receiver: ObjRef, newStepName: string): void {
  const kind = STEP_KIND_OF[rule.kind];
  // 原価センタへの決済は配賦の前（決済①）、それ以外は後（決済②）に入れる（5.1）
  const preferred = method === 'SETTLEMENT' && receiver.type === 'CCTR' ? 'ST-03' : TEMPLATE_STEP[method];
  const step = s.steps.find((st) => st.id === preferred && st.kind === kind) ?? s.steps.find((st) => st.kind === kind);
  if (step) {
    step.itemIds.push(rule.id);
    return;
  }
  s.steps.push({ id: nextId('ST-', s.steps.map((x) => x.id)), name: newStepName, kind, itemIds: [rule.id], enabled: true });
}

/** 空のルールを作る（ルール一覧の「追加」）。ステップには入れない */
export function createBlankRule(p: Project, scenarioId: string, kind: RuleKind, name: string, opts: { context?: AllocationCycle['context'] } = {}): CreatedRule {
  const s = scenario(p, scenarioId);
  const m = p.master;
  const id = nextId(ID_PREFIX[kind], allRuleIds(s));
  const cctr = m.costCenters[0]?.id ?? '';
  switch (kind) {
    case 'CYCLE':
      const context = opts.context ?? 'CCTR';
      s.cycles.push({
        id,
        name,
        context,
        type: 'OVERHEAD',
        iterative: false,
        segments: [
          {
            id: 'SEG-01',
            name: '',
            sender: { objects: { type: context === 'PCTR' ? 'PCTR' : 'CCTR', mode: 'LIST', ids: [] }, accounts: accountRangeOf(m, COSTS), sharePct: 100 },
            receiver: { objects: { type: context === 'PCTR' ? 'PCTR' : context === 'MA' ? 'PSEG' : 'CCTR', mode: 'LIST', ids: [] }, factor: { kind: 'FIXED_PORTION', weights: [] } },
            ...(firstAccount(m, 'SEC42') ? { allocAccount: firstAccount(m, 'SEC42')! } : {}),
          },
        ],
      });
      break;
    case 'TDD':
      s.tddRules.push({
        id,
        name,
        sender: { segments: { type: 'PSEG', mode: 'LIST', ids: [] }, accounts: accountRangeOf(m, COSTS) },
        distributeChars: ['customer'],
        reference: { accounts: accountRangeOf(m, ['REVENUE']), source: 'CURRENT_PERIOD' },
      });
      break;
    case 'SETTLEMENT':
      s.settlementRules.push({ id, sender: { type: 'WBS', id: m.wbs[0]?.id ?? '' }, rules: [] });
      break;
    case 'ACTIVITY':
      s.activityAllocs.push({ id, senderCctr: cctr, activityType: m.activityTypes[0]?.id ?? '', receiver: { type: 'WBS', id: m.wbs[0]?.id ?? '' }, quantity: 0 });
      break;
    case 'COSTING':
      s.costingSheets.push({ id, rows: [{ base: accountRangeOf(m, PRIMARY), ratePct: 0, creditCctr: cctr, overheadAccount: firstAccount(m, 'SEC41') ?? '' }], targets: [] });
      break;
  }
  return { kind, id };
}

/** ルールを消し、ステップのジョブからも外す */
export function deleteRule(p: Project, scenarioId: string, kind: RuleKind, id: string): void {
  const s = scenario(p, scenarioId);
  const drop = <T extends { id: string }>(xs: T[]) => xs.filter((x) => x.id !== id);
  switch (kind) {
    case 'CYCLE':
      s.cycles = drop(s.cycles);
      break;
    case 'TDD':
      s.tddRules = drop(s.tddRules);
      break;
    case 'SETTLEMENT':
      s.settlementRules = drop(s.settlementRules);
      break;
    case 'ACTIVITY':
      s.activityAllocs = drop(s.activityAllocs);
      break;
    case 'COSTING':
      s.costingSheets = drop(s.costingSheets);
      break;
  }
  for (const st of s.steps) if (st.kind === STEP_KIND_OF[kind]) st.itemIds = st.itemIds.filter((x) => x !== id);
}

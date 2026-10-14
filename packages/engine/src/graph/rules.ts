/**
 * ルールの分類と、ルールから導く線（送信 → 受信）。フロー図（F7-01）とドラッグでのルール作成（6章）の土台。
 */
import type { ReadonlyBalanceIndex } from '../ledger/balance.ts';
import type { MasterIndex } from '../ledger/masterIndex.ts';
import { selectObjects } from '../ledger/select.ts';
import { tddReferenceWeights, tddSenders } from '../methods/tdd.ts';
import { objKey, parseObjKey } from '../model/keys.ts';
import type { AllocationCycle, ObjRef, ObjType, Scenario, StepKind } from '../model/types.ts';

/** 2章の7手法（線の色の単位） */
export type Method = 'DIST' | 'ASSESS' | 'MA' | 'TDD' | 'ACTIVITY' | 'OVERHEAD_CALC' | 'SETTLEMENT';
export const METHODS: readonly Method[] = ['ACTIVITY', 'OVERHEAD_CALC', 'SETTLEMENT', 'DIST', 'ASSESS', 'MA', 'TDD'];

/** ルールの入れ物（シナリオのどの一覧にあるか） */
export type RuleKind = 'CYCLE' | 'TDD' | 'SETTLEMENT' | 'ACTIVITY' | 'COSTING';
export const RULE_KINDS: readonly RuleKind[] = ['ACTIVITY', 'COSTING', 'SETTLEMENT', 'CYCLE', 'TDD'];

export const STEP_KIND_OF: Record<RuleKind, StepKind> = {
  CYCLE: 'ALLOC_CYCLE',
  TDD: 'TDD',
  SETTLEMENT: 'SETTLEMENT',
  ACTIVITY: 'ACTIVITY_ALLOC',
  COSTING: 'OVERHEAD_CALC',
};

export const cycleMethod = (c: AllocationCycle): Method => (c.context === 'MA' ? 'MA' : c.type === 'DISTRIBUTION' ? 'DIST' : 'ASSESS');

/** 送信 → 受信の組み合わせで選べる手法（6章「ノード間ドラッグで選べる手法」） */
export function methodsFor(sender: ObjType, receiver: ObjType): Method[] {
  if (sender === 'CCTR') {
    if (receiver === 'CCTR') return ['DIST', 'ASSESS', 'ACTIVITY'];
    if (receiver === 'WBS') return ['DIST', 'ASSESS', 'ACTIVITY', 'OVERHEAD_CALC'];
    if (receiver === 'PSEG') return ['MA'];
  }
  if (sender === 'WBS' && (receiver === 'CCTR' || receiver === 'WBS' || receiver === 'PSEG')) return ['SETTLEMENT'];
  if (sender === 'PSEG' && receiver === 'PSEG') return ['TDD'];
  return [];
}

export interface RuleInfo {
  kind: RuleKind;
  id: string;
  name: string;
  /** 線の色。サイクルはコンテキストとタイプで決まる */
  method: Method;
  /** このルールを実行するステップ（並び順） */
  stepIds: string[];
}

export function ruleCollection(s: Scenario, kind: RuleKind): readonly { id: string }[] {
  switch (kind) {
    case 'CYCLE':
      return s.cycles;
    case 'TDD':
      return s.tddRules;
    case 'SETTLEMENT':
      return s.settlementRules;
    case 'ACTIVITY':
      return s.activityAllocs;
    case 'COSTING':
      return s.costingSheets;
  }
}

export function stepsOfRule(s: Scenario, kind: RuleKind, id: string): string[] {
  return s.steps.filter((st) => st.kind === STEP_KIND_OF[kind] && st.itemIds.includes(id)).map((st) => st.id);
}

/** シナリオのルール一覧（表示名つき） */
export function describeRules(s: Scenario): RuleInfo[] {
  const info = (kind: RuleKind, id: string, name: string, method: Method): RuleInfo => ({ kind, id, name, method, stepIds: stepsOfRule(s, kind, id) });
  return [
    ...s.activityAllocs.map((a) => info('ACTIVITY', a.id, `${a.senderCctr} → ${a.receiver.id}（${a.activityType} ${a.quantity}）`, 'ACTIVITY')),
    ...s.costingSheets.map((c) => info('COSTING', c.id, `${[...new Set(c.rows.map((r) => r.creditCctr))].join('・')} → ${c.targets.map((t) => t.id).join('・')}`, 'OVERHEAD_CALC')),
    ...s.settlementRules.map((r) => info('SETTLEMENT', r.id, `${r.sender.id} → ${r.rules.map((d) => d.receiver.id).join('・')}`, 'SETTLEMENT')),
    ...s.cycles.map((c) => info('CYCLE', c.id, c.name, cycleMethod(c))),
    ...s.tddRules.map((r) => info('TDD', r.id, r.name, 'TDD')),
  ];
}

export interface StructuralEdge {
  kind: RuleKind;
  ruleId: string;
  method: Method;
  sender: ObjRef;
  receiver: ObjRef;
}

/**
 * ルールの定義から線を導く（同じルール・同じ送信と受信の組は1本）。
 * TDD の受信者は参照データで決まるので、balances（ふつうは締め後の残高）から求める。
 */
export function structuralEdges(s: Scenario, mi: MasterIndex, balances?: ReadonlyBalanceIndex): StructuralEdge[] {
  const out = new Map<string, StructuralEdge>();
  const add = (kind: RuleKind, ruleId: string, method: Method, sender: ObjRef, receiver: ObjRef) => {
    if (sender.type === receiver.type && sender.id === receiver.id) return;
    const key = `${ruleId}|${objKey(sender)}|${objKey(receiver)}`;
    if (!out.has(key)) out.set(key, { kind, ruleId, method, sender, receiver });
  };
  for (const c of s.cycles) {
    const method = cycleMethod(c);
    for (const seg of c.segments) {
      const senders = selectObjects(seg.sender.objects, mi, balances);
      const f = seg.receiver.factor;
      const receivers = f.kind === 'FIXED_PERCENT' || f.kind === 'FIXED_PORTION' ? f.weights.map((w) => w.obj) : selectObjects(seg.receiver.objects, mi, balances);
      for (const a of senders) for (const b of receivers) add('CYCLE', c.id, method, a, b);
    }
  }
  for (const r of s.tddRules) {
    for (const sender of tddSenders(r, mi, balances)) {
      if (!balances) continue;
      for (const rk of tddReferenceWeights(r, sender.id, balances).keys()) add('TDD', r.id, 'TDD', sender, parseObjKey(rk));
    }
  }
  for (const r of s.settlementRules) for (const d of r.rules) add('SETTLEMENT', r.id, 'SETTLEMENT', r.sender, d.receiver);
  for (const a of s.activityAllocs) add('ACTIVITY', a.id, 'ACTIVITY', { type: 'CCTR', id: a.senderCctr }, a.receiver);
  for (const cs of s.costingSheets) for (const row of cs.rows) for (const t of cs.targets) add('COSTING', cs.id, 'OVERHEAD_CALC', { type: 'CCTR', id: row.creditCctr }, t);
  return [...out.values()];
}

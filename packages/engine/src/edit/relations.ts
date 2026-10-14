/**
 * 手法別ビューの線（関係）の値を直す・関係を外す。関数は渡されたプロジェクトをその場で書き換える。
 */
import type { RuleKind } from '../graph/rules.ts';
import { parseObjKey, sameObj } from '../model/keys.ts';
import type { Project, Scenario } from '../model/types.ts';
import { deleteRule } from './rules.ts';

/** 線の識別（MethodViewEdge の ruleKind・ruleId・rowId・source・target） */
export interface RelationRef {
  ruleKind: RuleKind;
  ruleId: string;
  rowId?: string;
  source: string;
  target: string;
}

const scenarioOf = (p: Project, id: string): Scenario => {
  const s = p.scenarios.find((x) => x.id === id);
  if (!s) throw new Error(`scenario not found: ${id}`);
  return s;
};

/** 活動配分の送信側キー（CCTR:3000#ENG）から対象のキーを取り出す */
const objPart = (key: string) => key.split('#')[0]!;

/** 線の定義値を直す（固定%・固定比率、分配規則の値、活動の数量、間接費の率） */
export function setRelationValue(p: Project, scenarioId: string, ref: RelationRef, value: number): void {
  const s = scenarioOf(p, scenarioId);
  const target = parseObjKey(ref.target);
  switch (ref.ruleKind) {
    case 'CYCLE': {
      const f = s.cycles.find((c) => c.id === ref.ruleId)?.segments.find((x) => x.id === ref.rowId)?.receiver.factor;
      if (f?.kind === 'FIXED_PERCENT') for (const w of f.weights) if (sameObj(w.obj, target)) w.pct = value;
      if (f?.kind === 'FIXED_PORTION') for (const w of f.weights) if (sameObj(w.obj, target)) w.portion = value;
      return;
    }
    case 'SETTLEMENT': {
      const d = s.settlementRules.find((r) => r.id === ref.ruleId)?.rules[Number(ref.rowId)];
      if (d) d.value = value;
      return;
    }
    case 'ACTIVITY': {
      const a = s.activityAllocs.find((x) => x.id === ref.ruleId);
      if (a) a.quantity = value;
      return;
    }
    case 'COSTING': {
      const row = s.costingSheets.find((c) => c.id === ref.ruleId)?.rows[Number(ref.rowId)];
      if (row) row.ratePct = value;
      return;
    }
    case 'TDD':
      return;
  }
}

/** 関係を外す（受信者を外す、分配規則の行を消す、活動配分を消す、間接費の対象を外す、TDD の送信者を外す） */
export function removeRelation(p: Project, scenarioId: string, ref: RelationRef): void {
  const s = scenarioOf(p, scenarioId);
  const target = parseObjKey(ref.target);
  switch (ref.ruleKind) {
    case 'CYCLE': {
      const seg = s.cycles.find((c) => c.id === ref.ruleId)?.segments.find((x) => x.id === ref.rowId);
      if (!seg) return;
      const f = seg.receiver.factor;
      if (f.kind === 'FIXED_PERCENT') f.weights = f.weights.filter((w) => !sameObj(w.obj, target));
      if (f.kind === 'FIXED_PORTION') f.weights = f.weights.filter((w) => !sameObj(w.obj, target));
      const r = seg.receiver.objects;
      if (r.mode === 'LIST' && r.type === target.type) r.ids = r.ids.filter((id) => id !== target.id);
      return;
    }
    case 'SETTLEMENT': {
      const r = s.settlementRules.find((x) => x.id === ref.ruleId);
      if (r) r.rules.splice(Number(ref.rowId), 1);
      return;
    }
    case 'ACTIVITY':
      deleteRule(p, scenarioId, 'ACTIVITY', ref.ruleId);
      return;
    case 'COSTING': {
      const cs = s.costingSheets.find((x) => x.id === ref.ruleId);
      if (cs) cs.targets = cs.targets.filter((t) => !sameObj(t, target));
      return;
    }
    case 'TDD': {
      const sel = s.tddRules.find((x) => x.id === ref.ruleId)?.sender.segments;
      const sender = parseObjKey(objPart(ref.source));
      if (sel?.mode === 'LIST') sel.ids = sel.ids.filter((id) => id !== sender.id);
      return;
    }
  }
}

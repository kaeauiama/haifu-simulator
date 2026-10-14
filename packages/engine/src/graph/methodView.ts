/**
 * 手法ごとの関係ビュー。送信側（左）と受信側（右）の2列に対象を並べ、ルールの定義を線で表す。
 * 線には定義値（%、比率、統計KFの値、数量、率、参照額）と構成比、選んだ時点までに流れた額を持たせる。
 */
import type { ReadonlyBalanceIndex } from '../ledger/balance.ts';
import type { MasterIndex } from '../ledger/masterIndex.ts';
import { normalizeWeights } from '../ledger/rounding.ts';
import { accountPred, profitCenterKeys, selectObjects } from '../ledger/select.ts';
import { tddReferenceWeights, tddSenders } from '../methods/tdd.ts';
import { compareObj, objKey, parseObjKey } from '../model/keys.ts';
import type { AllocationCycle, ObjRef, ObjType, Scenario, Yen } from '../model/types.ts';
import { cycleMethod, type Method, type RuleKind } from './rules.ts';

/** ビューの種類（原価センタと利益センタの配賦は分ける） */
export type ViewMethod = 'CCTR_ALLOC' | 'PCTR_ALLOC' | 'MA' | 'SETTLEMENT' | 'ACTIVITY' | 'OVERHEAD_CALC' | 'TDD';
export const VIEW_METHODS: readonly ViewMethod[] = ['CCTR_ALLOC', 'PCTR_ALLOC', 'MA', 'SETTLEMENT', 'ACTIVITY', 'OVERHEAD_CALC', 'TDD'];

const CYCLE_CONTEXT: Partial<Record<ViewMethod, AllocationCycle['context']>> = { CCTR_ALLOC: 'CCTR', PCTR_ALLOC: 'PCTR', MA: 'MA' };

/** 線の定義値の種類 */
export type WeightBasis = 'PERCENT' | 'PORTION' | 'SKF' | 'VARIABLE' | 'PCT' | 'EQUIV' | 'AMOUNT' | 'QUANTITY' | 'RATE' | 'REFERENCE';

export interface MethodViewNode {
  key: string;
  type: ObjType;
  id: string;
  name: string;
  label: string;
  side: 'L' | 'R';
  /** 選んだ時点の残高（利益センタは導出される全対象の合計） */
  balance: Yen;
  /** 活動配分の送信側は「原価センタ × 活動タイプ」 */
  activityType?: string;
  planRate?: Yen;
  unit?: string;
}

export interface MethodViewEdge {
  id: string;
  ruleKind: RuleKind;
  ruleId: string;
  /** サイクルのセグメント、分配規則の行番号、原価計算シートの行番号 */
  rowId?: string;
  source: string;
  target: string;
  method: Method;
  basis: WeightBasis;
  value: number;
  /** 送信額に対する割合（決まらないときは null） */
  share: number | null;
  /** 線の上で値を直せるか（統計KF・実績値・参照額は、マスタや実績で決まるので直せない） */
  editable: boolean;
  removable: boolean;
  amount: Yen;
  state: 'done' | 'pending' | 'disabled' | 'unassigned';
  severity: 'ERROR' | 'WARNING' | null;
}

export interface MethodView {
  method: ViewMethod;
  rules: { kind: RuleKind; id: string; name: string }[];
  /** サイクルのビューで表示しているサイクル */
  focusRuleId: string | null;
  segments: { id: string; name: string }[];
  left: MethodViewNode[];
  right: MethodViewNode[];
  edges: MethodViewEdge[];
}

export interface MethodViewDeps {
  scenario: Scenario;
  mi: MasterIndex;
  /** 選んだ時点の残高 */
  cursor: ReadonlyBalanceIndex;
  /** ルールを実行するステップの開始時点の残高（配分基準の実績値や TDD の参照データを読む） */
  refSnapshot(ruleId: string): ReadonlyBalanceIndex;
  snapshot(stepId: string): ReadonlyBalanceIndex | undefined;
  /** 選んだ時点までに流れた額（ruleId|送信キー|受信キー） */
  amount(ruleId: string, sender: string, receiver: string): Yen;
  state(ruleId: string): MethodViewEdge['state'];
  severity(ruleId: string): MethodViewEdge['severity'];
}

export function buildMethodView(method: ViewMethod, focus: string | null, d: MethodViewDeps): MethodView {
  const { scenario: s, mi } = d;
  const pcKeys = profitCenterKeys(d.cursor, mi);
  const balanceOf = (o: ObjRef) => (o.type === 'PCTR' ? (pcKeys.get(o.id) ?? []).reduce((t, k) => t + d.cursor.total(k), 0) : d.cursor.total(objKey(o)));
  const node = (o: ObjRef, side: 'L' | 'R'): MethodViewNode => ({ key: objKey(o), type: o.type, id: o.id, name: mi.name(o), label: mi.label(o), side, balance: balanceOf(o) });
  const all = (type: ObjType): ObjRef[] => {
    switch (type) {
      case 'CCTR':
        return [...mi.costCenters.keys()].map((id) => ({ type, id }));
      case 'WBS':
        return [...mi.wbs.values()].filter((w) => !w.statistical).map((w) => ({ type, id: w.id }));
      case 'PCTR':
        return [...mi.profitCenters.keys()].map((id) => ({ type, id }));
      case 'PSEG': {
        const ids = new Set(mi.segments.keys());
        for (const k of d.cursor.objectKeys()) if (k.startsWith('PSEG:')) ids.add(parseObjKey(k).id);
        return [...ids].map((id) => ({ type, id }));
      }
      case 'ORD':
        return [];
    }
  };
  const sides = (l: ObjType[], r: ObjType[]) => ({
    left: l.flatMap(all).sort(compareObj).map((o) => node(o, 'L')),
    right: r.flatMap(all).sort(compareObj).map((o) => node(o, 'R')),
  });
  const base = (ruleId: string) => ({ ruleId, amount: 0, state: d.state(ruleId), severity: d.severity(ruleId) });

  const context = CYCLE_CONTEXT[method];
  if (context) {
    const cycles = s.cycles.filter((c) => c.context === context);
    const cycle = cycles.find((c) => c.id === focus) ?? cycles[0] ?? null;
    const { left, right } = context === 'PCTR' ? sides(['PCTR'], ['PCTR']) : context === 'MA' ? sides(['CCTR'], ['PSEG']) : sides(['CCTR'], ['CCTR', 'WBS']);
    const edges: MethodViewEdge[] = [];
    if (cycle) {
      const ref = d.refSnapshot(cycle.id);
      const m = cycleMethod(cycle);
      for (const seg of cycle.segments) {
        const senders = selectObjects(seg.sender.objects, mi, ref);
        const f = seg.receiver.factor;
        let rows: { obj: ObjRef; value: number; share: number | null }[] = [];
        let basis: WeightBasis;
        if (f.kind === 'FIXED_PERCENT') {
          basis = 'PERCENT';
          rows = f.weights.map((w) => ({ obj: w.obj, value: w.pct, share: w.pct / 100 }));
        } else if (f.kind === 'FIXED_PORTION') {
          basis = 'PORTION';
          const sum = f.weights.reduce((t, w) => t + w.portion, 0);
          rows = f.weights.map((w) => ({ obj: w.obj, value: w.portion, share: sum > 0 ? w.portion / sum : null }));
        } else {
          basis = f.kind === 'SKF' ? 'SKF' : 'VARIABLE';
          const receivers = selectObjects(seg.receiver.objects, mi, ref);
          let values: number[];
          if (f.kind === 'SKF') {
            const vals = new Map<string, number>();
            for (const v of mi.skfs.get(f.skfId)?.values ?? []) vals.set(objKey(v.obj), (vals.get(objKey(v.obj)) ?? 0) + v.value);
            values = receivers.map((r) => vals.get(objKey(r)) ?? 0);
          } else {
            const snap = (f.asOfStep && d.snapshot(f.asOfStep)) || ref;
            const pred = accountPred(f.accounts);
            const byPc = profitCenterKeys(snap, mi);
            values = receivers.map((r) => (r.type === 'PCTR' ? (byPc.get(r.id) ?? []).reduce((t, k) => t + snap.total(k, pred), 0) : snap.total(objKey(r), pred)));
          }
          const norm = normalizeWeights(receivers.map((r, i) => ({ key: objKey(r), weight: values[i]! })));
          const shareOf = new Map(norm ? norm.shares.map((x) => [x.key, x.weight]) : []);
          const total = norm ? norm.shares.reduce((t, x) => t + x.weight, 0) : 0;
          rows = receivers.map((r, i) => ({ obj: r, value: values[i]!, share: total ? (shareOf.get(objKey(r)) ?? 0) / total : null }));
        }
        const fixed = basis === 'PERCENT' || basis === 'PORTION';
        const removable = fixed || seg.receiver.objects.mode === 'LIST';
        for (const sd of senders) {
          for (const row of rows) {
            const sk = objKey(sd);
            const rk = objKey(row.obj);
            if (sk === rk) continue;
            edges.push({
              ...base(cycle.id),
              id: `${cycle.id}|${seg.id}|${sk}|${rk}`,
              ruleKind: 'CYCLE',
              rowId: seg.id,
              source: sk,
              target: rk,
              method: m,
              basis,
              value: row.value,
              share: row.share,
              editable: fixed,
              removable,
              amount: d.amount(cycle.id, sk, rk),
            });
          }
        }
      }
    }
    return {
      method,
      rules: cycles.map((c) => ({ kind: 'CYCLE', id: c.id, name: c.name })),
      focusRuleId: cycle?.id ?? null,
      segments: cycle ? cycle.segments.map((x) => ({ id: x.id, name: x.name })) : [],
      left,
      right,
      edges,
    };
  }

  const edges: MethodViewEdge[] = [];
  switch (method) {
    case 'SETTLEMENT': {
      for (const r of s.settlementRules) {
        const sk = objKey(r.sender);
        r.rules.forEach((dr, i) => {
          const rk = objKey(dr.receiver);
          edges.push({
            ...base(r.id),
            id: `${r.id}|${i}|${sk}|${rk}`,
            ruleKind: 'SETTLEMENT',
            rowId: String(i),
            source: sk,
            target: rk,
            method: 'SETTLEMENT',
            basis: dr.basis,
            value: dr.value,
            share: dr.basis === 'PCT' ? dr.value / 100 : null,
            editable: true,
            removable: true,
            amount: d.amount(r.id, sk, rk),
          });
        });
      }
      return { method, rules: s.settlementRules.map((r) => ({ kind: 'SETTLEMENT', id: r.id, name: r.sender.id })), focusRuleId: null, segments: [], ...sides(['WBS'], ['CCTR', 'WBS', 'PSEG']), edges };
    }
    case 'ACTIVITY': {
      // 送信側は「原価センタ × 活動タイプ」。計画レートのある組と、活動配分で使っている組を出す
      const pairs = new Map<string, { cctr: string; type: string }>();
      for (const at of mi.master.activityTypes) for (const r of at.rates) pairs.set(`${r.cctr}#${at.id}`, { cctr: r.cctr, type: at.id });
      for (const a of s.activityAllocs) pairs.set(`${a.senderCctr}#${a.activityType}`, { cctr: a.senderCctr, type: a.activityType });
      const left = [...pairs.values()]
        .sort((a, b) => compareObj({ type: 'CCTR', id: a.cctr }, { type: 'CCTR', id: b.cctr }) || (a.type < b.type ? -1 : 1))
        .map(({ cctr, type }) => {
          const at = mi.activityTypes.get(type);
          const n = node({ type: 'CCTR', id: cctr }, 'L');
          const out: MethodViewNode = { ...n, key: `${n.key}#${type}`, activityType: type };
          const rate = at?.rates.find((r) => r.cctr === cctr)?.planRate;
          if (rate !== undefined) out.planRate = rate;
          if (at) out.unit = at.unit;
          return out;
        });
      for (const a of s.activityAllocs) {
        const sk = `CCTR:${a.senderCctr}#${a.activityType}`;
        const rk = objKey(a.receiver);
        edges.push({
          ...base(a.id),
          id: `${a.id}|${sk}|${rk}`,
          ruleKind: 'ACTIVITY',
          rowId: a.id,
          source: sk,
          target: rk,
          method: 'ACTIVITY',
          basis: 'QUANTITY',
          value: a.quantity,
          share: null,
          editable: true,
          removable: true,
          amount: d.amount(a.id, `CCTR:${a.senderCctr}`, rk),
        });
      }
      return { method, rules: s.activityAllocs.map((a) => ({ kind: 'ACTIVITY', id: a.id, name: a.id })), focusRuleId: null, segments: [], left, right: sides([], ['CCTR', 'WBS']).right, edges };
    }
    case 'OVERHEAD_CALC': {
      for (const cs of s.costingSheets) {
        cs.rows.forEach((row, i) => {
          const sk = `CCTR:${row.creditCctr}`;
          for (const t of cs.targets) {
            const rk = objKey(t);
            edges.push({
              ...base(cs.id),
              id: `${cs.id}|${i}|${sk}|${rk}`,
              ruleKind: 'COSTING',
              rowId: String(i),
              source: sk,
              target: rk,
              method: 'OVERHEAD_CALC',
              basis: 'RATE',
              value: row.ratePct,
              share: null,
              editable: true,
              removable: true,
              amount: d.amount(cs.id, sk, rk),
            });
          }
        });
      }
      return { method, rules: s.costingSheets.map((c) => ({ kind: 'COSTING', id: c.id, name: c.id })), focusRuleId: null, segments: [], ...sides(['CCTR'], ['WBS']), edges };
    }
    case 'TDD': {
      for (const r of s.tddRules) {
        const ref = d.refSnapshot(r.id);
        for (const sender of tddSenders(r, mi, ref)) {
          const weights = tddReferenceWeights(r, sender.id, ref);
          const norm = normalizeWeights([...weights].map(([key, weight]) => ({ key, weight })));
          const total = norm ? norm.shares.reduce((t, x) => t + x.weight, 0) : 0;
          const shareOf = new Map(norm ? norm.shares.map((x) => [x.key, x.weight]) : []);
          const sk = objKey(sender);
          for (const [rk, value] of weights) {
            edges.push({
              ...base(r.id),
              id: `${r.id}|${sk}|${rk}`,
              ruleKind: 'TDD',
              source: sk,
              target: rk,
              method: 'TDD',
              basis: 'REFERENCE',
              value,
              share: total ? (shareOf.get(rk) ?? 0) / total : null,
              editable: false,
              removable: r.sender.segments.mode === 'LIST',
              amount: d.amount(r.id, sk, rk),
            });
          }
        }
      }
      return { method, rules: s.tddRules.map((r) => ({ kind: 'TDD', id: r.id, name: r.name })), focusRuleId: null, segments: [], ...sides(['PSEG'], ['PSEG']), edges };
    }
    default:
      throw new Error(`unknown view method: ${method}`);
  }
}

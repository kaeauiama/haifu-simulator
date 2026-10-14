/**
 * シナリオ差分（F8-02）と、順序を変えたことで結果が変わったステップ（F4-04）。
 */
import type { ReadonlyBalanceIndex } from '../ledger/balance.ts';
import type { MasterIndex } from '../ledger/masterIndex.ts';
import { compareShareKey } from '../ledger/rounding.ts';
import { objKey } from '../model/keys.ts';
import type { Yen } from '../model/types.ts';
import { totalsByObject, totalsByProfitCenter, totalsBySegment, totalsBySegmentAccount } from '../report/totals.ts';
import type { RunResult } from '../run.ts';

export interface DiffRow {
  key: string;
  a: Yen;
  b: Yen;
  diff: Yen;
}

export function diffMaps(a: ReadonlyMap<string, Yen>, b: ReadonlyMap<string, Yen>): DiffRow[] {
  const keys = new Set([...a.keys(), ...b.keys()]);
  return [...keys]
    .sort(compareShareKey)
    .map((key) => {
      const x = a.get(key) ?? 0;
      const y = b.get(key) ?? 0;
      return { key, a: x, b: y, diff: y - x };
    })
    .filter((r) => r.a !== 0 || r.b !== 0);
}

export interface ScenarioComparison {
  byProfitCenter: DiffRow[];
  bySegment: DiffRow[];
  /** マージン分析上の勘定別（P-22） */
  byAccount: DiffRow[];
  byObject: DiffRow[];
  /** 両方にあるステップのうち、そのステップで作った仕訳（対象×勘定の純額）が違うもの */
  changedSteps: string[];
}

const finalOf = (r: RunResult): ReadonlyBalanceIndex => r.snapshots.get(r.stepOrder[r.stepOrder.length - 1]!)!;

export function compareRuns(a: RunResult, b: RunResult, mi: MasterIndex): ScenarioComparison {
  const fa = finalOf(a);
  const fb = finalOf(b);
  return {
    byProfitCenter: diffMaps(totalsByProfitCenter(fa, mi), totalsByProfitCenter(fb, mi)),
    bySegment: diffMaps(totalsBySegment(fa, mi), totalsBySegment(fb, mi)),
    byAccount: diffMaps(totalsBySegmentAccount(fa, mi), totalsBySegmentAccount(fb, mi)),
    byObject: diffMaps(totalsByObject(fa), totalsByObject(fb)),
    changedSteps: changedSteps(a, b),
  };
}

/** ステップ ID で突き合わせ、そのステップの仕訳（対象×勘定の純額）が違うステップを返す（a の並び） */
export function changedSteps(a: RunResult, b: RunResult): string[] {
  const net = (r: RunResult) => {
    const m = new Map<string, Map<string, Yen>>();
    for (const l of r.ledger) {
      if (l.role === 'PRIMARY') continue;
      let s = m.get(l.stepId);
      if (!s) m.set(l.stepId, (s = new Map()));
      const k = `${objKey(l.obj)}\u0000${l.account}`;
      s.set(k, (s.get(k) ?? 0) + l.amount);
    }
    return m;
  };
  const na = net(a);
  const nb = net(b);
  const inB = new Set(b.stepOrder);
  return a.stepOrder.filter((id) => {
    if (!inB.has(id)) return false;
    const x = na.get(id) ?? new Map<string, Yen>();
    const y = nb.get(id) ?? new Map<string, Yen>();
    return diffMaps(x, y).some((r) => r.diff !== 0);
  });
}

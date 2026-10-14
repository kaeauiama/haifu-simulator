/**
 * サンキー図の材料（F7-02）。送信 → 受信の流れを、選んだステップの範囲で集計する。
 * サンキー図は循環を描けないので、相互の流れ（反復配賦など）は差し引きし、残った循環は小さい流れから外す。
 */
import type { MasterIndex } from '../ledger/masterIndex.ts';
import { compareShareKey } from '../ledger/rounding.ts';
import { objKey, parseObjKey } from '../model/keys.ts';
import type { Ledger, ObjTier, ObjType, Scenario, Yen } from '../model/types.ts';
import { DISPLAY_LIMITS } from './limits.ts';
import { describeRules, type Method } from './rules.ts';

export interface SankeyNode {
  key: string;
  type: ObjType;
  tier: ObjTier;
  label: string;
}

export interface SankeyLink {
  source: string;
  target: string;
  /** 差し引き後の額（正） */
  value: Yen;
  /** 額が最も大きい手法（線の色） */
  method: Method;
}

export interface SankeyData {
  nodes: SankeyNode[];
  links: SankeyLink[];
  /** 循環を断つために外した流れの数 */
  omitted: number;
  /** 差し引き後の流れの本数（上限を超えたときは links より多い） */
  total: number;
}

export function buildSankey(ledger: Ledger, scenario: Scenario, mi: MasterIndex, stepIds: ReadonlySet<string>): SankeyData {
  const methodOf = new Map(describeRules(scenario).map((r) => [r.id, r.method]));
  // 送信→受信の額（向きのある組ごと）と、手法ごとの内訳
  const flow = new Map<string, { value: number; byMethod: Map<Method, number> }>();
  for (const l of ledger) {
    if (l.role !== 'RECEIVER' || !l.partner || !stepIds.has(l.stepId) || l.amount === 0) continue;
    const m = methodOf.get(l.origin.ruleId);
    if (!m) continue;
    // マイナスの流れは、向きを逆にして正の流れとして扱う
    const [from, to] = l.amount > 0 ? [objKey(l.partner), objKey(l.obj)] : [objKey(l.obj), objKey(l.partner)];
    if (from === to) continue;
    const k = `${from}>${to}`;
    const f = flow.get(k) ?? { value: 0, byMethod: new Map<Method, number>() };
    f.value += Math.abs(l.amount);
    f.byMethod.set(m, (f.byMethod.get(m) ?? 0) + Math.abs(l.amount));
    flow.set(k, f);
  }

  // 相互の流れを差し引く
  const links: SankeyLink[] = [];
  const done = new Set<string>();
  for (const [k, f] of flow) {
    if (done.has(k)) continue;
    const [from, to] = k.split('>') as [string, string];
    const back = flow.get(`${to}>${from}`);
    done.add(k).add(`${to}>${from}`);
    const net = f.value - (back?.value ?? 0);
    if (net === 0) continue;
    const winner = net > 0 ? f : back!;
    const method = [...winner.byMethod].sort((a, b) => b[1] - a[1])[0]![0];
    links.push(net > 0 ? { source: from, target: to, value: net, method } : { source: to, target: from, value: -net, method });
  }

  // 残った循環を断つ。大きい流れから深さ優先でたどり、戻る向きの流れ（後退辺）を外す
  links.sort((a, b) => b.value - a.value || compareShareKey(a.source, b.source) || compareShareKey(a.target, b.target));
  const total = links.length;
  links.splice(DISPLAY_LIMITS.sankeyLinks);
  const out = new Map<string, SankeyLink[]>();
  for (const l of links) out.set(l.source, [...(out.get(l.source) ?? []), l]);
  const state = new Map<string, 1 | 2>();
  const dropped = new Set<SankeyLink>();
  const visit = (v: string) => {
    state.set(v, 1);
    for (const l of out.get(v) ?? []) {
      const s = state.get(l.target);
      if (s === 1) dropped.add(l);
      else if (s === undefined) visit(l.target);
    }
    state.set(v, 2);
  };
  const roots = [...new Set(links.map((l) => l.source))];
  for (const r of roots) if (!state.has(r)) visit(r);
  const kept = links.filter((l) => !dropped.has(l));

  const keys = new Set(kept.flatMap((l) => [l.source, l.target]));
  const nodes = [...keys].sort(compareShareKey).map((key) => {
    const o = parseObjKey(key);
    return { key, type: o.type, tier: mi.tierOf(o), label: o.type === 'PSEG' ? mi.name(o) : `${o.id} ${mi.name(o)}`.trim() };
  });
  return { nodes, links: kept, omitted: dropped.size, total };
}

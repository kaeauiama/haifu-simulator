/**
 * 金額の構成（D-046、D-048）。ある時点で各対象に溜まっている残高を、どこから来たかで分ける。
 * - SOURCE（直前にどこから来たか）：直課、売上、受け取った額（送り手ごと）、配った額
 * - ORIGIN（最初にどこで計上されたか）：来歴をたどり、元の一次仕訳の対象ごと（自分の一次仕訳は直課か売上）
 * 収益勘定の額は、費用と分けて「売上」にまとめる（自分で計上した売上も、TDD などで受け取った売上も）。
 */
import { MasterIndex } from '../ledger/masterIndex.ts';
import type { LineageTracer } from '../lineage/lineage.ts';
import { UNATTRIBUTED } from '../lineage/lineage.ts';
import type { ReadonlyBalanceIndex } from '../ledger/balance.ts';
import { compareObj, objKey, parseObjKey } from '../model/keys.ts';
import { TIER_ORDER, type JournalLine, type Ledger, type ObjTier, type ObjType, type Yen } from '../model/types.ts';

export type CompositionMode = 'SOURCE' | 'ORIGIN';

/** 部分の種類：直課（費用）、売上、配った額、遡れない額、または送り手（発生元）の役割 */
export type PartKind = 'DIRECT' | 'REVENUE' | 'SENT' | 'NONE' | ObjTier;

export interface CompositionPart {
  /** 'DIRECT'・'REVENUE'・'SENT'・'NONE'、送り手（発生元）の対象キー、またはその前に REVENUE_FROM を付けたもの（受け取った売上） */
  key: string;
  kind: PartKind;
  /** 送り手（発生元）の表示名。直課などは空 */
  label: string;
  amount: Yen;
}

export interface CompositionRow {
  key: string;
  type: ObjType;
  id: string;
  name: string;
  label: string;
  tier: ObjTier;
  balance: Yen;
  parts: CompositionPart[];
}

export interface CompositionView {
  stepId: string;
  mode: CompositionMode;
  rows: CompositionRow[];
}

/**
 * 積み上げの順。直課 → 送り手の役割（お金が流れる順）→ 売上 → 利益センタ → 遡れない額 → 配った額。
 * 画面の色はこの順に参照パレットの順番どおり割り当てる（隣り合う色の見分けやすさを検査済み）
 */
export const PART_ORDER: readonly PartKind[] = ['DIRECT', 'CORPORATE', 'SUPPORT', 'OPERATING', 'PROJECT', 'GOAL', 'REVENUE', 'PC', 'NONE', 'SENT'];

/** 受け取った売上の部分キーの頭（REVENUE_FROM + 送り手の対象キー） */
export const REVENUE_FROM = 'REVENUE>';

/** 発生元の来歴の集計キー。一次仕訳の対象ごと、収益勘定は REVENUE_FROM を付けて費用と分ける */
export const originKeyOf =
  (mi: MasterIndex) =>
  (l: JournalLine): string =>
    (mi.category(l.account) === 'REVENUE' ? REVENUE_FROM : '') + objKey(l.obj);

export interface CompositionDeps {
  ledger: Ledger;
  mi: MasterIndex;
  /** 選んだ時点までのステップ（一次仕訳を含む） */
  steps: ReadonlySet<string>;
  /** 選んだ時点の残高 */
  cursor: ReadonlyBalanceIndex;
  /** 一次仕訳を発生元の対象キーで集計する来歴（originKeyOf） */
  originTracer: () => LineageTracer;
}

export function buildComposition(mode: CompositionMode, d: CompositionDeps): Omit<CompositionView, 'stepId'> {
  const { mi } = d;
  const byObj = new Map<string, Map<string, number>>();
  const add = (obj: string, part: string, v: number) => {
    let m = byObj.get(obj);
    if (!m) byObj.set(obj, (m = new Map()));
    m.set(part, (m.get(part) ?? 0) + v);
  };

  if (mode === 'SOURCE') {
    for (const l of d.ledger) {
      if (!d.steps.has(l.stepId) || l.amount === 0) continue;
      const k = objKey(l.obj);
      const revenue = mi.category(l.account) === 'REVENUE';
      if (l.role === 'PRIMARY') add(k, revenue ? 'REVENUE' : 'DIRECT', l.amount);
      else if (l.role === 'RECEIVER' && l.partner) add(k, (revenue ? REVENUE_FROM : '') + objKey(l.partner), l.amount);
      else add(k, 'SENT', l.amount);
    }
  } else {
    const tracer = d.originTracer();
    for (const k of d.cursor.objectKeys()) {
      const balance = d.cursor.total(k);
      if (balance === 0) continue;
      const obj = parseObjKey(k);
      const vec = tracer.balance(obj, { upToSteps: d.steps });
      const parts = new Map<string, number>();
      for (const [origin, v] of vec) {
        const part = origin === UNATTRIBUTED ? 'NONE' : origin === k ? 'DIRECT' : origin === REVENUE_FROM + k ? 'REVENUE' : origin;
        parts.set(part, (parts.get(part) ?? 0) + v);
      }
      // 円に丸め、ずれは絶対値の最も大きい部分で吸収して、合計を残高に合わせる
      let sum = 0;
      for (const [part, v] of parts) {
        const r = Math.round(v);
        parts.set(part, r);
        sum += r;
      }
      if (sum !== balance && parts.size) {
        const [big] = [...parts].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0]!;
        parts.set(big, parts.get(big)! + balance - sum);
      }
      for (const [part, v] of parts) if (v !== 0) add(k, part, v);
    }
  }

  const kindOf = (part: string): PartKind =>
    part === 'DIRECT' || part === 'REVENUE' || part === 'SENT' || part === 'NONE' ? part : part.startsWith(REVENUE_FROM) ? 'REVENUE' : mi.tierOf(parseObjKey(part));
  const rows: CompositionRow[] = [];
  for (const [k, m] of byObj) {
    const parts: CompositionPart[] = [...m]
      .filter(([, v]) => v !== 0)
      .map(([part, amount]) => ({ key: part, kind: kindOf(part), label: part.includes(':') ? labelOf(mi, part.replace(REVENUE_FROM, '')) : '', amount }));
    if (!parts.length) continue;
    parts.sort((a, b) => PART_ORDER.indexOf(a.kind) - PART_ORDER.indexOf(b.kind) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const obj = parseObjKey(k);
    rows.push({
      key: k,
      type: obj.type,
      id: obj.id,
      name: mi.name(obj),
      label: labelOf(mi, k),
      tier: mi.tierOf(obj),
      balance: parts.reduce((t, p) => t + p.amount, 0),
      parts,
    });
  }
  rows.sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) || compareObj(a, b));
  return { mode, rows };
}

function labelOf(mi: MasterIndex, key: string): string {
  const o = parseObjKey(key);
  return o.type === 'PSEG' ? mi.name(o) : `${o.id} ${mi.name(o)}`.trim();
}

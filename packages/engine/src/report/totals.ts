/**
 * 残高の集計。画面は金額を計算しないので、表示に要る集計はすべてここで作る。
 */
import type { ReadonlyBalanceIndex } from '../ledger/balance.ts';
import type { MasterIndex } from '../ledger/masterIndex.ts';
import { compareId, compareObj, objKey, parseObjKey } from '../model/keys.ts';
import type { Ledger, ObjRef, Yen } from '../model/types.ts';
import type { RunResult } from '../run.ts';

const addTo = (m: Map<string, Yen>, k: string, v: Yen) => m.set(k, (m.get(k) ?? 0) + v);

/** 対象別の残高合計（全勘定） */
export function totalsByObject(bal: ReadonlyBalanceIndex): Map<string, Yen> {
  const m = new Map<string, Yen>();
  for (const k of bal.objectKeys()) m.set(k, bal.total(k));
  return m;
}

/** 利益センタ別の残高合計。導出できない対象は空文字のキーにまとめる */
export function totalsByProfitCenter(bal: ReadonlyBalanceIndex, mi: MasterIndex): Map<string, Yen> {
  const m = new Map<string, Yen>();
  for (const k of bal.objectKeys()) addTo(m, mi.derivePC(parseObjKey(k)), bal.total(k));
  return m;
}

/**
 * セグメント別の残高合計。顧客プロジェクトの WBS は、属性として導出されたセグメントに含める（P-08）。
 * セグメントに属さない対象（原価センタなど）は含めない。
 */
export function totalsBySegment(bal: ReadonlyBalanceIndex, mi: MasterIndex): Map<string, Yen> {
  const m = new Map<string, Yen>();
  for (const k of bal.objectKeys()) {
    const obj = parseObjKey(k);
    const seg = obj.type === 'PSEG' ? obj.id : mi.attributedSegmentOf(obj);
    if (seg !== undefined) addTo(m, seg, bal.total(k));
  }
  return m;
}

/** 勘定別の残高合計（全対象）。配賦・決済はゼロサムなので、全対象の合計は一次仕訳の勘定別合計と変わらない */
export function totalsByAccount(bal: ReadonlyBalanceIndex): Map<string, Yen> {
  const m = new Map<string, Yen>();
  for (const k of bal.objectKeys()) for (const [a, v] of bal.accountsOf(k)) addTo(m, a, v);
  return m;
}

/**
 * マージン分析上の勘定別の残高合計（セグメントと、顧客プロジェクトの WBS）。
 * 配布なら一次勘定のまま、配賦なら配賦勘定で見える、という違いはここに出る（P-22）。
 */
export function totalsBySegmentAccount(bal: ReadonlyBalanceIndex, mi: MasterIndex): Map<string, Yen> {
  const m = new Map<string, Yen>();
  for (const k of bal.objectKeys()) {
    const obj = parseObjKey(k);
    if (obj.type !== 'PSEG' && mi.attributedSegmentOf(obj) === undefined) continue;
    for (const [a, v] of bal.accountsOf(k)) addTo(m, a, v);
  }
  return m;
}

export interface ObjectStepTable {
  obj: ObjRef;
  accounts: string[];
  /** RunResult.stepOrder と同じ並び */
  steps: string[];
  /** cells[勘定][ステップ] = そのステップ末の残高 */
  cells: Yen[][];
  /** 各ステップ末の合計 */
  totals: Yen[];
}

/** オブジェクトの「勘定×ステップ」の残高表（F7-03） */
export function objectStepTable(result: RunResult, obj: ObjRef): ObjectStepTable {
  const k = objKey(obj);
  const accounts = new Set<string>();
  for (const s of result.stepOrder) for (const [a] of result.snapshots.get(s)!.accountsOf(k)) accounts.add(a);
  const accs = [...accounts].sort(compareId);
  const cells = accs.map((a) => result.stepOrder.map((s) => result.snapshots.get(s)!.get(k, a)));
  const totals = result.stepOrder.map((s) => result.snapshots.get(s)!.total(k));
  return { obj, accounts: accs, steps: [...result.stepOrder], cells, totals };
}

export interface Flow {
  sender: ObjRef;
  receiver: ObjRef;
  account: string;
  stepId: string;
  ruleId: string;
  amount: Yen;
}

/** 送信者→受信者の流れ（受信側の行から集計）。フロー図とサンキー図の材料（F7-01、F7-02） */
export function flows(ledger: Ledger, stepIds?: ReadonlySet<string>): Flow[] {
  const m = new Map<string, Flow>();
  for (const l of ledger) {
    if (l.role !== 'RECEIVER' || !l.partner || (stepIds && !stepIds.has(l.stepId))) continue;
    const key = [l.stepId, l.origin.ruleId, objKey(l.partner), objKey(l.obj), l.account].join('\u0000');
    const f = m.get(key);
    if (f) f.amount += l.amount;
    else m.set(key, { sender: l.partner, receiver: l.obj, account: l.account, stepId: l.stepId, ruleId: l.origin.ruleId, amount: l.amount });
  }
  return [...m.values()].filter((f) => f.amount !== 0).sort((a, b) => compareObj(a.sender, b.sender) || compareObj(a.receiver, b.receiver) || compareId(a.account, b.account));
}

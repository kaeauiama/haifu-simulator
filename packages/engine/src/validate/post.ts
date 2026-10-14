/**
 * 実行後の検証（F6-01〜F6-03）。V-11（流し終えた対象に額が戻る）、V-16（未配分）、V-17（ゼロサム）。
 */
import type { ReadonlyBalanceIndex } from '../ledger/balance.ts';
import type { MasterIndex } from '../ledger/masterIndex.ts';
import { compareObj, objKey, parseObjKey } from '../model/keys.ts';
import type { ClosingStep, Issue, Ledger, PrimaryPosting } from '../model/types.ts';
import { fmtYen, mkIssue } from './issues.ts';

/**
 * V-11：ある対象が送信者として流した後、より後のステップで受信者として額を受け、その後もう流していない。
 * 同じステップ内の戻り（非反復サイクル）は V-12 で扱う。
 */
export function checkReturnedAfterSending(ledger: Ledger, executed: readonly ClosingStep[], mi: MasterIndex): Issue[] {
  const order = new Map(executed.map((s, i) => [s.id, i]));
  const lastSend = new Map<string, number>();
  const lastRecv = new Map<string, number>();
  for (const l of ledger) {
    const i = order.get(l.stepId);
    if (i === undefined || l.amount === 0) continue;
    const k = objKey(l.obj);
    if (l.role === 'SENDER') lastSend.set(k, Math.max(lastSend.get(k) ?? -1, i));
    else if (l.role === 'RECEIVER') lastRecv.set(k, Math.max(lastRecv.get(k) ?? -1, i));
  }
  const issues: Issue[] = [];
  const keys = [...lastRecv.keys()].filter((k) => lastSend.has(k) && lastRecv.get(k)! > lastSend.get(k)!);
  for (const k of keys.map(parseObjKey).sort(compareObj).map(objKey)) {
    const obj = parseObjKey(k);
    const sent = executed[lastSend.get(k)!]!;
    const recv = executed[lastRecv.get(k)!]!;
    issues.push(mkIssue('V-11', 'POST', `${mi.label(obj)}（「${sent.name}」で流した後、「${recv.name}」で受けた）`, { stepId: recv.id, obj }));
  }
  return issues;
}

/** V-16：締め後に残高が残る原価センタ・WBS。顧客プロジェクトはセグメントに出ているので除く（P-08） */
export function checkUnallocated(final: ReadonlyBalanceIndex, mi: MasterIndex): Issue[] {
  const issues: Issue[] = [];
  const keys = [...final.objectKeys()].map(parseObjKey).filter((o) => o.type === 'CCTR' || o.type === 'WBS' || o.type === 'ORD');
  for (const obj of keys.sort(compareObj)) {
    if (mi.isStatisticalWbs(obj) || mi.attributedSegmentOf(obj) !== undefined) continue;
    const bal = final.total(objKey(obj));
    if (bal !== 0) issues.push(mkIssue('V-16', 'POST', `${mi.label(obj)}：${fmtYen(bal)}円`, { obj }));
  }
  return issues;
}

/** V-17：一次仕訳の合計と、最終的な全対象の残高合計が一致するか。あわせて各伝票の貸借一致も見る */
export function checkZeroSum(postings: readonly PrimaryPosting[], ledger: Ledger, final: ReadonlyBalanceIndex): Issue[] {
  const issues: Issue[] = [];
  const input = postings.reduce((s, p) => s + p.amount, 0);
  const output = final.grandTotal();
  if (input !== output) issues.push(mkIssue('V-17', 'POST', `一次仕訳 ${fmtYen(input)}円、最終残高 ${fmtYen(output)}円`));
  const docs = new Map<string, number>();
  for (const l of ledger) if (l.role !== 'PRIMARY') docs.set(l.docId, (docs.get(l.docId) ?? 0) + l.amount);
  for (const [doc, sum] of docs) {
    if (sum !== 0) issues.push(mkIssue('V-17', 'POST', `伝票 ${doc} の貸借が ${fmtYen(sum)}円ずれている`, { stepId: doc.split('#')[0]! }));
  }
  return issues;
}

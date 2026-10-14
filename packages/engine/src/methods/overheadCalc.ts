/**
 * 間接費計算（原価計算シート）。対象のベース勘定残高 × 率を、対象を借方・貸方原価センタを貸方として
 * 間接費勘定（41）で計上する（5.2）。
 */
import { roundYen } from '../ledger/rounding.ts';
import { accountPred } from '../ledger/select.ts';
import { compareObj, objKey } from '../model/keys.ts';
import type { CostingSheet, ObjRef } from '../model/types.ts';
import type { Poster } from './context.ts';

export function runCostingSheet(cs: CostingSheet, poster: Poster): void {
  const { mi, state, stepStart, blocked, allocSenders } = poster.ctx;
  if (blocked.has(cs.id)) return;
  const warned = new Set<string>();
  for (const target of [...cs.targets].sort(compareObj)) {
    const tKey = objKey(target);
    cs.rows.forEach((row, ri) => {
      const base = stepStart.total(tKey, accountPred(row.base));
      const amount = roundYen((base * row.ratePct) / 100);
      if (amount === 0) return;
      const credit: ObjRef = { type: 'CCTR', id: row.creditCctr };
      const cKey = objKey(credit);
      poster.pair(poster.newDoc(), {
        sender: credit,
        receiver: target,
        account: row.overheadAccount,
        amount,
        ruleId: cs.id,
        rowId: String(ri + 1),
        sourceLineIds: state.sourceLineIds(cKey),
      });
      // 配賦済みの原価センタを貸方にしてマイナスになった（5.1 の依存、V-15）
      if (allocSenders.has(cKey) && state.balances.total(cKey) < 0 && !warned.has(cKey)) {
        warned.add(cKey);
        poster.issue('V-15', `${mi.label(credit)}（${cs.id}）`, { ruleId: cs.id, obj: credit });
      }
    });
  }
}

/**
 * TDD（Top-Down Distribution）。粗いセグメントの残高を、参照データの構成比で細かいセグメントへ配る（5.2）。
 * 勘定は送信と同じ。粗いセグメントを貸方、細かいセグメントを借方にする。
 */
import { normalizeWeights, allocate } from '../ledger/rounding.ts';
import { accountPred, selectObjects } from '../ledger/select.ts';
import { CHAR_KEYS } from '../model/schema.ts';
import { compareId, objKey, parseObjKey, parseSegmentKey, segmentKey } from '../model/keys.ts';
import type { ObjRef, SegmentChars, TDDRule } from '../model/types.ts';
import type { Poster } from './context.ts';

export function runTDD(rule: TDDRule, poster: Poster): void {
  const { mi, state, stepStart, blocked } = poster.ctx;
  if (blocked.has(rule.id)) return;

  const selected = selectObjects(rule.sender.segments, mi, state.balances).filter((o) => o.type === 'PSEG');
  // 属性として導出されたセグメントは TDD の送信者にできない（2章、V-09）。ルールごと仕訳を作らない
  const attributed = selected.filter((s) => mi.attributedSegments.has(s.id));
  if (attributed.length) {
    for (const obj of attributed) poster.issue('V-09', `${rule.name}：${mi.label(obj)}`, { ruleId: rule.id, obj });
    return;
  }
  // 細分化する特性がまだ未設定のセグメントだけが送信者になる（P-06）
  const senders = selected.filter((s) => {
    const c = parseSegmentKey(s.id);
    return rule.distributeChars.every((k) => c[k] === undefined);
  });

  const sendPred = accountPred(rule.sender.accounts);
  const refPred = accountPred(rule.reference.accounts);
  const refSegments = [...stepStart.objectKeys()].filter((k) => k.startsWith('PSEG:')).map((k) => parseObjKey(k).id);
  const distribute = new Set(rule.distributeChars);

  for (const sender of senders) {
    const sKey = objKey(sender);
    const accounts = [...state.balances.accountsOf(sKey)].filter(([a, v]) => sendPred(a) && v !== 0);
    if (!accounts.length) continue;
    accounts.sort(([a], [b]) => compareId(a, b));
    const sc = parseSegmentKey(sender.id);

    // 参照データ：細分化する特性が設定済みで、送信者が設定している特性が一致するセグメント
    const refByReceiver = new Map<string, number>();
    for (const rid of refSegments) {
      const rc = parseSegmentKey(rid);
      if (!rule.distributeChars.every((k) => rc[k] !== undefined)) continue;
      if (!CHAR_KEYS.every((k) => distribute.has(k) || sc[k] === undefined || rc[k] === sc[k])) continue;
      const v = stepStart.total(`PSEG:${rid}`, refPred);
      if (v === 0) continue;
      const recvChars: SegmentChars = { ...sc };
      for (const k of rule.distributeChars) recvChars[k] = rc[k]!;
      const rk = `PSEG:${segmentKey(recvChars)}`;
      refByReceiver.set(rk, (refByReceiver.get(rk) ?? 0) + v);
    }
    const norm = normalizeWeights([...refByReceiver].map(([key, weight]) => ({ key, weight })));
    if (!norm) {
      poster.issue('V-10', `${rule.name}：${mi.label(sender)}`, { ruleId: rule.id, obj: sender });
      continue;
    }
    if (norm.dropped.length) poster.issue('X-NEG-WEIGHT', `${rule.name}（${norm.dropped.join('、')}）`, { ruleId: rule.id });
    const shares = norm.shares;
    const receivers: ObjRef[] = shares.map((s) => parseObjKey(s.key));

    for (const [account, balance] of accounts) {
      const sources = state.sourceLineIds(sKey, (a) => a === account);
      const parts = allocate(balance, shares);
      const doc = poster.newDoc();
      receivers.forEach((r, i) => {
        poster.pair(doc, { sender, receiver: r, account, amount: parts[i]!, ruleId: rule.id, sourceLineIds: sources });
      });
    }
  }
}

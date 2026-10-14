/**
 * TDD（Top-Down Distribution）。粗いセグメントの残高を、参照データの構成比で細かいセグメントへ配る（5.2）。
 * 勘定は送信と同じ。粗いセグメントを貸方、細かいセグメントを借方にする。
 */
import type { ReadonlyBalanceIndex } from '../ledger/balance.ts';
import type { MasterIndex } from '../ledger/masterIndex.ts';
import { normalizeWeights, allocate } from '../ledger/rounding.ts';
import { accountPred, selectObjects } from '../ledger/select.ts';
import { CHAR_KEYS } from '../model/schema.ts';
import { compareId, objKey, parseObjKey, parseSegmentKey, segmentKey } from '../model/keys.ts';
import type { ObjRef, SegmentChars, TDDRule } from '../model/types.ts';
import type { Poster } from './context.ts';

/** 細分化する特性がまだ未設定のセグメントだけが送信者になる（P-06） */
export function tddSenders(rule: TDDRule, mi: MasterIndex, balances?: ReadonlyBalanceIndex): ObjRef[] {
  return selectObjects(rule.sender.segments, mi, balances).filter((s) => {
    if (s.type !== 'PSEG') return false;
    const c = parseSegmentKey(s.id);
    return rule.distributeChars.every((k) => c[k] === undefined);
  });
}

/**
 * 送信セグメントの受信者と参照額（P-06）。参照データは、細分化する特性が設定済みで、
 * 送信者が設定している特性が一致するセグメント。受信者は送信者の特性に参照の細分化特性の値を足したもの。
 */
export function tddReferenceWeights(rule: TDDRule, senderId: string, balances: ReadonlyBalanceIndex): Map<string, number> {
  const sc = parseSegmentKey(senderId);
  const refPred = accountPred(rule.reference.accounts);
  const distribute = new Set(rule.distributeChars);
  const out = new Map<string, number>();
  for (const k of balances.objectKeys()) {
    if (!k.startsWith('PSEG:')) continue;
    const rid = parseObjKey(k).id;
    const rc = parseSegmentKey(rid);
    if (!rule.distributeChars.every((c) => rc[c] !== undefined)) continue;
    if (!CHAR_KEYS.every((c) => distribute.has(c) || sc[c] === undefined || rc[c] === sc[c])) continue;
    const v = balances.total(k, refPred);
    if (v === 0) continue;
    const recvChars: SegmentChars = { ...sc };
    for (const c of rule.distributeChars) recvChars[c] = rc[c]!;
    const rk = `PSEG:${segmentKey(recvChars)}`;
    out.set(rk, (out.get(rk) ?? 0) + v);
  }
  return out;
}

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
  const senders = tddSenders(rule, mi, state.balances);
  const sendPred = accountPred(rule.sender.accounts);

  for (const sender of senders) {
    const sKey = objKey(sender);
    const accounts = [...state.balances.accountsOf(sKey)].filter(([a, v]) => sendPred(a) && v !== 0);
    if (!accounts.length) continue;
    accounts.sort(([a], [b]) => compareId(a, b));

    const norm = normalizeWeights([...tddReferenceWeights(rule, sender.id, stepStart)].map(([key, weight]) => ({ key, weight })));
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

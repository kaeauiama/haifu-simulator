/**
 * 決済（WBS → 原価センタ、収益性セグメント、他WBS）。5.2「細かい決めごと」。
 * - 送信 WBS × 勘定ごとの残高を、決済構造で決まる勘定（21 か元の勘定）で送信を貸方、受信を借方にする
 * - 分配規則は金額指定を先に引き、残りに%、さらに残りに等価係数を当てる（P-04）
 * - WBS から別の WBS への決済は、受信者を後にする順（トポロジカル順）で処理する。循環はエラー（V-07）
 */
import { allocate, type Share } from '../ledger/rounding.ts';
import { matchAccount } from '../ledger/select.ts';
import { compareId, compareObj, objKey } from '../model/keys.ts';
import type { SettlementRule } from '../model/types.ts';
import type { Poster } from './context.ts';
import { RETAIN_KEY } from './weights.ts';

export function runSettlementStep(ruleIds: readonly string[], poster: Poster): void {
  const { scenario, blocked, mi } = poster.ctx;
  const rules: SettlementRule[] = [];
  for (const id of ruleIds) {
    const r = scenario.settlementRules.find((x) => x.id === id);
    if (!r) poster.issue('X-REF', `決済規則 ${id}`, { ruleId: id });
    else if (!blocked.has(r.id)) rules.push(r);
  }

  // トポロジカル順：このステップの送信者へ決済する WBS を先に処理する
  const bySender = new Map<string, SettlementRule[]>();
  for (const r of rules) {
    const k = objKey(r.sender);
    bySender.set(k, [...(bySender.get(k) ?? []), r]);
  }
  const indegree = new Map<string, number>([...bySender.keys()].map((k) => [k, 0]));
  const succ = new Map<string, Set<string>>();
  for (const [k, rs] of bySender) {
    const out = new Set<string>();
    for (const r of rs) for (const d of r.rules) {
      const rk = objKey(d.receiver);
      if (rk !== k && bySender.has(rk)) out.add(rk);
    }
    succ.set(k, out);
    for (const rk of out) indegree.set(rk, indegree.get(rk)! + 1);
  }
  const ready = [...indegree].filter(([, d]) => d === 0).map(([k]) => k);
  const order: string[] = [];
  const byKeyOrder = (a: string, b: string) => compareObj(bySender.get(a)![0]!.sender, bySender.get(b)![0]!.sender);
  ready.sort(byKeyOrder);
  while (ready.length) {
    const k = ready.shift()!;
    order.push(k);
    for (const rk of succ.get(k)!) {
      indegree.set(rk, indegree.get(rk)! - 1);
      if (indegree.get(rk) === 0) {
        ready.push(rk);
        ready.sort(byKeyOrder);
      }
    }
  }
  for (const [k, d] of indegree) {
    if (d > 0) {
      const r = bySender.get(k)![0]!;
      poster.issue('V-07', mi.label(r.sender), { ruleId: r.id, obj: r.sender });
    }
  }
  for (const k of order) for (const r of bySender.get(k)!) settleOne(r, poster);
}

function settleOne(rule: SettlementRule, poster: Poster): void {
  const { mi, state } = poster.ctx;
  const sender = rule.sender;
  if (sender.type !== 'WBS') {
    poster.issue('X-UNSUPPORTED', `${mi.label(sender)}（MVPの決済の送信者はWBSだけ）`, { ruleId: rule.id, obj: sender });
    return;
  }
  const wbs = mi.wbs.get(sender.id);
  const profile = wbs?.settlementProfileId ? mi.profiles.get(wbs.settlementProfileId) : undefined;
  if (!profile) {
    poster.issue('X-NO-PROFILE', mi.label(sender), { ruleId: rule.id, obj: sender });
    return;
  }
  const period = mi.master.period;
  const active = rule.rules
    .map((d, i) => ({ d, row: String(i + 1) }))
    .filter(({ d }) => d.validFrom <= period && (d.validTo === undefined || period <= d.validTo));
  if (!active.length) return;

  // 決済構造で、勘定ごとの決済先の勘定を決める。決済勘定に既にある残高（前の決済の貸方）は同じ決済勘定でまとめる
  const key = objKey(sender);
  const settleAccounts = new Set(profile.structure.map((s) => s.settleAccount).filter((a) => a !== 'KEEP'));
  const pools = new Map<string, { balance: number; accounts: Set<string> }>();
  const balances = [...state.balances.accountsOf(key)].filter(([, v]) => v !== 0).sort(([a], [b]) => compareId(a, b));
  for (const [account, balance] of balances) {
    let target: string;
    if (settleAccounts.has(account)) target = account;
    else {
      const row = profile.structure.find((s) => matchAccount(s.accounts, account));
      if (!row) {
        poster.issue('X-SETTLE-ACCT', `${mi.label(sender)} の勘定 ${account}`, { ruleId: rule.id, obj: sender });
        continue;
      }
      target = row.settleAccount === 'KEEP' ? account : row.settleAccount;
    }
    let p = pools.get(target);
    if (!p) pools.set(target, (p = { balance: 0, accounts: new Set() }));
    p.balance += balance;
    p.accounts.add(account);
  }
  const total = [...pools.values()].reduce((s, p) => s + p.balance, 0);

  // 受信者ごとの割合（合計の残高に対する比）
  const ratios = active.map(() => 0);
  let rest = 1;
  const amountIdx = active.flatMap((a, i) => (a.d.basis === 'AMOUNT' ? [i] : []));
  if (amountIdx.length) {
    const amounts = amountIdx.map((i) => Math.abs(active[i]!.d.value));
    const sumA = amounts.reduce((s, v) => s + v, 0);
    if (total === 0) {
      if (sumA > 0) poster.issue('X-AMOUNT-OVER', `${mi.label(sender)}（残高0）`, { ruleId: rule.id, obj: sender });
    } else {
      const scale = sumA > Math.abs(total) ? Math.abs(total) / sumA : 1;
      if (scale < 1) poster.issue('X-AMOUNT-OVER', mi.label(sender), { ruleId: rule.id, obj: sender });
      amountIdx.forEach((i, n) => (ratios[i] = (amounts[n]! * scale) / Math.abs(total)));
      rest -= amountIdx.reduce((s, i) => s + ratios[i]!, 0);
    }
  }
  let pctSum = 0;
  active.forEach((a, i) => {
    if (a.d.basis !== 'PCT') return;
    ratios[i] = (rest * a.d.value) / 100;
    pctSum += a.d.value;
  });
  const eqIdx = active.flatMap((a, i) => (a.d.basis === 'EQUIV' ? [i] : []));
  const eqSum = eqIdx.reduce((s, i) => s + active[i]!.d.value, 0);
  if (eqSum > 0) {
    const eqRest = rest * Math.max(0, 1 - pctSum / 100);
    for (const i of eqIdx) ratios[i] = (eqRest * active[i]!.d.value) / eqSum;
  }
  const retain = Math.max(0, 1 - ratios.reduce((s, v) => s + v, 0));

  const shares: Share[] = [];
  const receivers: (typeof active)[number][] = [];
  active.forEach((a, i) => {
    if (ratios[i]! > 0) {
      shares.push({ key: objKey(a.d.receiver), weight: ratios[i]! });
      receivers.push(a);
    }
  });
  if (retain > 1e-12) shares.push({ key: RETAIN_KEY, weight: retain });
  if (!receivers.length) return;

  const targets = [...pools.keys()].sort(compareId);
  for (const target of targets) {
    const pool = pools.get(target)!;
    if (pool.balance === 0) continue;
    const sources = state.sourceLineIds(key, (a) => pool.accounts.has(a));
    const parts = allocate(pool.balance, shares);
    const doc = poster.newDoc();
    receivers.forEach((a, i) => {
      poster.pair(doc, {
        sender,
        receiver: a.d.receiver,
        account: target,
        amount: parts[i]!,
        ruleId: rule.id,
        rowId: a.row,
        sourceLineIds: sources,
      });
    });
  }
}

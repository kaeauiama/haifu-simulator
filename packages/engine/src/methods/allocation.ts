/**
 * Universal Allocation のサイクル（配布・配賦・マージン分析への配賦／配布）。5.2、5.3。
 * - 配布：送信対象×送信勘定ごとの残高を、同じ勘定のまま受信側へ流す
 * - 配賦：送信勘定を合算し、送信側・受信側とも配賦勘定（42）で計上する
 */
import { solveIterative } from '../iterative/solve.ts';
import { allocate, roundYen, type Share } from '../ledger/rounding.ts';
import { accountPred, matchAccount, selectObjects } from '../ledger/select.ts';
import { compareId, objKey, parseObjKey, sameObj } from '../model/keys.ts';
import { profitCenterKeys } from '../ledger/select.ts';
import type { AllocSegment, AllocationCycle, ObjRef, Yen } from '../model/types.ts';
import type { Poster } from './context.ts';
import { RETAIN_KEY, resolveReceivers, type ReceiverWeights } from './weights.ts';

interface Pool {
  /** 計上する勘定（配布は元の勘定、配賦は配賦勘定） */
  account: string;
  balance: Yen;
  sources: readonly string[];
  sourceFactors?: readonly number[];
}

export function runAllocationCycle(cycle: AllocationCycle, poster: Poster): void {
  if (poster.ctx.blocked.has(cycle.id)) return;
  // 配賦では、受け取った配賦勘定の額も次の送信額に含める（段階配賦、反復）
  const allocAccounts = new Set(
    cycle.type === 'OVERHEAD' ? cycle.segments.flatMap((s) => (s.allocAccount ? [s.allocAccount] : [])) : [],
  );
  if (cycle.iterative) runIterative(cycle, poster, allocAccounts);
  else runSequential(cycle, poster, allocAccounts);
}

/** 送信者の残高の読み方。利益センタは、その利益センタに導出される全対象の残高の合計（P-23） */
interface SenderReader {
  accounts(key: string): ReadonlyMap<string, Yen>;
  sources(key: string, pred: (account: string) => boolean): string[];
}

function readerFor(cycle: AllocationCycle, poster: Poster): SenderReader {
  const { state, mi } = poster.ctx;
  if (cycle.context !== 'PCTR') {
    return { accounts: (k) => state.balances.accountsOf(k), sources: (k, pred) => state.sourceLineIds(k, pred) };
  }
  const byPc = profitCenterKeys(state.balances, mi);
  const keysOf = (key: string) => byPc.get(parseObjKey(key).id) ?? [];
  return {
    accounts: (key) => {
      const m = new Map<string, Yen>();
      for (const k of keysOf(key)) for (const [a, v] of state.balances.accountsOf(k)) m.set(a, (m.get(a) ?? 0) + v);
      return m;
    },
    sources: (key, pred) => keysOf(key).flatMap((k) => state.sourceLineIds(k, pred)),
  };
}

function senderPools(cycle: AllocationCycle, seg: AllocSegment, key: string, reader: SenderReader, allocAccounts: Set<string>): Pool[] {
  const sel = accountPred(seg.sender.accounts);
  const balances = reader.accounts(key);
  if (cycle.type === 'DISTRIBUTION') {
    const pools: Pool[] = [];
    const accounts = [...balances].filter(([a, v]) => sel(a) && v !== 0);
    accounts.sort(([a], [b]) => compareId(a, b));
    for (const [account, balance] of accounts) {
      pools.push({ account, balance, sources: reader.sources(key, (a) => a === account) });
    }
    return pools;
  }
  const pred = (a: string) => sel(a) || allocAccounts.has(a);
  let balance = 0;
  for (const [a, v] of balances) if (pred(a)) balance += v;
  return balance === 0 ? [] : [{ account: seg.allocAccount!, balance, sources: reader.sources(key, pred) }];
}

/** 送信者1件・1勘定分の送信を受信側へ割って計上する。額を受け取った受信者（自分以外）のキーを返す */
function postSplit(poster: Poster, ruleId: string, rowId: string, sender: ObjRef, pool: Pool, amount: Yen, recv: ReceiverWeights): string[] {
  if (amount === 0) return [];
  const parts = allocate(amount, recv.shares);
  const doc = poster.newDoc();
  const got: string[] = [];
  recv.shares.forEach((s, i) => {
    const v = parts[i]!;
    if (v === 0 || s.key === RETAIN_KEY) return;
    const r = recv.objs.get(s.key)!;
    if (sameObj(r, sender)) return; // 自分への配分は貸借が相殺されるので計上しない
    postPair(poster, doc, ruleId, rowId, sender, r, pool, v);
    got.push(s.key);
  });
  return got;
}

function postPair(poster: Poster, doc: string, ruleId: string, rowId: string, sender: ObjRef, receiver: ObjRef, pool: Pool, v: Yen): void {
  poster.pair(doc, { sender, receiver, account: pool.account, amount: v, ruleId, rowId, sourceLineIds: pool.sources, sourceFactors: pool.sourceFactors });
}

// ---------- 非反復：セグメントを定義順に（5.3） ----------
function runSequential(cycle: AllocationCycle, poster: Poster, allocAccounts: Set<string>): void {
  const { mi, state } = poster.ctx;
  const processed = new Set<string>();
  const warned = new Set<string>();
  for (const seg of cycle.segments) {
    const recv = resolveReceivers(seg, cycle.id, poster);
    if (!recv) continue;
    const share = seg.sender.sharePct / 100;
    // 同じセグメントの送信者は、セグメント開始時点の残高を同時に読む（P-02）
    const reader = readerFor(cycle, poster);
    const plans = selectObjects(seg.sender.objects, mi, state.balances).map((obj) => {
      const key = objKey(obj);
      return { obj, key, pools: senderPools(cycle, seg, key, reader, allocAccounts) };
    });
    const current = new Set(plans.map((p) => p.key));
    for (const p of plans) {
      for (const pool of p.pools) {
        const got = postSplit(poster, cycle.id, seg.id, p.obj, pool, roundYen(pool.balance * share), recv);
        for (const k of got) {
          if ((processed.has(k) || current.has(k)) && !warned.has(k)) {
            warned.add(k);
            const obj = recv.objs.get(k)!;
            poster.issue('V-12', `${cycle.name}／${seg.name}：${mi.label(obj)}`, { ruleId: cycle.id, obj });
          }
        }
      }
    }
    for (const k of current) processed.add(k);
  }
}

// ---------- 反復：送信者同士のやり取りを連立方程式で解く（5.3） ----------
interface IterEntry {
  obj: ObjRef;
  key: string;
  seg: AllocSegment;
  recv: ReceiverWeights;
  share: number;
}

function runIterative(cycle: AllocationCycle, poster: Poster, allocAccounts: Set<string>): void {
  const { mi, state } = poster.ctx;
  const entries: IterEntry[] = [];
  const seen = new Set<string>();
  for (const seg of cycle.segments) {
    const recv = resolveReceivers(seg, cycle.id, poster);
    if (!recv) return;
    for (const obj of selectObjects(seg.sender.objects, mi, state.balances)) {
      const key = objKey(obj);
      if (seen.has(key)) {
        poster.issue('X-ITER-DUP', `${cycle.name}：${mi.label(obj)}`, { ruleId: cycle.id, obj });
        return;
      }
      seen.add(key);
      entries.push({ obj, key, seg, recv, share: seg.sender.sharePct / 100 });
    }
  }
  if (entries.length === 0) return;

  const reader = readerFor(cycle, poster);
  if (cycle.type === 'OVERHEAD') {
    const pools = entries.map((e): Pool => {
      const pred = (a: string) => matchAccount(e.seg.sender.accounts, a) || allocAccounts.has(a);
      let balance = 0;
      for (const [a, v] of reader.accounts(e.key)) if (pred(a)) balance += v;
      return { account: e.seg.allocAccount!, balance, sources: reader.sources(e.key, pred) };
    });
    solveAndPost(cycle, poster, entries, pools);
    return;
  }
  // 配布は勘定ごとに解く。その勘定を送信勘定に含む送信者だけが、方程式に入る（P-03）
  const accounts = new Set<string>();
  for (const e of entries) {
    for (const [a, v] of reader.accounts(e.key)) if (v !== 0 && matchAccount(e.seg.sender.accounts, a)) accounts.add(a);
  }
  for (const a of [...accounts].sort(compareId)) {
    const members = entries.filter((e) => matchAccount(e.seg.sender.accounts, a));
    const pools = members.map((e): Pool => ({ account: a, balance: reader.accounts(e.key).get(a) ?? 0, sources: reader.sources(e.key, (x) => x === a) }));
    solveAndPost(cycle, poster, members, pools);
  }
}

/**
 * 解いた総額を一度だけ受信側へ配る。円への丸めは P-01：
 * 1) 送信者間の流れを、実数解から最大剰余法で整数にする
 * 2) 送信者ごとの総額 T_i = 自身の残高 + 受け取った整数額 を確定し、送信額 = T_i × 送信割合
 * 3) 送信額から送信者間の流れを引いた残りを、送信者以外の受信者へ最大剰余法で配る
 * これで送信割合100%の送信者は必ず残高0になり、全体の合計も一致する。
 */
function solveAndPost(cycle: AllocationCycle, poster: Poster, entries: IterEntry[], pools: Pool[]): void {
  const n = entries.length;
  const idx = new Map(entries.map((e, i) => [e.key, i]));
  const fractions = entries.map((e) => {
    const total = e.recv.shares.reduce((s, x) => s + x.weight, 0);
    return e.recv.shares.map((s) => s.weight / total);
  });
  const M = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  entries.forEach((e, j) => {
    e.recv.shares.forEach((s, k) => {
      const i = idx.get(s.key);
      if (i !== undefined) M[i]![j]! += e.share * fractions[j]![k]!;
    });
  });
  const b = pools.map((p) => p.balance);
  const sol = solveIterative(M, b);
  if (sol.singular) {
    poster.issue('X-ITER-SINGULAR', cycle.name, { ruleId: cycle.id });
    return;
  }
  if (!sol.converged) poster.issue('X-ITER-NOCONV', cycle.name, { ruleId: cycle.id });

  // 1) 送信者間の流れ
  const internal = entries.map(() => new Map<number, Yen>());
  entries.forEach((e, j) => {
    const parts = allocate(roundYen(e.share * sol.x[j]!), e.recv.shares);
    e.recv.shares.forEach((s, k) => {
      const i = idx.get(s.key);
      if (i !== undefined) internal[j]!.set(i, parts[k]!);
    });
  });

  // 来歴：送信者 j の総額は Σ_i N[j][i] b_i なので、各送信者の残高の仕訳を N[j][i] 倍で参照する
  const sourcesOf = (j: number): Pick<Pool, 'sources' | 'sourceFactors'> => {
    if (!sol.inverse) return { sources: pools[j]!.sources };
    const sources: string[] = [];
    const sourceFactors: number[] = [];
    pools.forEach((p, i) => {
      const f = sol.inverse![j]![i]!;
      if (Math.abs(f) < 1e-12) return;
      for (const id of p.sources) {
        sources.push(id);
        sourceFactors.push(f);
      }
    });
    return { sources, sourceFactors };
  };

  entries.forEach((e, i) => {
    let received = 0;
    for (let j = 0; j < n; j++) received += internal[j]!.get(i) ?? 0;
    const total = b[i]! + received;
    const send = roundYen(e.share * total);
    let toInternal = 0;
    for (const v of internal[i]!.values()) toInternal += v;

    // 3) 送信者以外への配分
    const ext: Share[] = e.recv.shares.filter((s) => !idx.has(s.key));
    const extParts = ext.length ? allocate(send - toInternal, ext) : [];

    const pool: Pool = { account: pools[i]!.account, balance: total, ...sourcesOf(i) };
    const doc = poster.newDoc();
    for (const [k, v] of internal[i]!) {
      if (k === i || v === 0) continue;
      postPair(poster, doc, cycle.id, e.seg.id, e.obj, entries[k]!.obj, pool, v);
    }
    ext.forEach((s, k) => {
      const v = extParts[k]!;
      if (v === 0 || s.key === RETAIN_KEY) return;
      postPair(poster, doc, cycle.id, e.seg.id, e.obj, e.recv.objs.get(s.key)!, pool, v);
    });
  });
}

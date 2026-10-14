import type { JournalLine, Yen } from '../model/types.ts';
import { objKey } from '../model/keys.ts';

/** (対象キー, 勘定) → 残高。ステップ末ごとのスナップショットとして読む側の型 */
export interface ReadonlyBalanceIndex {
  get(objKey: string, account: string): Yen;
  accountsOf(objKey: string): ReadonlyMap<string, Yen>;
  objectKeys(): IterableIterator<string>;
  /** 対象の残高合計。pred を渡すと、その勘定だけを足す */
  total(objKey: string, pred?: (account: string) => boolean): Yen;
  grandTotal(): Yen;
}

const EMPTY: ReadonlyMap<string, Yen> = new Map();

export class BalanceIndex implements ReadonlyBalanceIndex {
  private readonly byObj = new Map<string, Map<string, Yen>>();

  get(key: string, account: string): Yen {
    return this.byObj.get(key)?.get(account) ?? 0;
  }

  accountsOf(key: string): ReadonlyMap<string, Yen> {
    return this.byObj.get(key) ?? EMPTY;
  }

  objectKeys(): IterableIterator<string> {
    return this.byObj.keys();
  }

  total(key: string, pred?: (account: string) => boolean): Yen {
    let s = 0;
    for (const [a, v] of this.accountsOf(key)) if (!pred || pred(a)) s += v;
    return s;
  }

  grandTotal(): Yen {
    let s = 0;
    for (const m of this.byObj.values()) for (const v of m.values()) s += v;
    return s;
  }

  add(key: string, account: string, amount: Yen): void {
    let m = this.byObj.get(key);
    if (!m) this.byObj.set(key, (m = new Map()));
    m.set(account, (m.get(account) ?? 0) + amount);
  }

  clone(): BalanceIndex {
    const c = new BalanceIndex();
    for (const [k, m] of this.byObj) c.byObj.set(k, new Map(m));
    return c;
  }
}

/**
 * 実行中の台帳。仕訳の列と残高索引、来歴用の「対象×勘定 → 仕訳ID」索引を一緒に持つ。
 * エンジンの内部だけで使い、外には読み取り専用で返す。
 */
export class LedgerState {
  readonly lines: JournalLine[] = [];
  readonly balances = new BalanceIndex();
  private readonly idsByKey = new Map<string, Map<string, string[]>>();

  push(line: JournalLine): void {
    this.lines.push(line);
    const k = objKey(line.obj);
    this.balances.add(k, line.account, line.amount);
    let m = this.idsByKey.get(k);
    if (!m) this.idsByKey.set(k, (m = new Map()));
    let ids = m.get(line.account);
    if (!ids) m.set(line.account, (ids = []));
    ids.push(line.id);
  }

  /** いま対象の残高を構成している仕訳ID（pred で勘定を絞る）。呼んだ時点の写しを返す */
  sourceLineIds(key: string, pred?: (account: string) => boolean): string[] {
    const out: string[] = [];
    const m = this.idsByKey.get(key);
    if (!m) return out;
    for (const [a, ids] of m) if (!pred || pred(a)) out.push(...ids);
    return out;
  }
}

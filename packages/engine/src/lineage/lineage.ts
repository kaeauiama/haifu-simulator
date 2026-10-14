/**
 * 来歴の計算（5.6、F7-04）。各仕訳が持つ「送信時点の送信側残高を構成した仕訳」を逆に辿り、
 * 送信時点の構成比で按分しながら一次仕訳まで遡る。計算はクリックされたときだけ行い、
 * 結果はこのオブジェクトを捨てるまで保持する。
 */
import { objKey } from '../model/keys.ts';
import type { JournalLine, Ledger, ObjRef } from '../model/types.ts';

/** 一次仕訳 ID → 額（実数）。合計は辿った仕訳の額に一致する */
export type LineageVector = Map<string, number>;

/** 送信側の残高が0で構成比が決まらない分（活動配分で残高のない原価センタを貸方にした場合など） */
export const UNATTRIBUTED = '(来歴なし)';

interface Pooled {
  vec: LineageVector;
  /** Σ 倍率 × 額。送信時点の送信側残高 */
  weight: number;
}

export class LineageTracer {
  private readonly byId = new Map<string, JournalLine>();
  private readonly memo = new Map<string, LineageVector>();
  private readonly pooled = new WeakMap<readonly string[], Map<readonly number[] | undefined, Pooled>>();

  constructor(private readonly ledger: Ledger) {
    for (const l of ledger) this.byId.set(l.id, l);
  }

  /** 1行の来歴 */
  line(id: string): LineageVector {
    const hit = this.memo.get(id);
    if (hit) return hit;
    const l = this.byId.get(id);
    if (!l) throw new Error(`line not found: ${id}`);
    let vec: LineageVector;
    if (l.role === 'PRIMARY') vec = new Map([[l.origin.rowId ?? l.id, l.amount]]);
    else {
      const p = this.pool(l.origin.sourceLineIds, l.origin.sourceFactors);
      if (Math.abs(p.weight) < 1e-9) vec = new Map([[UNATTRIBUTED, l.amount]]);
      else vec = scale(p.vec, l.amount / p.weight);
    }
    this.memo.set(id, vec);
    return vec;
  }

  /** 複数行の来歴の和 */
  lines(ids: readonly string[]): LineageVector {
    const out: LineageVector = new Map();
    for (const id of ids) addInto(out, this.line(id), 1);
    return out;
  }

  /**
   * 対象の残高の来歴。account を渡すとその勘定だけ、upToSteps を渡すとそのステップまでの仕訳だけを辿る。
   */
  balance(obj: ObjRef, opts: { account?: string; upToSteps?: ReadonlySet<string> } = {}): LineageVector {
    const k = objKey(obj);
    const ids = this.ledger
      .filter((l) => objKey(l.obj) === k && (opts.account === undefined || l.account === opts.account) && (!opts.upToSteps || opts.upToSteps.has(l.stepId)))
      .map((l) => l.id);
    return this.lines(ids);
  }

  private pool(sources: readonly string[], factors: readonly number[] | undefined): Pooled {
    let byFactors = this.pooled.get(sources);
    if (!byFactors) this.pooled.set(sources, (byFactors = new Map()));
    const hit = byFactors.get(factors);
    if (hit) return hit;
    const vec: LineageVector = new Map();
    let weight = 0;
    sources.forEach((sid, i) => {
      const f = factors?.[i] ?? 1;
      const s = this.byId.get(sid);
      if (!s || f === 0) return;
      weight += f * s.amount;
      addInto(vec, this.line(sid), f);
    });
    const p = { vec, weight };
    byFactors.set(factors, p);
    return p;
  }
}

function scale(v: LineageVector, f: number): LineageVector {
  const out: LineageVector = new Map();
  for (const [k, x] of v) out.set(k, x * f);
  return out;
}

function addInto(into: LineageVector, v: LineageVector, f: number): void {
  for (const [k, x] of v) into.set(k, (into.get(k) ?? 0) + x * f);
}

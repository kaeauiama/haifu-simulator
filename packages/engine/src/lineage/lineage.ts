/**
 * 来歴の計算（5.6、F7-04）。各仕訳が持つ「送信時点の送信側残高を構成した仕訳」を逆に辿り、
 * 送信時点の構成比で按分しながら一次仕訳まで遡る。計算はクリックされたときだけ行い、
 * 結果はこのオブジェクトを捨てるまで保持する。
 *
 * 覚えておくのは送信側の残高（プール）ごとの構成だけにし、同じプールから出た仕訳はまとめて扱う。
 * 仕訳1行ごとに構成を持つと、大きい規模（一次仕訳1万行・仕訳14万行）でメモリが足りなくなるため。
 */
import { objKey } from '../model/keys.ts';
import type { JournalLine, Ledger, ObjRef } from '../model/types.ts';

/** 一次仕訳 ID（または keyOf で決めたキー）→ 額（実数）。合計は辿った仕訳の額に一致する */
export type LineageVector = Map<string, number>;

/** 送信側の残高が0で構成比が決まらない分（活動配分で残高のない原価センタを貸方にした場合など） */
export const UNATTRIBUTED = '(来歴なし)';

interface Pooled {
  vec: LineageVector;
  /** Σ 倍率 × 額。送信時点の送信側残高 */
  weight: number;
}

type Sources = readonly string[];
type Factors = readonly number[] | undefined;

export class LineageTracer {
  private readonly byId = new Map<string, JournalLine>();
  private readonly pooled = new WeakMap<Sources, Map<Factors, Pooled>>();

  /**
   * @param keyOf 一次仕訳の行を、何のキーで集計するか。既定は一次仕訳 ID。発生元の対象で集計するなら対象キーを返す
   */
  constructor(
    private readonly ledger: Ledger,
    private readonly keyOf: (primary: JournalLine) => string = (l) => l.origin.rowId ?? l.id,
  ) {
    for (const l of ledger) this.byId.set(l.id, l);
  }

  /** 1行の来歴 */
  line(id: string): LineageVector {
    return this.lines([id]);
  }

  /** 複数行の来歴の和 */
  lines(ids: readonly string[]): LineageVector {
    return this.combine(ids, undefined).vec;
  }

  /**
   * 対象の残高の来歴。account を渡すとその勘定だけ、upToSteps を渡すとそのステップまでの仕訳だけを辿る。
   */
  balance(obj: ObjRef, opts: { account?: string; upToSteps?: ReadonlySet<string> } = {}): LineageVector {
    const k = objKey(obj);
    const ids: string[] = [];
    for (const l of this.ledger) {
      if (objKey(l.obj) !== k || (opts.account !== undefined && l.account !== opts.account) || (opts.upToSteps && !opts.upToSteps.has(l.stepId))) continue;
      ids.push(l.id);
    }
    return this.lines(ids);
  }

  /**
   * 仕訳の集まり（倍率つき）の来歴の和。一次仕訳はそのままキーに足し、生成仕訳は送信側のプールごとにまとめて
   * 「プールの構成 × (額の和 / プールの残高)」で足す。
   */
  private combine(sources: Sources, factors: Factors): Pooled {
    const vec: LineageVector = new Map();
    let weight = 0;
    const groups = new Map<Sources, Map<Factors, number>>();
    sources.forEach((sid, i) => {
      const s = this.byId.get(sid);
      const f = factors?.[i] ?? 1;
      if (!s || f === 0) return;
      const v = f * s.amount;
      weight += v;
      if (s.role === 'PRIMARY') {
        const key = this.keyOf(s);
        vec.set(key, (vec.get(key) ?? 0) + v);
        return;
      }
      let g = groups.get(s.origin.sourceLineIds);
      if (!g) groups.set(s.origin.sourceLineIds, (g = new Map()));
      g.set(s.origin.sourceFactors, (g.get(s.origin.sourceFactors) ?? 0) + v);
    });
    for (const [src, byFactors] of groups) {
      for (const [fac, coef] of byFactors) {
        const p = this.pool(src, fac);
        if (Math.abs(p.weight) < 1e-9) vec.set(UNATTRIBUTED, (vec.get(UNATTRIBUTED) ?? 0) + coef);
        else for (const [k, x] of p.vec) vec.set(k, (vec.get(k) ?? 0) + (x * coef) / p.weight);
      }
    }
    return { vec, weight };
  }

  private pool(sources: Sources, factors: Factors): Pooled {
    let byFactors = this.pooled.get(sources);
    if (!byFactors) this.pooled.set(sources, (byFactors = new Map()));
    const hit = byFactors.get(factors);
    if (hit) return hit;
    const p = this.combine(sources, factors);
    byFactors.set(factors, p);
    return p;
  }
}

/**
 * 端数処理（5.4）。按分は実数で計算してから円に丸め、差額を最大剰余法で配る。
 * 同順位は受信対象のキーの昇順で決め、結果を毎回同じにする。
 */
import { compareId } from '../model/keys.ts';
import type { Yen } from '../model/types.ts';

/** 浮動小数の誤差を吸収する許容幅 */
const tol = (x: number): number => Math.max(1e-9, Math.abs(x) * 1e-12);

/** 円への丸め（四捨五入、0から遠い側へ） */
export function roundYen(x: number): Yen {
  const a = Math.abs(x);
  const r = Math.floor(a + 0.5 + tol(a));
  return r === 0 ? 0 : x < 0 ? -r : r;
}

export interface Share {
  key: string;
  weight: number;
}

/** 'CCTR:2000' のような ObjRef キーは種類→識別子の順で、それ以外は文字列で比べる */
export function compareShareKey(a: string, b: string): number {
  const i = a.indexOf(':');
  const j = b.indexOf(':');
  if (i > 0 && j > 0) {
    const ta = a.slice(0, i);
    const tb = b.slice(0, j);
    if (ta !== tb) return ta < tb ? -1 : 1;
    return compareId(a.slice(i + 1), b.slice(j + 1));
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * total を weights で按分する（最大剰余法）。weights は 0 以上で、合計が正であること。
 * 戻り値は shares と同じ並びで、合計は必ず total に一致する。
 */
export function allocate(total: Yen, shares: readonly Share[]): Yen[] {
  const n = shares.length;
  const out = new Array<Yen>(n).fill(0);
  if (total === 0 || n === 0) return out;
  let sumW = 0;
  for (const s of shares) {
    if (s.weight < 0 || !Number.isFinite(s.weight)) throw new Error(`allocate: invalid weight ${s.weight} (${s.key})`);
    sumW += s.weight;
  }
  if (!(sumW > 0)) throw new Error('allocate: weight sum must be positive');

  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const rem = new Array<number>(n).fill(0);
  let assigned = 0;
  for (let i = 0; i < n; i++) {
    const exact = (abs * shares[i]!.weight) / sumW;
    let fl = Math.floor(exact);
    let r = exact - fl;
    if (r > 1 - tol(exact)) {
      fl += 1;
      r = 0;
    }
    out[i] = fl;
    rem[i] = r;
    assigned += fl;
  }

  let left = abs - assigned;
  if (left !== 0) {
    const order = [...Array(n).keys()].filter((i) => shares[i]!.weight > 0);
    const byRemDesc = (a: number, b: number) => {
      const d = rem[b]! - rem[a]!;
      return Math.abs(d) > 1e-9 ? d : compareShareKey(shares[a]!.key, shares[b]!.key);
    };
    if (left > 0) {
      order.sort(byRemDesc);
      for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k]!]! += 1;
    } else {
      // 許容幅で切り上げた分が多すぎたとき（まれ）。剰余が小さい側から戻す
      order.sort((a, b) => -byRemDesc(a, b));
      for (let k = 0; left < 0; k = (k + 1) % order.length, left++) out[order[k]!]! -= 1;
    }
  }
  if (sign < 0) for (let i = 0; i < n; i++) out[i] = out[i] === 0 ? 0 : -out[i]!;
  return out;
}

/**
 * 配分基準の正規化。合計の符号にそろえ、逆符号の重みは 0 として外す（P-07）。
 * 合計が 0 なら null（V-13 / V-10）。
 */
export function normalizeWeights(shares: readonly Share[]): { shares: Share[]; dropped: string[] } | null {
  let total = 0;
  for (const s of shares) total += s.weight;
  if (Math.abs(total) < 1e-12) return null;
  const sign = total < 0 ? -1 : 1;
  const out: Share[] = [];
  const dropped: string[] = [];
  for (const s of shares) {
    const w = s.weight * sign;
    if (w < 0) dropped.push(s.key);
    else if (w > 0) out.push({ key: s.key, weight: w });
  }
  return out.length === 0 ? null : { shares: out, dropped };
}

/**
 * 反復サイクルの連立方程式（5.3）。x_i = b_i + Σ_j M[i][j] x_j を解く。
 * M[i][j] は送信者 j から送信者 i へ流れる割合（送信割合 s_j × 重み w_ji）。
 */

/** これ以下の送信者数ならガウスの消去法で直接解く */
export const DIRECT_SOLVE_LIMIT = 200;
/** 繰り返し計算の上限回数 */
export const MAX_ITERATIONS = 100;
/** 繰り返し計算を止める差（円） */
export const CONVERGENCE_YEN = 1;

export interface SolveResult {
  x: number[];
  /** (I - M) の逆行列。直接解いたときだけ持つ。来歴の按分（x_j = Σ_i N[j][i] b_i）に使う */
  inverse?: number[][];
  singular: boolean;
  converged: boolean;
}

export function solveIterative(M: readonly (readonly number[])[], b: readonly number[]): SolveResult {
  const n = b.length;
  return n <= DIRECT_SOLVE_LIMIT ? solveDirect(M, b) : solveByIteration(M, b);
}

/** ガウス・ジョルダン法（部分ピボット）で (I - M) の逆行列を作り、x = N b とする */
function solveDirect(M: readonly (readonly number[])[], b: readonly number[]): SolveResult {
  const n = b.length;
  const a: number[][] = [];
  const inv: number[][] = [];
  for (let i = 0; i < n; i++) {
    a.push(Array.from({ length: n }, (_, j) => (i === j ? 1 : 0) - (M[i]![j] ?? 0)));
    inv.push(Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  }
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r]![col]!) > Math.abs(a[piv]![col]!)) piv = r;
    if (Math.abs(a[piv]![col]!) < 1e-12) return { x: [...b], singular: true, converged: false };
    [a[col], a[piv]] = [a[piv]!, a[col]!];
    [inv[col], inv[piv]] = [inv[piv]!, inv[col]!];
    const p = a[col]![col]!;
    for (let j = 0; j < n; j++) {
      a[col]![j]! /= p;
      inv[col]![j]! /= p;
    }
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = a[r]![col]!;
      if (f === 0) continue;
      for (let j = 0; j < n; j++) {
        a[r]![j]! -= f * a[col]![j]!;
        inv[r]![j]! -= f * inv[col]![j]!;
      }
    }
  }
  const x = inv.map((row) => row.reduce((s, v, j) => s + v * b[j]!, 0));
  return { x, inverse: inv, singular: false, converged: true };
}

/** ガウス・ザイデル法。差が1円未満になるまで（上限100回） */
function solveByIteration(M: readonly (readonly number[])[], b: readonly number[]): SolveResult {
  const n = b.length;
  const x = [...b];
  for (let it = 0; it < MAX_ITERATIONS; it++) {
    let maxDiff = 0;
    for (let i = 0; i < n; i++) {
      let v = b[i]!;
      const row = M[i]!;
      for (let j = 0; j < n; j++) if (row[j]) v += row[j]! * x[j]!;
      maxDiff = Math.max(maxDiff, Math.abs(v - x[i]!));
      x[i] = v;
    }
    if (!x.every(Number.isFinite)) return { x: [...b], singular: true, converged: false };
    if (maxDiff < CONVERGENCE_YEN) return { x, singular: false, converged: true };
  }
  return { x, singular: false, converged: false };
}

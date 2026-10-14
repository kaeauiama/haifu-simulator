/**
 * 図に描く線の上限。これを超える規模では、額の大きい順に上限まで描き、全体の本数を返す（画面に「表示 n／m」を出す）。
 * 計算には影響しない。
 */
export const DISPLAY_LIMITS = {
  /** 全体のフロー図の線 */
  flowEdges: 1500,
  /** 手法別ビューの線 */
  methodEdges: 1500,
  /** サンキー図の流れ */
  sankeyLinks: 400,
} as const;

/** 額の大きい順（同額は元の順）に上限まで残す */
export function topByAmount<T>(items: readonly T[], amount: (x: T) => number, limit: number): T[] {
  if (items.length <= limit) return [...items];
  return items
    .map((x, i) => ({ x, i, a: Math.abs(amount(x)) }))
    .sort((p, q) => q.a - p.a || p.i - q.i)
    .slice(0, limit)
    .sort((p, q) => p.i - q.i)
    .map((p) => p.x);
}

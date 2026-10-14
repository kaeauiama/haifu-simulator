import type { EdgeState, Method } from '@alloc-sim/engine';

/** 手法ごとに線の色を固定する（6章「表示の決めごと」） */
export const METHOD_COLOR: Record<Method, string> = {
  ACTIVITY: '#0f766e',
  OVERHEAD_CALC: '#a21caf',
  SETTLEMENT: '#c2410c',
  DIST: '#2563eb',
  ASSESS: '#16a34a',
  MA: '#7c3aed',
  TDD: '#a16207',
};

/** 線の状態ごとの見た目。オフにしたステップの線は破線 */
export const EDGE_STATE_STYLE: Record<EdgeState, { opacity: number; dash?: string }> = {
  done: { opacity: 1 },
  pending: { opacity: 0.3 },
  disabled: { opacity: 0.55, dash: '6 4' },
  unassigned: { opacity: 0.45, dash: '2 4' },
};

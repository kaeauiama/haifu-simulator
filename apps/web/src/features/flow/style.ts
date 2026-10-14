import type { EdgeState, Method, ObjTier, PartKind } from '@alloc-sim/engine';

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

/**
 * 金額の構成の色（D-046）。由来の役割ごとに固定する。並びは積み上げの順（PART_ORDER）で、
 * 参照パレットの順番どおりに割り当てているので、隣り合う色は色覚の違いがあっても見分けられる
 * （validate_palette：隣接の CVD ΔE ≥ 9.1、通常視 ≥ 19.6。黄・桃・水色は白地で 3:1 未満なので表表示を必ず用意する）
 */
export const PART_COLOR: Record<PartKind, string> = {
  DIRECT: '#2a78d6',
  CORPORATE: '#eb6834',
  SUPPORT: '#1baf7a',
  OPERATING: '#eda100',
  PROJECT: '#e87ba4',
  GOAL: '#008300',
  PC: '#4a3aa7',
  NONE: '#898781',
  SENT: '#e34948',
};

/** 対象そのものの役割の色（サンキー図のノードなど）。由来の色と同じ */
export const TIER_COLOR: Record<ObjTier, string> = {
  PC: PART_COLOR.PC,
  CORPORATE: PART_COLOR.CORPORATE,
  SUPPORT: PART_COLOR.SUPPORT,
  OPERATING: PART_COLOR.OPERATING,
  PROJECT: PART_COLOR.PROJECT,
  GOAL: PART_COLOR.GOAL,
};

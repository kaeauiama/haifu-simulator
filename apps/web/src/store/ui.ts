/** 画面の状態（取り消しの対象にしない） */
import type { CompositionMode, RuleKind, ViewMethod } from '@alloc-sim/engine';
import { create } from 'zustand';

export type Screen = 'main' | 'master' | 'postings' | 'compare' | 'io';
export type DetailTab = 'table' | 'journal' | 'lineage';
export type SideTab = 'rules' | 'issues' | 'totals';
export type FlowViewKind = 'ALL' | 'SANKEY' | 'COMPOSITION' | ViewMethod;
export type FlowLayout = 'auto' | 'columns';
export interface RuleRef {
  kind: RuleKind;
  id: string;
}

interface UiState {
  screen: Screen;
  /** 残高を見る時点（ステップ ID）。null は最後のステップの後 */
  cursor: string | null;
  selectedStepId: string | null;
  selectedObj: string | null;
  detailTab: DetailTab;
  sideTab: SideTab;
  /** フロー図で強調するルール */
  selectedRule: string | null;
  /** 編集ダイアログを開いているルール */
  editingRule: RuleRef | null;
  /** 中央の図：全体のフロー図か、手法別の関係ビューか */
  flowView: FlowViewKind;
  flowLayout: FlowLayout;
  /** 金額の構成の見方：直前の送り手か、発生元か */
  compositionMode: CompositionMode;
  /** 手法別ビューで表示しているサイクル */
  methodFocus: Partial<Record<ViewMethod, string>>;
  /** 比較画面の2案と、サンキー図に入れるステップ（null はすべて） */
  compareA: string | null;
  compareB: string | null;
  sankeySteps: string[] | null;
  presentation: boolean;
  set: (patch: Partial<Omit<UiState, 'set'>>) => void;
}

export const useUiStore = create<UiState>()((set) => ({
  screen: 'main',
  cursor: null,
  selectedStepId: null,
  selectedObj: null,
  detailTab: 'table',
  sideTab: 'rules',
  selectedRule: null,
  editingRule: null,
  flowView: 'ALL',
  flowLayout: 'auto',
  compositionMode: 'SOURCE',
  methodFocus: {},
  compareA: null,
  compareB: null,
  sankeySteps: null,
  presentation: false,
  set: (patch) => set(patch),
}));

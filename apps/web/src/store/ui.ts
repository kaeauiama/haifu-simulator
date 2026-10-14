/** 画面の状態（取り消しの対象にしない） */
import type { RuleKind } from '@alloc-sim/engine';
import { create } from 'zustand';

export type Screen = 'main' | 'master' | 'postings';
export type DetailTab = 'table' | 'journal' | 'lineage';
export type SideTab = 'rules' | 'issues' | 'totals';
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
  presentation: false,
  set: (patch) => set(patch),
}));

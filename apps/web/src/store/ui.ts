/** 画面の状態（取り消しの対象にしない） */
import { create } from 'zustand';

export type Screen = 'main' | 'master' | 'postings';
export type DetailTab = 'table' | 'journal' | 'lineage';

interface UiState {
  screen: Screen;
  /** 残高を見る時点（ステップ ID）。null は最後のステップの後 */
  cursor: string | null;
  selectedStepId: string | null;
  selectedObj: string | null;
  detailTab: DetailTab;
  presentation: boolean;
  set: (patch: Partial<Omit<UiState, 'set'>>) => void;
}

export const useUiStore = create<UiState>()((set) => ({
  screen: 'main',
  cursor: null,
  selectedStepId: null,
  selectedObj: null,
  detailTab: 'table',
  presentation: false,
  set: (patch) => set(patch),
}));

/**
 * プロジェクトのストア（Zustand + Immer、zundo で取り消し・やり直し）。
 * 画面で編集すると、ここがプロジェクトを更新する。計算はしない。
 */
import { sampleProject, type Project, type Scenario } from '@alloc-sim/engine';
import { temporal } from 'zundo';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

interface ProjectState {
  project: Project;
  scenarioId: string;
  /** プロジェクト全体を編集する（取り消しの対象） */
  edit: (recipe: (p: Project) => void) => void;
  /** いまのシナリオを編集する */
  editScenario: (recipe: (s: Scenario, p: Project) => void) => void;
  selectScenario: (id: string) => void;
  /** 読み込み・サンプル生成など、丸ごと入れ替える */
  replace: (project: Project, scenarioId?: string) => void;
}

const initial = sampleProject();

export const useProjectStore = create<ProjectState>()(
  temporal(
    immer((set) => ({
      project: initial,
      scenarioId: initial.scenarios[0]!.id,
      edit: (recipe) =>
        set((st) => {
          recipe(st.project);
        }),
      editScenario: (recipe) =>
        set((st) => {
          const s = st.project.scenarios.find((x) => x.id === st.scenarioId);
          if (s) recipe(s, st.project);
        }),
      selectScenario: (id) =>
        set((st) => {
          if (st.project.scenarios.some((s) => s.id === id)) st.scenarioId = id;
        }),
      replace: (project, scenarioId) =>
        set((st) => {
          st.project = project;
          st.scenarioId = scenarioId && project.scenarios.some((s) => s.id === scenarioId) ? scenarioId : project.scenarios[0]!.id;
        }),
    })),
    {
      partialize: (st) => ({ project: st.project, scenarioId: st.scenarioId }),
      limit: 100,
    },
  ),
);

export const useScenario = (): Scenario => useProjectStore((st) => st.project.scenarios.find((s) => s.id === st.scenarioId) ?? st.project.scenarios[0]!);

export const undo = () => useProjectStore.temporal.getState().undo();
export const redo = () => useProjectStore.temporal.getState().redo();

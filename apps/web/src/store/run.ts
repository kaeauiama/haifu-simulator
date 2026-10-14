/**
 * 計算結果のストアと、Worker との同期（7章「処理の流れ」）。
 * 画面で編集すると、300ミリ秒待ってから Worker に再計算を頼む。Worker は表示用の値を返し、画面はそれを出すだけ。
 */
import { PRIMARY_STEP_ID, type FlowGraph, type LineageView, type ObjectTableView, type RunSummary, type StepView } from '@alloc-sim/engine';
import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { engine } from '@/worker/client';
import { useProjectStore } from './project';
import { useUiStore } from './ui';

/** 編集してから再計算を頼むまでの待ち時間（7章） */
export const RECOMPUTE_DEBOUNCE_MS = 300;

interface RunState {
  version: number;
  summary: RunSummary | null;
  stepView: StepView | null;
  flowGraph: FlowGraph | null;
  objectTable: ObjectTableView | null;
  lineage: LineageView | null;
  running: boolean;
  error: string | null;
  elapsedMs: number | null;
}

export const useRunStore = create<RunState>()(() => ({
  version: -1,
  summary: null,
  stepView: null,
  flowGraph: null,
  objectTable: null,
  lineage: null,
  running: true,
  error: null,
  elapsedMs: null,
}));

/** カーソル（null や消えたステップ）を、実在する時点の ID にする。既定は最後のステップの後 */
export function resolveCursor(cursor: string | null, summary: RunSummary | null): string {
  if (!summary) return PRIMARY_STEP_ID;
  if (cursor && summary.steps.some((s) => s.id === cursor)) return cursor;
  return summary.steps[summary.steps.length - 1]!.id;
}

export const useCursorStepId = (): string => {
  const cursor = useUiStore((s) => s.cursor);
  const summary = useRunStore((s) => s.summary);
  return resolveCursor(cursor, summary);
};

/** App の最上位で1回だけ呼ぶ */
export function useEngineSync(): void {
  const project = useProjectStore((s) => s.project);
  const scenarioId = useProjectStore((s) => s.scenarioId);
  const latest = useRef(0);
  const first = useRef(true);

  useEffect(() => {
    useRunStore.setState({ running: true });
    const delay = first.current ? 0 : RECOMPUTE_DEBOUNCE_MS;
    first.current = false;
    const timer = setTimeout(async () => {
      const v = ++latest.current;
      try {
        const res = await engine.run(v, project, scenarioId);
        if (v !== latest.current) return;
        useRunStore.setState({ version: v, summary: res.summary, elapsedMs: res.elapsedMs, running: false, error: null });
      } catch (e) {
        if (v === latest.current) useRunStore.setState({ running: false, error: e instanceof Error ? e.message : String(e) });
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [project, scenarioId]);

  const version = useRunStore((s) => s.version);
  const stepId = useCursorStepId();
  const selectedObj = useUiStore((s) => s.selectedObj);
  const detailTab = useUiStore((s) => s.detailTab);

  useEffect(() => {
    if (version < 0) return;
    let cancelled = false;
    void (async () => {
      const [view, graph] = await Promise.all([engine.stepView(version, stepId), engine.flowGraph(version, stepId)]);
      if (!cancelled && view && graph) useRunStore.setState({ stepView: view, flowGraph: graph });
    })();
    return () => {
      cancelled = true;
    };
  }, [version, stepId]);

  useEffect(() => {
    if (version < 0) return;
    let cancelled = false;
    if (!selectedObj) {
      useRunStore.setState({ objectTable: null });
      return;
    }
    void (async () => {
      const t = await engine.objectTable(version, selectedObj);
      if (!cancelled && t) useRunStore.setState({ objectTable: t });
    })();
    return () => {
      cancelled = true;
    };
  }, [version, selectedObj]);

  // 来歴は、来歴タブを開いているときだけ計算する（5.6「クリックされたときだけ行う」）
  useEffect(() => {
    if (version < 0 || !selectedObj || detailTab !== 'lineage') {
      useRunStore.setState({ lineage: null });
      return;
    }
    let cancelled = false;
    void (async () => {
      const l = await engine.lineage(version, selectedObj, stepId);
      if (!cancelled && l) useRunStore.setState({ lineage: l });
    })();
    return () => {
      cancelled = true;
    };
  }, [version, selectedObj, stepId, detailTab]);
}

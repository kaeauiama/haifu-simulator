/**
 * エンジンを Web Worker で動かす（7章「再計算中も画面を止めない」）。
 * 最後に実行したセッションを持ち、画面からの問い合わせに表示用の値を返す。
 * version が古い問い合わせには null を返し、古い結果を画面に出さない。
 */
import { SimSession, type Project } from '@alloc-sim/engine';
import * as Comlink from 'comlink';

let session: SimSession | null = null;
let version = -1;

const current = (v: number): SimSession | null => (v === version ? session : null);

const api = {
  run(v: number, project: Project, scenarioId: string) {
    const t0 = performance.now();
    const s = new SimSession(project, scenarioId);
    session = s;
    version = v;
    return { version: v, summary: s.summary(), elapsedMs: performance.now() - t0 };
  },
  stepView(v: number, stepId: string) {
    return current(v)?.stepView(stepId) ?? null;
  },
  flowGraph(v: number, stepId: string) {
    return current(v)?.flowGraph(stepId) ?? null;
  },
  objectTable(v: number, key: string) {
    return current(v)?.objectTable(key) ?? null;
  },
  lineage(v: number, key: string, stepId: string) {
    return current(v)?.lineage(key, stepId) ?? null;
  },
};

export type EngineApi = typeof api;

Comlink.expose(api);

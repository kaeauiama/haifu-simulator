/**
 * エンジンを Web Worker で動かす（7章「再計算中も画面を止めない」）。
 * 最後に実行したセッションを持ち、画面からの問い合わせに表示用の値を返す。
 * version が古い問い合わせには null を返し、古い結果を画面に出さない。
 */
import { SimSession, type CompositionMode, type Project, type ViewMethod } from '@alloc-sim/engine';
import * as Comlink from 'comlink';

let session: SimSession | null = null;
let version = -1;
let project: Project | null = null;
/** 比較画面で使う、ほかのシナリオのセッション（同じ版のプロジェクトに対してだけ持つ） */
const others = new Map<string, SimSession>();

const current = (v: number): SimSession | null => (v === version ? session : null);

const sessionFor = (v: number, scenarioId: string): SimSession | null => {
  if (v !== version || !project) return null;
  if (session?.scenarioId === scenarioId) return session;
  let s = others.get(scenarioId);
  if (!s) others.set(scenarioId, (s = new SimSession(project, scenarioId)));
  return s;
};

const api = {
  run(v: number, p: Project, scenarioId: string) {
    const t0 = performance.now();
    const s = new SimSession(p, scenarioId);
    session = s;
    version = v;
    project = p;
    others.clear();
    return { version: v, summary: s.summary(), elapsedMs: performance.now() - t0 };
  },
  stepView(v: number, stepId: string) {
    return current(v)?.stepView(stepId) ?? null;
  },
  flowGraph(v: number, stepId: string) {
    return current(v)?.flowGraph(stepId) ?? null;
  },
  methodView(v: number, method: ViewMethod, stepId: string, focus: string | null) {
    return current(v)?.methodView(method, stepId, focus) ?? null;
  },
  objectTable(v: number, key: string) {
    return current(v)?.objectTable(key) ?? null;
  },
  lineage(v: number, key: string, stepId: string) {
    return current(v)?.lineage(key, stepId) ?? null;
  },
  compare(v: number, a: string, b: string) {
    const sa = sessionFor(v, a);
    const sb = sessionFor(v, b);
    return sa && sb ? sa.compareWith(sb) : null;
  },
  sankey(v: number, scenarioId: string, stepIds: string[] | null) {
    return sessionFor(v, scenarioId)?.sankey(stepIds ?? undefined) ?? null;
  },
  composition(v: number, stepId: string, mode: CompositionMode) {
    return current(v)?.composition(stepId, mode) ?? null;
  },
  journalCsv(v: number) {
    return current(v)?.journalCsv() ?? null;
  },
};

export type EngineApi = typeof api;

Comlink.expose(api);

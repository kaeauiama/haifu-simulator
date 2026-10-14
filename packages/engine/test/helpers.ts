import { runAll, type RunResult } from '../src/run.ts';
import { sampleProject } from '../src/seed/sampleCompany.ts';
import type { ClosingStep, Master, PrimaryPosting, Project, Scenario, StepKind } from '../src/model/types.ts';
import { objKey } from '../src/model/keys.ts';
import type { ObjRef } from '../src/model/types.ts';

export const cc = (id: string): ObjRef => ({ type: 'CCTR', id });
export const wbs = (id: string): ObjRef => ({ type: 'WBS', id });
export const seg = (id: string): ObjRef => ({ type: 'PSEG', id });

export function step(id: string, kind: StepKind, itemIds: string[], enabled = true): ClosingStep {
  return { id, name: id, kind, itemIds, enabled };
}

export function emptyScenario(steps: ClosingStep[], patch: Partial<Scenario> = {}): Scenario {
  return {
    id: 'S-TEST',
    name: 'テスト',
    cycles: [],
    tddRules: [],
    settlementRules: [],
    activityAllocs: [],
    costingSheets: [],
    steps,
    ...patch,
  };
}

/** サンプル商事を土台に、テスト用のシナリオと一次仕訳を差し替えたプロジェクト */
export function testProject(opts: {
  scenario: Scenario;
  postings?: PrimaryPosting[];
  extraPostings?: PrimaryPosting[];
  master?: (m: Master) => void;
}): Project {
  const p = sampleProject();
  if (opts.postings) p.primaryPostings = opts.postings;
  if (opts.extraPostings) p.primaryPostings.push(...opts.extraPostings);
  opts.master?.(p.master);
  p.scenarios = [opts.scenario];
  return p;
}

export const run = (p: Project, scenarioId = p.scenarios[0]!.id): RunResult => runAll(p, scenarioId);

export const finalOf = (r: RunResult) => r.snapshots.get(r.stepOrder[r.stepOrder.length - 1]!)!;

/** 最終残高（account 省略時は対象の全勘定合計） */
export function bal(r: RunResult, obj: ObjRef, account?: string): number {
  const f = finalOf(r);
  return account === undefined ? f.total(objKey(obj)) : f.get(objKey(obj), account);
}

export const codes = (r: RunResult): string[] => r.issues.map((i) => i.code);

export const linesOf = (r: RunResult, stepId: string) => r.ledger.filter((l) => l.stepId === stepId);

export function pp(id: string, account: string, obj: ObjRef, amount: number): PrimaryPosting {
  return { id, account, obj, amount };
}

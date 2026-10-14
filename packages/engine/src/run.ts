/**
 * runStep / runAll（5章）。エンジンは「仕訳の台帳」を状態として持つ純粋な関数。
 * ステップごとに、その時点の残高を読み、新しい仕訳を足して返す。
 * 順序を入れ替えた結果は、ステップ列を変えて再実行するだけで得られる。
 */
import { LedgerState, type ReadonlyBalanceIndex } from './ledger/balance.ts';
import { MasterIndex } from './ledger/masterIndex.ts';
import { runActivityAlloc, runRevaluation } from './methods/activity.ts';
import { runAllocationCycle } from './methods/allocation.ts';
import { Poster, type StepContext } from './methods/context.ts';
import { runCostingSheet } from './methods/overheadCalc.ts';
import { runSettlementStep } from './methods/settlement.ts';
import { runTDD } from './methods/tdd.ts';
import { objKey } from './model/keys.ts';
import {
  PRIMARY_STEP_ID,
  type ClosingStep,
  type Issue,
  type JournalLine,
  type Ledger,
  type Master,
  type ObjRef,
  type PrimaryPosting,
  type Project,
  type Scenario,
} from './model/types.ts';
import { mkIssue } from './validate/issues.ts';
import { checkReturnedAfterSending, checkUnallocated, checkZeroSum } from './validate/post.ts';
import { blockedRuleIds, validateStatic } from './validate/static.ts';

export type StepResult = { lines: JournalLine[]; issues: Issue[] };

export interface RunResult {
  scenarioId: string;
  ledger: Ledger;
  /** ステップ末の残高。キーは PRIMARY_STEP_ID（一次仕訳のみ）と各ステップの ID。オフのステップは直前と同じ */
  snapshots: Map<string, ReadonlyBalanceIndex>;
  /** スナップショットの並び（PRIMARY_STEP_ID が先頭） */
  stepOrder: string[];
  issues: Issue[];
}

/** 一次仕訳を台帳の行にする。統計 WBS への仕訳は責任原価センタの実績として扱う（P-10） */
export function primaryLines(postings: readonly PrimaryPosting[], mi: MasterIndex): StepResult {
  const lines: JournalLine[] = [];
  const issues: Issue[] = [];
  const rerouted = new Set<string>();
  for (const p of postings) {
    let obj: ObjRef = p.obj;
    if (mi.isStatisticalWbs(obj)) {
      const wbs = mi.wbs.get(obj.id)!;
      if (!rerouted.has(wbs.id)) {
        rerouted.add(wbs.id);
        issues.push(mkIssue('X-STAT-WBS', 'PRE', `${mi.label(obj)} → 原価センタ ${wbs.responsibleCctr}`, { obj }));
      }
      obj = { type: 'CCTR', id: wbs.responsibleCctr };
    }
    lines.push({
      id: `PRI#${p.id}`,
      stepId: PRIMARY_STEP_ID,
      docId: `PRI#${p.id}`,
      account: p.account,
      obj,
      profitCenter: mi.derivePC(obj),
      amount: p.amount,
      role: 'PRIMARY',
      origin: { ruleId: 'PRIMARY', rowId: p.id, sourceLineIds: [] },
    });
  }
  return { lines, issues };
}

/** 1ステップを実行し、追加の仕訳と検証結果を返す。state には仕訳が書き込まれる */
export function executeStep(state: LedgerState, step: ClosingStep, ctx: Omit<StepContext, 'step' | 'state'>): StepResult {
  const poster = new Poster({ ...ctx, step, state });
  const { scenario } = ctx;
  const find = <T extends { id: string }>(xs: readonly T[], id: string, what: string): T | undefined => {
    const x = xs.find((v) => v.id === id);
    if (!x) poster.issue('X-REF', `${step.name} の${what} ${id}`, { ruleId: id });
    return x;
  };
  switch (step.kind) {
    case 'ACTIVITY_ALLOC':
      for (const id of step.itemIds) {
        const a = find(scenario.activityAllocs, id, '活動配分');
        if (a) runActivityAlloc(a, poster);
      }
      break;
    case 'OVERHEAD_CALC':
      for (const id of step.itemIds) {
        const cs = find(scenario.costingSheets, id, '原価計算シート');
        if (cs) runCostingSheet(cs, poster);
      }
      break;
    case 'ALLOC_CYCLE':
      for (const id of step.itemIds) {
        const c = find(scenario.cycles, id, 'サイクル');
        if (c) runAllocationCycle(c, poster);
      }
      break;
    case 'TDD':
      for (const id of step.itemIds) {
        const r = find(scenario.tddRules, id, 'TDDルール');
        if (r) runTDD(r, poster);
      }
      break;
    case 'SETTLEMENT':
      runSettlementStep(step.itemIds, poster);
      break;
    case 'ACTUAL_RATE_REVAL':
      runRevaluation(step, poster);
      break;
    case 'MANUAL_REPOST':
      // F3-06 は MVP 外。実行前検証で X-UNSUPPORTED を出している
      break;
  }
  return { lines: poster.lines, issues: poster.issues };
}

/**
 * 台帳を受け取り、1ステップ分の仕訳を返す（4章の runStep）。入力の台帳は変更しない。
 * 前のステップの情報（実行済みステップ、配賦の送信者）は台帳とシナリオから組み立てる。
 */
export function runStep(ledger: Ledger, step: ClosingStep, ctx: { master: Master; scenario: Scenario }): StepResult {
  const mi = new MasterIndex(ctx.master);
  const state = new LedgerState();
  for (const l of ledger) state.push(l);
  const pos = ctx.scenario.steps.findIndex((s) => s.id === step.id);
  const executed = ctx.scenario.steps.slice(0, Math.max(0, pos)).filter((s) => s.enabled);
  const allocStepIds = new Set(executed.filter((s) => s.kind === 'ALLOC_CYCLE').map((s) => s.id));
  const allocSenders = new Set(ledger.filter((l) => l.role === 'SENDER' && allocStepIds.has(l.stepId)).map((l) => objKey(l.obj)));
  const project: Project = { schemaVersion: 1, master: ctx.master, primaryPostings: [], scenarios: [ctx.scenario] };
  const blocked = blockedRuleIds(validateStatic(project, ctx.scenario, mi));
  return executeStep(state, step, {
    mi,
    scenario: ctx.scenario,
    stepStart: state.balances.clone(),
    snapshots: new Map(),
    executed,
    blocked,
    allocSenders,
  });
}

/** シナリオの全ステップを順に実行する（F5-01）。結果は保存せず、いつでも作り直す */
export function runAll(project: Project, scenarioId: string): RunResult {
  const scenario = project.scenarios.find((s) => s.id === scenarioId);
  if (!scenario) throw new Error(`scenario not found: ${scenarioId}`);
  const mi = new MasterIndex(project.master);

  const pre = validateStatic(project, scenario, mi);
  const blocked = blockedRuleIds(pre);
  const issues: Issue[] = [...pre];

  const state = new LedgerState();
  const primary = primaryLines(project.primaryPostings, mi);
  issues.push(...primary.issues);
  for (const l of primary.lines) state.push(l);

  const snapshots = new Map<string, ReadonlyBalanceIndex>();
  const stepOrder = [PRIMARY_STEP_ID];
  let last: ReadonlyBalanceIndex = state.balances.clone();
  snapshots.set(PRIMARY_STEP_ID, last);

  const executed: ClosingStep[] = [];
  const allocSenders = new Set<string>();
  for (const step of scenario.steps) {
    stepOrder.push(step.id);
    if (!step.enabled) {
      snapshots.set(step.id, last);
      continue;
    }
    const res = executeStep(state, step, {
      mi,
      scenario,
      stepStart: last,
      snapshots,
      executed: [...executed],
      blocked,
      allocSenders,
    });
    issues.push(...res.issues);
    if (step.kind === 'ALLOC_CYCLE') for (const l of res.lines) if (l.role === 'SENDER') allocSenders.add(objKey(l.obj));
    executed.push(step);
    last = state.balances.clone();
    snapshots.set(step.id, last);
  }

  issues.push(
    ...checkReturnedAfterSending(state.lines, executed, mi),
    ...checkUnallocated(last, mi),
    ...checkZeroSum(project.primaryPostings, state.lines, last),
  );
  return { scenarioId, ledger: state.lines, snapshots, stepOrder, issues: dedupe(issues) };
}

function dedupe(issues: Issue[]): Issue[] {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const k = `${i.code}\u0000${i.stepId ?? ''}\u0000${i.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

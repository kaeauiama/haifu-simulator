/**
 * 画面向けのセッション。1回の実行結果を持ち、表示に要る値をすべてここで作って、
 * 構造化複製できる素のオブジェクトで返す（Web Worker から Comlink で渡す）。
 * 画面は金額を計算しない（CLAUDE.md）。合計・差分・来歴はすべてこのクラスが返す。
 */
import { describeRules, structuralEdges, type Method, type RuleKind } from './graph/rules.ts';
import type { ReadonlyBalanceIndex } from './ledger/balance.ts';
import { MasterIndex, segmentLabel } from './ledger/masterIndex.ts';
import { LineageTracer, UNATTRIBUTED } from './lineage/lineage.ts';
import { compareId, compareObj, objKey, parseObjKey } from './model/keys.ts';
import { PRIMARY_STEP_ID, type Issue, type ObjType, type Project, type Severity, type StepKind, type Yen } from './model/types.ts';
import { objectStepTable, totalsByProfitCenter, totalsBySegment } from './report/totals.ts';
import { runAll, type RunResult } from './run.ts';

export interface StepRow {
  id: string;
  /** 1始まりの並び順。一次仕訳だけの時点は 0 */
  index: number;
  name: string;
  kind: StepKind | 'PRIMARY';
  enabled: boolean;
  itemIds: string[];
  lineCount: number;
  /** そのステップで受信側に計上した額の合計 */
  receivedTotal: Yen;
  issueCounts: Record<Severity, number>;
}

export interface RunSummary {
  scenarioId: string;
  /** 先頭は一次仕訳だけの時点（PRIMARY） */
  steps: StepRow[];
  issues: Issue[];
  primaryTotal: Yen;
  finalTotal: Yen;
  zeroSumOk: boolean;
}

export interface ObjectRow {
  key: string;
  type: ObjType;
  id: string;
  name: string;
  label: string;
  profitCenter: string;
  balance: Yen;
  /** 直前の時点からの増減 */
  delta: Yen;
  /** 原価センタ・WBS（顧客プロジェクトと統計WBSを除く）に残高が残っている（V-16 の見た目） */
  residual: boolean;
}

export interface AmountRow {
  key: string;
  label: string;
  amount: Yen;
}

export interface LineRow {
  id: string;
  docId: string;
  ruleId: string;
  rowId?: string;
  role: 'PRIMARY' | 'SENDER' | 'RECEIVER';
  objKey: string;
  objLabel: string;
  partnerLabel?: string;
  account: string;
  accountName: string;
  profitCenter: string;
  amount: Yen;
}

export interface StepView {
  stepId: string;
  index: number;
  objects: ObjectRow[];
  byProfitCenter: AmountRow[];
  bySegment: AmountRow[];
  grandTotal: Yen;
  lines: LineRow[];
}

export interface ObjectTableView {
  objKey: string;
  label: string;
  accounts: { id: string; name: string }[];
  steps: { id: string; name: string }[];
  /** cells[勘定][時点] */
  cells: Yen[][];
  totals: Yen[];
}

export interface LineageRow {
  primaryId: string;
  objLabel: string;
  account: string;
  accountName: string;
  text: string;
  amount: number;
}

export interface LineageView {
  objKey: string;
  label: string;
  stepId: string;
  account?: string;
  balance: Yen;
  rows: LineageRow[];
  /** 一次仕訳まで遡れない額（P-19） */
  unattributed: number;
}

/** 線の状態（選んだ時点に対して）：実行済み／まだ先／ステップがオフ／どのステップにも入っていない */
export type EdgeState = 'done' | 'pending' | 'disabled' | 'unassigned';

export interface FlowNode extends ObjectRow {
  errors: number;
  warnings: number;
}

export interface FlowEdge {
  id: string;
  ruleKind: RuleKind;
  ruleId: string;
  ruleName: string;
  method: Method;
  source: string;
  target: string;
  /** 選んだ時点までに、この線で流れた額 */
  amount: Yen;
  state: EdgeState;
  /** ルールに出ている検証結果の重さ（情報は含めない） */
  severity: 'ERROR' | 'WARNING' | null;
}

export interface FlowGraph {
  stepId: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

const OBJ_ORDER: ObjType[] = ['PCTR', 'CCTR', 'WBS', 'ORD', 'PSEG'];

export class SimSession {
  readonly result: RunResult;
  readonly mi: MasterIndex;
  private tracer?: LineageTracer;

  constructor(
    readonly project: Project,
    readonly scenarioId: string,
  ) {
    this.mi = new MasterIndex(project.master);
    this.result = runAll(project, scenarioId);
  }

  private get scenario() {
    return this.project.scenarios.find((s) => s.id === this.scenarioId)!;
  }

  private snap(stepId: string): ReadonlyBalanceIndex {
    const s = this.result.snapshots.get(stepId);
    if (!s) throw new Error(`step not found: ${stepId}`);
    return s;
  }

  stepName(stepId: string): string {
    return stepId === PRIMARY_STEP_ID ? '一次仕訳' : (this.scenario.steps.find((s) => s.id === stepId)?.name ?? stepId);
  }

  accountName(id: string): string {
    return this.mi.accounts.get(id)?.name ?? '';
  }

  summary(): RunSummary {
    const { result } = this;
    const lineCount = new Map<string, number>();
    const received = new Map<string, number>();
    for (const l of result.ledger) {
      lineCount.set(l.stepId, (lineCount.get(l.stepId) ?? 0) + 1);
      if (l.role === 'RECEIVER') received.set(l.stepId, (received.get(l.stepId) ?? 0) + l.amount);
    }
    const counts = (stepId: string): Record<Severity, number> => {
      const c: Record<Severity, number> = { ERROR: 0, WARNING: 0, INFO: 0 };
      for (const i of result.issues) if (i.stepId === stepId) c[i.severity]++;
      return c;
    };
    const steps: StepRow[] = [
      {
        id: PRIMARY_STEP_ID,
        index: 0,
        name: '一次仕訳',
        kind: 'PRIMARY',
        enabled: true,
        itemIds: [],
        lineCount: lineCount.get(PRIMARY_STEP_ID) ?? 0,
        receivedTotal: 0,
        issueCounts: counts(PRIMARY_STEP_ID),
      },
      ...this.scenario.steps.map((s, i) => ({
        id: s.id,
        index: i + 1,
        name: s.name,
        kind: s.kind,
        enabled: s.enabled,
        itemIds: [...s.itemIds],
        lineCount: lineCount.get(s.id) ?? 0,
        receivedTotal: received.get(s.id) ?? 0,
        issueCounts: counts(s.id),
      })),
    ];
    const primaryTotal = this.project.primaryPostings.reduce((s, p) => s + p.amount, 0);
    const finalTotal = this.snap(result.stepOrder[result.stepOrder.length - 1]!).grandTotal();
    return { scenarioId: this.scenarioId, steps, issues: result.issues, primaryTotal, finalTotal, zeroSumOk: primaryTotal === finalTotal };
  }

  /** ある時点の対象ごとの残高と増減。マスタの対象は残高0でも出し、セグメントは台帳に現れたものも出す */
  private objectRows(stepId: string): ObjectRow[] {
    const order = this.result.stepOrder;
    const index = order.indexOf(stepId);
    const bal = this.snap(stepId);
    const prev = index > 0 ? this.snap(order[index - 1]!) : undefined;
    const { mi } = this;
    const keys = new Set<string>([
      ...[...mi.costCenters.keys()].map((id) => `CCTR:${id}`),
      ...[...mi.wbs.keys()].map((id) => `WBS:${id}`),
      ...[...mi.segments.keys()].map((id) => `PSEG:${id}`),
    ]);
    for (const s of order) for (const k of this.snap(s).objectKeys()) keys.add(k);
    return [...keys]
      .map((key) => {
        const obj = parseObjKey(key);
        const balance = bal.total(key);
        const residual =
          (obj.type === 'CCTR' || obj.type === 'WBS') && balance !== 0 && !mi.isStatisticalWbs(obj) && mi.attributedSegmentOf(obj) === undefined;
        return {
          key,
          type: obj.type,
          id: obj.id,
          name: mi.name(obj),
          label: mi.label(obj),
          profitCenter: mi.derivePC(obj),
          balance,
          delta: balance - (prev ? prev.total(key) : 0),
          residual,
        };
      })
      .sort((a, b) => OBJ_ORDER.indexOf(a.type) - OBJ_ORDER.indexOf(b.type) || compareObj(a, b));
  }

  /** ある時点（ステップ末）の残高。F5-02 の「各時点の残高」 */
  stepView(stepId: string): StepView {
    const order = this.result.stepOrder;
    const index = order.indexOf(stepId);
    if (index < 0) throw new Error(`step not found: ${stepId}`);
    const bal = this.snap(stepId);
    const { mi } = this;
    const objects = this.objectRows(stepId);

    const byProfitCenter = [...totalsByProfitCenter(bal, mi)]
      .sort(([a], [b]) => compareId(a, b))
      .map(([key, amount]) => ({ key, label: key ? `${key} ${mi.profitCenters.get(key)?.name ?? ''}`.trim() : '', amount }));
    const bySegment = [...totalsBySegment(bal, mi)]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, amount]) => ({ key, label: segmentLabel(key), amount }));

    const lines: LineRow[] = this.result.ledger
      .filter((l) => l.stepId === stepId)
      .map((l) => {
        const row: LineRow = {
          id: l.id,
          docId: l.docId,
          ruleId: l.origin.ruleId,
          role: l.role,
          objKey: objKey(l.obj),
          objLabel: mi.label(l.obj),
          account: l.account,
          accountName: this.accountName(l.account),
          profitCenter: l.profitCenter,
          amount: l.amount,
        };
        if (l.origin.rowId !== undefined) row.rowId = l.origin.rowId;
        if (l.partner) row.partnerLabel = mi.label(l.partner);
        return row;
      });

    return { stepId, index, objects, byProfitCenter, bySegment, grandTotal: bal.grandTotal(), lines };
  }

  /**
   * フロー図（F7-01）。ノードは対象、線はルール（同じルール・同じ送信と受信の組は1本）。
   * 線はルールの定義から導き、実際に流れた組も足す。金額は選んだ時点までの累計。
   */
  flowGraph(stepId: string): FlowGraph {
    const order = this.result.stepOrder;
    const cursor = order.indexOf(stepId);
    if (cursor < 0) throw new Error(`step not found: ${stepId}`);
    const sc = this.scenario;
    const issues = this.result.issues;

    const nodeCounts = new Map<string, { errors: number; warnings: number }>();
    const ruleSeverity = new Map<string, 'ERROR' | 'WARNING'>();
    for (const i of issues) {
      if (i.obj) {
        const c = nodeCounts.get(objKey(i.obj)) ?? { errors: 0, warnings: 0 };
        if (i.severity === 'ERROR') c.errors++;
        else if (i.severity === 'WARNING') c.warnings++;
        nodeCounts.set(objKey(i.obj), c);
      }
      if (i.ruleId && i.severity !== 'INFO' && ruleSeverity.get(i.ruleId) !== 'ERROR') ruleSeverity.set(i.ruleId, i.severity);
    }
    const nodes: FlowNode[] = this.objectRows(stepId).map((o) => ({ ...o, ...(nodeCounts.get(o.key) ?? { errors: 0, warnings: 0 }) }));

    const stepIndex = new Map(sc.steps.map((s, i) => [s.id, i + 1]));
    const enabled = new Map(sc.steps.map((s) => [s.id, s.enabled]));
    const rules = new Map(describeRules(sc).map((r) => [r.id, r]));
    const stateOf = (ruleId: string): EdgeState => {
      const steps = rules.get(ruleId)?.stepIds ?? [];
      if (!steps.length) return 'unassigned';
      const on = steps.filter((id) => enabled.get(id)).map((id) => stepIndex.get(id)!);
      if (!on.length) return 'disabled';
      return Math.min(...on) <= cursor ? 'done' : 'pending';
    };

    const amounts = new Map<string, number>();
    for (const l of this.result.ledger) {
      if (l.role !== 'RECEIVER' || !l.partner) continue;
      const idx = stepIndex.get(l.stepId);
      if (idx === undefined || idx > cursor) continue;
      const k = `${l.origin.ruleId}|${objKey(l.partner)}|${objKey(l.obj)}`;
      amounts.set(k, (amounts.get(k) ?? 0) + l.amount);
    }

    const edges = new Map<string, FlowEdge>();
    const add = (ruleId: string, source: string, target: string) => {
      const id = `${ruleId}|${source}|${target}`;
      const r = rules.get(ruleId);
      if (!r || edges.has(id) || source === target) return;
      edges.set(id, {
        id,
        ruleKind: r.kind,
        ruleId,
        ruleName: r.name,
        method: r.method,
        source,
        target,
        amount: amounts.get(id) ?? 0,
        state: stateOf(ruleId),
        severity: ruleSeverity.get(ruleId) ?? null,
      });
    };
    const final = this.snap(order[order.length - 1]!);
    for (const e of structuralEdges(sc, this.mi, final)) add(e.ruleId, objKey(e.sender), objKey(e.receiver));
    for (const l of this.result.ledger) if (l.role === 'RECEIVER' && l.partner) add(l.origin.ruleId, objKey(l.partner), objKey(l.obj));

    // 線の端がノードにない（参照切れなど）ものは描けないので外す
    const known = new Set(nodes.map((n) => n.key));
    return { stepId, nodes, edges: [...edges.values()].filter((e) => known.has(e.source) && known.has(e.target)) };
  }

  /** オブジェクトの「勘定×ステップ」の残高表（F7-03） */
  objectTable(key: string): ObjectTableView {
    const obj = parseObjKey(key);
    const t = objectStepTable(this.result, obj);
    return {
      objKey: key,
      label: this.mi.label(obj),
      accounts: t.accounts.map((id) => ({ id, name: this.accountName(id) })),
      steps: t.steps.map((id) => ({ id, name: this.stepName(id) })),
      cells: t.cells,
      totals: t.totals,
    };
  }

  /** ある時点の残高が、どの一次仕訳から来たか（F7-04） */
  lineage(key: string, stepId: string, account?: string): LineageView {
    const obj = parseObjKey(key);
    const order = this.result.stepOrder;
    const upTo = order.indexOf(stepId);
    if (upTo < 0) throw new Error(`step not found: ${stepId}`);
    this.tracer ??= new LineageTracer(this.result.ledger);
    const steps = new Set(order.slice(0, upTo + 1));
    const v = this.tracer.balance(obj, account === undefined ? { upToSteps: steps } : { account, upToSteps: steps });
    const postings = new Map(this.project.primaryPostings.map((p) => [p.id, p]));
    const rows: LineageRow[] = [];
    let unattributed = 0;
    for (const [id, amount] of v) {
      if (id === UNATTRIBUTED) {
        unattributed += amount;
        continue;
      }
      // 円に丸めて0になる寄与（按分の端数の名残）は出さない
      if (Math.abs(amount) < 0.5) continue;
      const p = postings.get(id);
      rows.push({
        primaryId: id,
        objLabel: p ? this.mi.label(p.obj) : '',
        account: p?.account ?? '',
        accountName: p ? this.accountName(p.account) : '',
        text: p?.text ?? '',
        amount,
      });
    }
    rows.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount) || compareId(a.primaryId, b.primaryId));
    const bal = this.snap(stepId);
    const view: LineageView = {
      objKey: key,
      label: this.mi.label(obj),
      stepId,
      balance: account === undefined ? bal.total(key) : bal.get(key, account),
      rows,
      unattributed,
    };
    if (account !== undefined) view.account = account;
    return view;
  }
}

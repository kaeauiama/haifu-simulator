/**
 * 画面向けのセッション。1回の実行結果を持ち、表示に要る値をすべてここで作って、
 * 構造化複製できる素のオブジェクトで返す（Web Worker から Comlink で渡す）。
 * 画面は金額を計算しない（CLAUDE.md）。合計・差分・来歴はすべてこのクラスが返す。
 */
import { compareRuns } from './compare/compare.ts';
import { buildMethodView, type MethodView, type ViewMethod } from './graph/methodView.ts';
import { buildSankey, type SankeyData } from './graph/sankey.ts';
import { buildComposition, originKeyOf, type CompositionMode, type CompositionView } from './graph/composition.ts';
import { DISPLAY_LIMITS, topByAmount } from './graph/limits.ts';
import { journalToCsv } from './io/csv.ts';
import { describeRules, structuralEdges, type Method, type RuleInfo, type RuleKind } from './graph/rules.ts';
import type { ReadonlyBalanceIndex } from './ledger/balance.ts';
import { MasterIndex } from './ledger/masterIndex.ts';
import { LineageTracer, UNATTRIBUTED } from './lineage/lineage.ts';
import { compareId, compareObj, objKey, parseObjKey } from './model/keys.ts';
import { PRIMARY_STEP_ID, TIER_ORDER, type Issue, type ObjTier, type ObjType, type Project, type Severity, type StepKind, type Yen } from './model/types.ts';
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
  /** 配賦上の役割（D-045） */
  tier: ObjTier;
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
  /** 線の本数（上限を超えたときは edges より多い。額の大きい順に上限まで描く） */
  totalEdges: number;
}

export interface CompareRow {
  key: string;
  label: string;
  a: Yen;
  b: Yen;
  diff: Yen;
}

export interface CompareStep {
  id: string;
  name: string;
  /** 1始まりの並び。その案にないステップは null */
  indexA: number | null;
  indexB: number | null;
  /** 両方にあり、そのステップで作った仕訳が違う（F4-04） */
  changed: boolean;
}

export interface CompareView {
  a: { id: string; name: string };
  b: { id: string; name: string };
  byProfitCenter: CompareRow[];
  bySegment: CompareRow[];
  /** マージン分析上の勘定別（P-22） */
  byAccount: CompareRow[];
  byObject: CompareRow[];
  steps: CompareStep[];
}

const OBJ_ORDER: ObjType[] = ['PCTR', 'CCTR', 'WBS', 'ORD', 'PSEG'];

export class SimSession {
  readonly result: RunResult;
  readonly mi: MasterIndex;
  private tracer?: LineageTracer;
  private originTracer?: LineageTracer;

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
    const hasPcCycles = this.scenario.cycles.some((c) => c.context === 'PCTR');
    const keys = new Set<string>([
      ...(hasPcCycles ? [...mi.profitCenters.keys()].map((id) => `PCTR:${id}`) : []),
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
          tier: mi.tierOf(obj),
          balance,
          delta: balance - (prev ? prev.total(key) : 0),
          residual,
        };
      })
      .sort(
        (a, b) =>
          TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) || OBJ_ORDER.indexOf(a.type) - OBJ_ORDER.indexOf(b.type) || compareObj(a, b),
      );
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
      .map(([key, amount]) => ({ key, label: mi.segmentName(key), amount }));

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
  private edgeKeyCache?: [string, string, string][];

  /** フロー図の線の組（ルール、送信、受信）。時点によらないので1回だけ作る */
  private edgeKeys(): [string, string, string][] {
    if (this.edgeKeyCache) return this.edgeKeyCache;
    const order = this.result.stepOrder;
    const seen = new Set<string>();
    const out: [string, string, string][] = [];
    const add = (ruleId: string, source: string, target: string) => {
      const k = `${ruleId}|${source}|${target}`;
      if (seen.has(k)) return;
      seen.add(k);
      out.push([ruleId, source, target]);
    };
    const final = this.snap(order[order.length - 1]!);
    for (const e of structuralEdges(this.scenario, this.mi, final)) add(e.ruleId, objKey(e.sender), objKey(e.receiver));
    for (const l of this.result.ledger) if (l.role === 'RECEIVER' && l.partner) add(l.origin.ruleId, objKey(l.partner), objKey(l.obj));
    return (this.edgeKeyCache = out);
  }

  /** 選んだ時点までの流れ、ルールの状態、検証の重さ（フロー図と手法別ビューで使う） */
  private flowIndex(stepId: string) {
    const order = this.result.stepOrder;
    const cursor = order.indexOf(stepId);
    if (cursor < 0) throw new Error(`step not found: ${stepId}`);
    const sc = this.scenario;
    const ruleSeverity = new Map<string, 'ERROR' | 'WARNING'>();
    for (const i of this.result.issues) {
      if (i.ruleId && i.severity !== 'INFO' && ruleSeverity.get(i.ruleId) !== 'ERROR') ruleSeverity.set(i.ruleId, i.severity);
    }
    const stepIndex = new Map(sc.steps.map((s, i) => [s.id, i + 1]));
    const enabled = new Map(sc.steps.map((s) => [s.id, s.enabled]));
    const rules = new Map<string, RuleInfo>(describeRules(sc).map((r) => [r.id, r]));
    const firstEnabled = (ruleId: string): number | null => {
      const on = (rules.get(ruleId)?.stepIds ?? []).filter((id) => enabled.get(id)).map((id) => stepIndex.get(id)!);
      return on.length ? Math.min(...on) : null;
    };
    const stateOf = (ruleId: string): EdgeState => {
      if (!(rules.get(ruleId)?.stepIds ?? []).length) return 'unassigned';
      const first = firstEnabled(ruleId);
      if (first === null) return 'disabled';
      return first <= cursor ? 'done' : 'pending';
    };
    const amounts = new Map<string, number>();
    for (const l of this.result.ledger) {
      if (l.role !== 'RECEIVER' || !l.partner) continue;
      const idx = stepIndex.get(l.stepId);
      if (idx === undefined || idx > cursor) continue;
      const k = `${l.origin.ruleId}|${objKey(l.partner)}|${objKey(l.obj)}`;
      amounts.set(k, (amounts.get(k) ?? 0) + l.amount);
    }
    return {
      cursor,
      rules,
      stateOf,
      severityOf: (ruleId: string) => ruleSeverity.get(ruleId) ?? null,
      amountOf: (ruleId: string, sender: string, receiver: string) => amounts.get(`${ruleId}|${sender}|${receiver}`) ?? 0,
      /** ルールを実行する最初のステップの開始時点の残高。ステップがなければ選んだ時点 */
      refSnapshot: (ruleId: string) => {
        const first = firstEnabled(ruleId);
        return this.snap(first === null ? stepId : order[first - 1]!);
      },
    };
  }

  /**
   * フロー図（F7-01）。ノードは対象、線はルール（同じルール・同じ送信と受信の組は1本）。
   * 線はルールの定義から導き、実際に流れた組も足す。金額は選んだ時点までの累計。
   */
  flowGraph(stepId: string): FlowGraph {
    const fi = this.flowIndex(stepId);
    const nodeCounts = new Map<string, { errors: number; warnings: number }>();
    for (const i of this.result.issues) {
      if (!i.obj) continue;
      const c = nodeCounts.get(objKey(i.obj)) ?? { errors: 0, warnings: 0 };
      if (i.severity === 'ERROR') c.errors++;
      else if (i.severity === 'WARNING') c.warnings++;
      nodeCounts.set(objKey(i.obj), c);
    }
    // 利益センタのノードは、その利益センタに導出される全対象の合計で見せる（P-23）
    const order0 = this.result.stepOrder;
    const idx = order0.indexOf(stepId);
    const pcNow = totalsByProfitCenter(this.snap(stepId), this.mi);
    const pcPrev = idx > 0 ? totalsByProfitCenter(this.snap(order0[idx - 1]!), this.mi) : new Map<string, number>();
    const nodes: FlowNode[] = this.objectRows(stepId).map((o) => {
      const pc = o.type === 'PCTR' ? { balance: pcNow.get(o.id) ?? 0, delta: (pcNow.get(o.id) ?? 0) - (pcPrev.get(o.id) ?? 0) } : {};
      return { ...o, ...pc, ...(nodeCounts.get(o.key) ?? { errors: 0, warnings: 0 }) };
    });
    const { rules } = fi;
    const order = this.result.stepOrder;

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
        amount: fi.amountOf(ruleId, source, target),
        state: fi.stateOf(ruleId),
        severity: fi.severityOf(ruleId),
      });
    };
    for (const [ruleId, source, target] of this.edgeKeys()) add(ruleId, source, target);

    // 線の端がノードにない（参照切れなど）ものは描けないので外す
    const known = new Set(nodes.map((n) => n.key));
    const all = [...edges.values()].filter((e) => known.has(e.source) && known.has(e.target));
    return { stepId, nodes, edges: topByAmount(all, (e) => e.amount, DISPLAY_LIMITS.flowEdges), totalEdges: all.length };
  }

  /** 手法ごとの関係ビュー。focus はサイクルのビューで表示するサイクル */
  methodView(method: ViewMethod, stepId: string, focus: string | null = null): MethodView {
    const fi = this.flowIndex(stepId);
    return buildMethodView(method, focus, {
      scenario: this.scenario,
      mi: this.mi,
      cursor: this.snap(stepId),
      refSnapshot: fi.refSnapshot,
      snapshot: (id) => this.result.snapshots.get(id),
      amount: fi.amountOf,
      state: fi.stateOf,
      severity: fi.severityOf,
    });
  }

  /** サンキー図の材料（F7-02）。stepIds を省くと、実行したすべてのステップ */
  sankey(stepIds?: readonly string[]): SankeyData {
    const ids = new Set(stepIds ?? this.scenario.steps.filter((s) => s.enabled).map((s) => s.id));
    return buildSankey(this.result.ledger, this.scenario, this.mi, ids);
  }

  /** この案（A）と別の案（B）の差（F8-02、F4-04）。同じプロジェクトのシナリオどうしで比べる */
  compareWith(other: SimSession): CompareView {
    const c = compareRuns(this.result, other.result, this.mi);
    const pcName = (k: string) => (k ? `${k} ${this.mi.profitCenters.get(k)?.name ?? ''}`.trim() : '');
    const withLabel = (rows: typeof c.byObject, label: (k: string) => string): CompareRow[] => rows.map((r) => ({ ...r, label: label(r.key) }));
    const stepsA = this.scenario.steps;
    const stepsB = other.scenario.steps;
    const changed = new Set(c.changedSteps);
    const steps: CompareStep[] = [
      ...stepsA.map((st, i) => {
        const j = stepsB.findIndex((x) => x.id === st.id);
        return { id: st.id, name: st.name, indexA: i + 1, indexB: j >= 0 ? j + 1 : null, changed: changed.has(st.id) };
      }),
      ...stepsB.filter((st) => !stepsA.some((x) => x.id === st.id)).map((st) => ({ id: st.id, name: st.name, indexA: null, indexB: stepsB.indexOf(st) + 1, changed: false })),
    ];
    return {
      a: { id: this.scenarioId, name: this.scenario.name },
      b: { id: other.scenarioId, name: other.scenario.name },
      byProfitCenter: withLabel(c.byProfitCenter, pcName),
      bySegment: withLabel(c.bySegment, (k) => this.mi.segmentName(k)),
      byAccount: withLabel(c.byAccount, (k) => `${k} ${this.accountName(k)}`.trim()),
      byObject: withLabel(c.byObject, (k) => this.mi.label(parseObjKey(k))),
      steps,
    };
  }

  /**
   * 金額の構成（D-046）。選んだ時点で各対象に溜まっている残高を、直課・送り手（または発生元）・配った額に分ける
   */
  composition(stepId: string, mode: CompositionMode): CompositionView {
    const order = this.result.stepOrder;
    const upTo = order.indexOf(stepId);
    if (upTo < 0) throw new Error(`step not found: ${stepId}`);
    const v = buildComposition(mode, {
      ledger: this.result.ledger,
      mi: this.mi,
      steps: new Set(order.slice(0, upTo + 1)),
      cursor: this.snap(stepId),
      originTracer: () => (this.originTracer ??= new LineageTracer(this.result.ledger, originKeyOf(this.mi))),
    });
    return { stepId, ...v };
  }

  /** 締めで作った仕訳の CSV（F9-04） */
  journalCsv(): string {
    return journalToCsv(this.result.ledger, this.mi, (id) => this.stepName(id));
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

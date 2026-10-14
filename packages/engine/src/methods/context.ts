import type { LedgerState, ReadonlyBalanceIndex } from '../ledger/balance.ts';
import type { MasterIndex } from '../ledger/masterIndex.ts';
import type { ClosingStep, Issue, JournalLine, ObjRef, Scenario, Yen } from '../model/types.ts';
import { mkIssue, type IssueCode, type IssueContext } from '../validate/issues.ts';

export interface StepContext {
  mi: MasterIndex;
  scenario: Scenario;
  step: ClosingStep;
  /** 実行中の台帳。Poster が書き込むと、同じステップの後続の処理にもすぐ見える */
  state: LedgerState;
  /** このステップ開始時点の残高（VARIABLE や参照データはこれを読む） */
  stepStart: ReadonlyBalanceIndex;
  /** 実行済みステップ末の残高（asOfStep 用） */
  snapshots: ReadonlyMap<string, ReadonlyBalanceIndex>;
  /** このステップより前に実行した（有効な）ステップ */
  executed: readonly ClosingStep[];
  /** 実行前検証でエラーになったルールの ID。仕訳を作らない */
  blocked: ReadonlySet<string>;
  /** これまでの配賦サイクルで送信者になった対象のキー（V-15 用） */
  allocSenders: ReadonlySet<string>;
}

export interface PostInput {
  obj: ObjRef;
  account: string;
  amount: Yen;
  role: 'SENDER' | 'RECEIVER';
  partner?: ObjRef;
  ruleId: string;
  rowId?: string;
  sourceLineIds: readonly string[];
  sourceFactors?: readonly number[];
}

export interface PairInput {
  sender: ObjRef;
  receiver: ObjRef;
  account: string;
  /** 受信側の額。送信側にはこの符号を反転して計上する */
  amount: Yen;
  ruleId: string;
  rowId?: string;
  sourceLineIds: readonly string[];
  sourceFactors?: readonly number[] | undefined;
}

/** 1ステップ分の仕訳の書き手。ID はステップ内の連番で決まり、毎回同じになる */
export class Poster {
  readonly lines: JournalLine[] = [];
  readonly issues: Issue[] = [];
  private seq = 0;
  private docSeq = 0;

  constructor(readonly ctx: StepContext) {}

  newDoc(): string {
    return `${this.ctx.step.id}#D${++this.docSeq}`;
  }

  post(docId: string, p: PostInput): void {
    if (p.amount === 0) return;
    const line: JournalLine = {
      id: `${this.ctx.step.id}#${++this.seq}`,
      stepId: this.ctx.step.id,
      docId,
      account: p.account,
      obj: p.obj,
      profitCenter: this.ctx.mi.derivePC(p.obj),
      amount: p.amount,
      role: p.role,
      origin: { ruleId: p.ruleId, sourceLineIds: p.sourceLineIds },
    };
    if (p.partner) line.partner = p.partner;
    if (p.rowId !== undefined) line.origin.rowId = p.rowId;
    if (p.sourceFactors) line.origin.sourceFactors = p.sourceFactors;
    this.lines.push(line);
    this.ctx.state.push(line);
  }

  /** 送信側を貸方、受信側を借方として、相手対象つきの2行を同じ勘定で計上する */
  pair(docId: string, p: PairInput): void {
    if (p.amount === 0) return;
    const common = { account: p.account, ruleId: p.ruleId, sourceLineIds: p.sourceLineIds };
    const extra = {
      ...(p.rowId !== undefined ? { rowId: p.rowId } : {}),
      ...(p.sourceFactors ? { sourceFactors: p.sourceFactors } : {}),
    };
    this.post(docId, { ...common, ...extra, obj: p.sender, amount: -p.amount, role: 'SENDER', partner: p.receiver });
    this.post(docId, { ...common, ...extra, obj: p.receiver, amount: p.amount, role: 'RECEIVER', partner: p.sender });
  }

  issue(code: IssueCode, detail: string, ctx: Omit<IssueContext, 'stepId'> = {}): void {
    this.issues.push(mkIssue(code, 'RUN', detail, { ...ctx, stepId: this.ctx.step.id }));
  }
}

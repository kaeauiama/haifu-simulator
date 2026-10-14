/**
 * 検証コードの一覧（5.5 の V-01〜V-17 と、エンジン独自の X-）。重さとメッセージの単一ソース。
 * メッセージは CLI と画面の既定文言。画面で言い換えるときは code で引く。
 */
import type { Issue, ObjRef, Severity } from '../model/types.ts';

export const ISSUE_DEFS = {
  'V-01': { severity: 'ERROR', title: '配布の送信勘定に二次原価が含まれる' },
  'V-02': { severity: 'ERROR', title: '配賦タイプで、配賦勘定が未設定か、カテゴリ42でない' },
  'V-03': { severity: 'ERROR', title: '統計WBSが、送信者か受信者になっている' },
  'V-04': { severity: 'ERROR', title: '決済の受信者が、決済プロファイルで許されていない' },
  'V-05': { severity: 'ERROR', title: '分配規則の%合計が100を超える' },
  'V-06': { severity: 'WARNING', title: '分配規則の%合計が100未満で、残高が残る' },
  'V-07': { severity: 'ERROR', title: 'WBS間の決済が循環している' },
  'V-08': { severity: 'WARNING', title: '同じWBSを2つのステップで決済している（実機では再決済に取消が要る）' },
  'V-09': { severity: 'ERROR', title: '属性として導出されたセグメントを、TDDの送信者にしている' },
  'V-10': { severity: 'ERROR', title: 'TDDの参照データが0円で、按分できない' },
  'V-11': { severity: 'WARNING', title: '前のステップで流し終えた対象に、後のステップで額が戻る' },
  'V-12': { severity: 'WARNING', title: '非反復サイクルで、処理済みの送信者に額が戻る' },
  'V-13': { severity: 'ERROR', title: '配分基準の合計が0' },
  'V-14': { severity: 'WARNING', title: '顧客プロジェクトのWBSに決済規則がある' },
  'V-15': { severity: 'WARNING', title: '間接費計算の貸方原価センタが、それより前に配賦済みでマイナスになる' },
  'V-16': { severity: 'INFO', title: '締め後に残高が残る（未配分）' },
  'V-17': { severity: 'ERROR', title: '一次仕訳の合計と、最終的な全対象の残高合計が一致しない（エンジンの不具合）' },

  'X-REF': { severity: 'ERROR', title: '参照先が見つからない' },
  'X-DUP-ID': { severity: 'ERROR', title: '識別子が重複している' },
  'X-UNSUPPORTED': { severity: 'ERROR', title: 'MVPでは扱わない組み方' },
  'X-SEG-ID': { severity: 'ERROR', title: 'セグメントの識別子が特性値の連結と一致しない' },
  'X-RECEIVER-TYPE': { severity: 'ERROR', title: 'この手法では使えない種類の対象' },
  'X-PCT-OVER': { severity: 'ERROR', title: '固定%の合計が100を超える' },
  'X-PCT-UNDER': { severity: 'INFO', title: '固定%の合計が100未満。残りは送信側に残る' },
  'X-NEG-WEIGHT': { severity: 'WARNING', title: '配分基準に合計と逆符号の値があり、0として扱った' },
  'X-EMPTY-ACCOUNTS': { severity: 'WARNING', title: '勘定の選択条件が空' },
  'X-NO-PROFILE': { severity: 'ERROR', title: 'WBSに決済プロファイルがない' },
  'X-SETTLE-ACCT': { severity: 'WARNING', title: '決済構造に該当がない勘定は決済しない' },
  'X-AMOUNT-OVER': { severity: 'WARNING', title: '金額指定の合計が残高を超えるため、比例して縮めた' },
  'X-ITER-DUP': { severity: 'ERROR', title: '反復サイクルで、同じ送信者が複数のセグメントにいる' },
  'X-ITER-SINGULAR': { severity: 'ERROR', title: '反復サイクルが解けない（送信者の間で額が回り続け、出口がない）' },
  'X-ITER-NOCONV': { severity: 'WARNING', title: '反復計算が上限回数で収束しなかった' },
  'X-STAT-WBS': { severity: 'INFO', title: '統計WBSへの一次仕訳を、責任原価センタの実績として扱った' },
  'X-NO-RATE': { severity: 'ERROR', title: '活動タイプに、送信原価センタの計画レートがない' },
  'X-RATE': { severity: 'INFO', title: '実績原価レート' },
  'X-ASOF': { severity: 'ERROR', title: '配分基準の asOfStep が、このステップより前にない' },
} as const satisfies Record<string, { severity: Severity; title: string }>;

export type IssueCode = keyof typeof ISSUE_DEFS;

export interface IssueContext {
  stepId?: string;
  ruleId?: string;
  obj?: ObjRef;
}

export function mkIssue(code: IssueCode, phase: Issue['phase'], detail: string, ctx: IssueContext = {}): Issue {
  const def = ISSUE_DEFS[code];
  const issue: Issue = {
    code,
    severity: def.severity,
    message: detail ? `${def.title}：${detail}` : def.title,
    phase,
  };
  if (ctx.stepId !== undefined) issue.stepId = ctx.stepId;
  if (ctx.ruleId !== undefined) issue.ruleId = ctx.ruleId;
  if (ctx.obj !== undefined) issue.obj = ctx.obj;
  return issue;
}

/** 金額の表示（桁区切り） */
export const fmtYen = (n: number): string => {
  const r = Math.round(n);
  const s = Math.abs(r)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return r < 0 ? `-${s}` : s;
};

import type { z } from 'zod';
import type {
  AccountCategorySchema,
  AccountSelectorSchema,
  ActivityAllocationSchema,
  ActivityTypeSchema,
  AllocSegmentSchema,
  AllocationCycleSchema,
  CharKeySchema,
  ClosingStepSchema,
  CostCenterSchema,
  CostingSheetSchema,
  DistributionRuleSchema,
  GLAccountSchema,
  GroupSchema,
  MasterSchema,
  ObjRefSchema,
  ObjSelectorSchema,
  ObjTypeSchema,
  PrimaryPostingSchema,
  ProfitCenterSchema,
  ProfitabilitySegmentSchema,
  ProjectSchema,
  ScenarioSchema,
  SegmentCharsSchema,
  SettlementProfileSchema,
  SettlementRuleSchema,
  StatKeyFigureSchema,
  StepKindSchema,
  TDDRuleSchema,
  TracingFactorSchema,
  WBSElementSchema,
} from './schema.ts';

// ---------- 共通 ----------
export type ObjType = z.infer<typeof ObjTypeSchema>;
export type ObjRef = z.infer<typeof ObjRefSchema>;
/** 整数。借方+、貸方- */
export type Yen = number;

// ---------- マスタ ----------
export type AccountCategory = z.infer<typeof AccountCategorySchema>;
export type GLAccount = z.infer<typeof GLAccountSchema>;
export type ProfitCenter = z.infer<typeof ProfitCenterSchema>;
export type CostCenter = z.infer<typeof CostCenterSchema>;
/**
 * 可視化で使う対象の役割（D-045）。利益センタ、コーポ部門・間接部門・直接部門（原価センタ）、
 * プロジェクト（間接費プロジェクトの WBS）、ゴール（収益性セグメントと顧客プロジェクト）。この順に左から右へ並べる
 */
export type ObjTier = 'PC' | 'CORPORATE' | 'SUPPORT' | 'OPERATING' | 'PROJECT' | 'GOAL';
export const TIER_ORDER: readonly ObjTier[] = ['PC', 'CORPORATE', 'SUPPORT', 'OPERATING', 'PROJECT', 'GOAL'];
export type WBSElement = z.infer<typeof WBSElementSchema>;
export type ActivityType = z.infer<typeof ActivityTypeSchema>;
export type StatKeyFigure = z.infer<typeof StatKeyFigureSchema>;
export type CharKey = z.infer<typeof CharKeySchema>;
export type SegmentChars = z.infer<typeof SegmentCharsSchema>;
export type ProfitabilitySegment = z.infer<typeof ProfitabilitySegmentSchema>;
export type PrimaryPosting = z.infer<typeof PrimaryPostingSchema>;
export type Group = z.infer<typeof GroupSchema>;
export type Master = z.infer<typeof MasterSchema>;

// ---------- 選択条件 ----------
export type ObjSelector = z.infer<typeof ObjSelectorSchema>;
export type AccountSelector = z.infer<typeof AccountSelectorSchema>;

// ---------- ルール ----------
export type TracingFactor = z.infer<typeof TracingFactorSchema>;
export type AllocSegment = z.infer<typeof AllocSegmentSchema>;
export type AllocationCycle = z.infer<typeof AllocationCycleSchema>;
export type TDDRule = z.infer<typeof TDDRuleSchema>;
export type SettlementProfile = z.infer<typeof SettlementProfileSchema>;
export type DistributionRule = z.infer<typeof DistributionRuleSchema>;
export type SettlementRule = z.infer<typeof SettlementRuleSchema>;
export type ActivityAllocation = z.infer<typeof ActivityAllocationSchema>;
export type CostingSheet = z.infer<typeof CostingSheetSchema>;
export type StepKind = z.infer<typeof StepKindSchema>;
export type ClosingStep = z.infer<typeof ClosingStepSchema>;
export type Scenario = z.infer<typeof ScenarioSchema>;
export type Project = z.infer<typeof ProjectSchema>;

// ---------- 結果（保存しない） ----------
/** 一次仕訳から作った台帳行の stepId */
export const PRIMARY_STEP_ID = 'PRIMARY';

/**
 * 仕訳の1行。4章の JournalLine に role と origin.sourceFactors を足している（D-007）。
 */
export interface JournalLine {
  id: string;
  stepId: string;
  docId: string;
  account: string;
  obj: ObjRef;
  /** 導出結果。導出できないときは空文字 */
  profitCenter: string;
  /** 相手対象（送信者／受信者） */
  partner?: ObjRef;
  amount: Yen;
  /** PRIMARY: 一次仕訳、SENDER: 送信側（貸方）、RECEIVER: 受信側（借方） */
  role: 'PRIMARY' | 'SENDER' | 'RECEIVER';
  origin: {
    /** 生成元のルール ID。一次仕訳は 'PRIMARY' */
    ruleId: string;
    /** ルール内の行（セグメント ID、分配規則の行番号など）。一次仕訳は一次仕訳 ID */
    rowId?: string;
    /** 送信時点で送信側残高を構成していた仕訳 */
    sourceLineIds: readonly string[];
    /** sourceLineIds と同じ並びの倍率。省略時はすべて 1（反復配賦でのみ使う） */
    sourceFactors?: readonly number[];
  };
}

export type Ledger = readonly JournalLine[];

export type Severity = 'ERROR' | 'WARNING' | 'INFO';

export interface Issue {
  /** V-01〜V-17 は要件 5.5、X- はエンジン独自の検査（D-004） */
  code: string;
  severity: Severity;
  message: string;
  /** PRE: 実行前、RUN: 実行中、POST: 実行後 */
  phase: 'PRE' | 'RUN' | 'POST';
  stepId?: string;
  ruleId?: string;
  obj?: ObjRef;
}

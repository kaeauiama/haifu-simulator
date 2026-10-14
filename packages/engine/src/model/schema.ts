/**
 * 4章の型定義を Zod スキーマとして持つ。型は z.infer で導出し、スキーマを唯一の正とする（D-003）。
 * JSON 読み込み（F9-01）と CSV 取り込み（F2-02）はこのスキーマで検査する。
 */
import { z } from 'zod';

// ---------- 共通 ----------
export const ObjTypeSchema = z.enum(['CCTR', 'PCTR', 'WBS', 'ORD', 'PSEG']);
export const ObjRefSchema = z.object({ type: ObjTypeSchema, id: z.string().min(1) });
/** 円の整数。借方+、貸方- */
export const YenSchema = z.number().int();

// ---------- マスタ ----------
export const AccountCategorySchema = z.enum(['REVENUE', 'PRIMARY', 'SEC21', 'SEC41', 'SEC42', 'SEC43']);
export const GLAccountSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  category: AccountCategorySchema,
});

export const ProfitCenterSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  groupId: z.string().optional(),
});

export const CostCenterKindSchema = z.enum(['ADMIN', 'PROD', 'SALES', 'SERVICE']);
/** 配賦上の役割（D-045）。コーポ部門 → 間接部門 → 直接部門 の順にお金が流れる。省くと区分から決める */
export const CostCenterTierSchema = z.enum(['CORPORATE', 'SUPPORT', 'OPERATING']);
export const CostCenterSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  profitCenter: z.string().min(1),
  kind: CostCenterKindSchema,
  tier: CostCenterTierSchema.optional(),
  groupId: z.string().optional(),
});

export const WBSElementSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  projectType: z.enum(['OVERHEAD', 'CUSTOMER']),
  responsibleCctr: z.string().min(1),
  profitCenter: z.string().min(1),
  statistical: z.boolean(),
  /** 顧客プロジェクトのみ。PSEG の id */
  attributedSegment: z.string().optional(),
  settlementProfileId: z.string().optional(),
});

export const ActivityTypeSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  unit: z.string(),
  allocAccount: z.string().min(1),
  rates: z.array(z.object({ cctr: z.string().min(1), planRate: YenSchema })),
});

export const StatKeyFigureSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  unit: z.string(),
  values: z.array(z.object({ obj: ObjRefSchema, value: z.number() })),
});

/** 収益性セグメント特性。この並びがセグメント識別子の連結順になる（D-005） */
export const CHAR_KEYS = ['customer', 'customerGroup', 'product', 'productGroup', 'region', 'profitCenter'] as const;
export const CharKeySchema = z.enum(CHAR_KEYS);

const charsShape = <T extends z.ZodType>(value: T) =>
  z.object({
    customer: value.optional(),
    customerGroup: value.optional(),
    product: value.optional(),
    productGroup: value.optional(),
    region: value.optional(),
    profitCenter: value.optional(),
  });

export const SegmentCharsSchema = charsShape(z.string().min(1));

export const ProfitabilitySegmentSchema = z.object({
  id: z.string().min(1),
  /** 表示名（D-051）。省くと特性値をつないだ名前（例：顧客A×PG1×PC20） */
  name: z.string().optional(),
  chars: SegmentCharsSchema,
  attributed: z.boolean(),
});

// 期中実績（一次仕訳）
export const PrimaryPostingSchema = z.object({
  id: z.string().min(1),
  account: z.string().min(1),
  obj: ObjRefSchema,
  amount: YenSchema,
  text: z.string().optional(),
});

// ---------- 選択条件 ----------
/**
 * FILTER の chars: キーを省略した特性は「何でもよい」、値 '*' は「未設定であること」を表す（D-006）。
 */
export const ObjSelectorSchema = z.discriminatedUnion('mode', [
  z.object({ type: ObjTypeSchema, mode: z.literal('LIST'), ids: z.array(z.string()) }),
  z.object({ type: ObjTypeSchema, mode: z.literal('RANGE'), from: z.string(), to: z.string() }),
  z.object({ type: ObjTypeSchema, mode: z.literal('GROUP'), groupId: z.string() }),
  z.object({ type: z.literal('PSEG'), mode: z.literal('FILTER'), chars: charsShape(z.string().min(1)) }),
]);
export const AccountSelectorSchema = z.array(z.object({ from: z.string(), to: z.string() }));

// ---------- Universal Allocation ----------
export const TracingFactorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('FIXED_PERCENT'), weights: z.array(z.object({ obj: ObjRefSchema, pct: z.number() })) }),
  z.object({ kind: z.literal('FIXED_PORTION'), weights: z.array(z.object({ obj: ObjRefSchema, portion: z.number() })) }),
  z.object({ kind: z.literal('SKF'), skfId: z.string() }),
  /** 受信側の実績額で按分 */
  z.object({ kind: z.literal('VARIABLE'), accounts: AccountSelectorSchema, asOfStep: z.string().optional() }),
]);

export const AllocSegmentSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  /** sharePct: 送信割合 */
  sender: z.object({ objects: ObjSelectorSchema, accounts: AccountSelectorSchema, sharePct: z.number() }),
  receiver: z.object({ objects: ObjSelectorSchema, factor: TracingFactorSchema }),
  /** 配賦タイプで必須（SEC42） */
  allocAccount: z.string().optional(),
});

export const AllocationCycleSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  context: z.enum(['CCTR', 'PCTR', 'MA']),
  type: z.enum(['DISTRIBUTION', 'OVERHEAD']),
  iterative: z.boolean(),
  segments: z.array(AllocSegmentSchema),
});

// TDD
export const TDDRuleSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  sender: z.object({ segments: ObjSelectorSchema, accounts: AccountSelectorSchema }),
  /** 細分化する特性 */
  distributeChars: z.array(CharKeySchema),
  reference: z.object({ accounts: AccountSelectorSchema, source: z.literal('CURRENT_PERIOD') }),
});

// ---------- 決済 ----------
export const SettlementProfileSchema = z.object({
  id: z.string().min(1),
  allowed: z.array(ObjTypeSchema),
  /** settleAccount: 決済用の二次勘定、または 'KEEP'（元の勘定のまま） */
  structure: z.array(z.object({ accounts: AccountSelectorSchema, settleAccount: z.string().min(1) })),
});

export const DistributionRuleSchema = z.object({
  receiver: ObjRefSchema,
  basis: z.enum(['PCT', 'EQUIV', 'AMOUNT']),
  value: z.number(),
  settlementType: z.enum(['PER', 'FUL']),
  /** 期間番号 */
  validFrom: z.number().int(),
  validTo: z.number().int().optional(),
});

export const SettlementRuleSchema = z.object({
  id: z.string().min(1),
  sender: ObjRefSchema,
  rules: z.array(DistributionRuleSchema),
});

// ---------- 活動配分・間接費 ----------
export const ActivityAllocationSchema = z.object({
  id: z.string().min(1),
  senderCctr: z.string().min(1),
  activityType: z.string().min(1),
  receiver: ObjRefSchema,
  quantity: z.number(),
});

export const CostingSheetSchema = z.object({
  id: z.string().min(1),
  rows: z.array(
    z.object({
      base: AccountSelectorSchema,
      ratePct: z.number(),
      creditCctr: z.string().min(1),
      overheadAccount: z.string().min(1),
    }),
  ),
  targets: z.array(ObjRefSchema),
});

// ---------- 締めステップ ----------
export const StepKindSchema = z.enum([
  'OVERHEAD_CALC',
  'ACTIVITY_ALLOC',
  'ALLOC_CYCLE',
  'ACTUAL_RATE_REVAL',
  'SETTLEMENT',
  'TDD',
  'MANUAL_REPOST',
]);

export const ClosingStepSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  kind: StepKindSchema,
  itemIds: z.array(z.string()),
  enabled: z.boolean(),
});

// ---------- シナリオ・プロジェクト ----------
export const ScenarioSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  memo: z.string().optional(),
  cycles: z.array(AllocationCycleSchema),
  tddRules: z.array(TDDRuleSchema),
  settlementRules: z.array(SettlementRuleSchema),
  activityAllocs: z.array(ActivityAllocationSchema),
  costingSheets: z.array(CostingSheetSchema),
  steps: z.array(ClosingStepSchema),
});

export const GroupSchema = z.object({
  id: z.string().min(1),
  type: ObjTypeSchema,
  name: z.string(),
  members: z.array(z.string()),
});

export const MasterSchema = z.object({
  /** 管理領域（F1-01、D-019） */
  controllingArea: z.string().optional(),
  /** 会社コード（F1-01、D-019） */
  companyCode: z.string().optional(),
  period: z.number().int(),
  currency: z.literal('JPY'),
  accounts: z.array(GLAccountSchema),
  profitCenters: z.array(ProfitCenterSchema),
  costCenters: z.array(CostCenterSchema),
  wbs: z.array(WBSElementSchema),
  activityTypes: z.array(ActivityTypeSchema),
  skfs: z.array(StatKeyFigureSchema),
  segments: z.array(ProfitabilitySegmentSchema),
  settlementProfiles: z.array(SettlementProfileSchema),
  groups: z.array(GroupSchema),
});

export const ProjectSchema = z.object({
  schemaVersion: z.literal(1),
  master: MasterSchema,
  primaryPostings: z.array(PrimaryPostingSchema),
  scenarios: z.array(ScenarioSchema),
});

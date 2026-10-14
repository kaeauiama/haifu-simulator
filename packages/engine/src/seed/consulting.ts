/**
 * サンプル「みずなぎコンサルティング」（架空の IT コンサルティング会社、D-054）。1か月分（2026年10月）の値。
 *
 * - SAP・クラウド・戦略の3事業部（利益センタ）と本社。コンサルタントは事業部の原価センタに所属し、
 *   職位別の活動タイプ（パートナー・マネージャー・シニア・コンサルタント）で案件（顧客プロジェクトの WBS）へ工数を配分する。
 * - 売上は案件の WBS に計上し、案件の属性セグメント（顧客×業種×サービス）で顧客別の収益性を見る（P-08）。
 * - 実績原価レートの再評価で、稼働しなかった時間（ベンチ）と事業部の間接費を案件に乗せるかどうかを比べられる。
 * - 数字は公表資料の傾向（SAP 案件の月額単価、稼働率、営業利益率など）に合わせた架空の値。根拠は README。
 */
import { segmentKey } from '../model/keys.ts';
import type { AllocationCycle, GLAccount, Master, ObjRef, PrimaryPosting, Project, Scenario, TracingFactor } from '../model/types.ts';
import { stepsFromTemplate } from './template.ts';

export const CONSULTING_PERIOD = 202610;

const ACCOUNTS: GLAccount[] = [
  { id: '41100000', name: 'コンサルティング売上（準委任）', category: 'REVENUE' },
  { id: '41200000', name: 'コンサルティング売上（請負・定額）', category: 'REVENUE' },
  { id: '41300000', name: '保守運用売上（月額）', category: 'REVENUE' },
  { id: '51000000', name: '給与手当', category: 'PRIMARY' },
  { id: '51200000', name: '法定福利費', category: 'PRIMARY' },
  { id: '52000000', name: '外注費（ビジネスパートナー）', category: 'PRIMARY' },
  { id: '53000000', name: '旅費交通費', category: 'PRIMARY' },
  { id: '54000000', name: '採用費', category: 'PRIMARY' },
  { id: '54100000', name: '研修費', category: 'PRIMARY' },
  { id: '55000000', name: '地代家賃', category: 'PRIMARY' },
  { id: '55100000', name: '共益費・水道光熱費', category: 'PRIMARY' },
  { id: '56000000', name: 'ソフトウェア利用料（SaaS）', category: 'PRIMARY' },
  { id: '57000000', name: '減価償却費', category: 'PRIMARY' },
  { id: '59000000', name: '広告宣伝・セミナー費', category: 'PRIMARY' },
  { id: '59100000', name: '交際費・その他経費', category: 'PRIMARY' },
  { id: '94100000', name: '配賦（本社費）', category: 'SEC42' },
  { id: '94110000', name: '配賦（営業費）', category: 'SEC42' },
  { id: '94150000', name: '配賦（事業部共通費）', category: 'SEC42' },
  { id: '94200000', name: '品質管理費（間接費計算）', category: 'SEC41' },
  { id: '94300000', name: '活動配分（コンサル工数）', category: 'SEC43' },
  { id: '94900000', name: '決済', category: 'SEC21' },
];

const R = {
  revenue: { from: '41000000', to: '49999999' },
  allCosts: { from: '50000000', to: '99999999' },
  office: { from: '55000000', to: '55199999' },
} as const;

// ---------- 事業部と職位 ----------
type Grade = 'PTN' | 'MGR' | 'SNR' | 'CON';
const GRADES: readonly Grade[] = ['PTN', 'MGR', 'SNR', 'CON'];
const GRADE_NAME: Record<Grade, string> = { PTN: 'パートナー', MGR: 'マネージャー', SNR: 'シニアコンサルタント', CON: 'コンサルタント' };
/** 1か月の所定時間 */
const MONTH_HOURS = 160;

interface Practice {
  cctr: string;
  pc: 'PC20' | 'PC30' | 'PC40';
  /** 収益性セグメントの「製品グループ」に入れるサービスの区分 */
  service: 'SAP' | 'CLOUD' | 'STRAT';
  name: string;
  headcount: Record<Grade, number>;
  /** 1人あたりの月の給与（賞与の引当を含む） */
  pay: Record<Grade, number>;
  /** 計画の原価レート（円/時間） */
  costRate: Record<Grade, number>;
  /** 請求単価（円/人月） */
  billRate: Record<Grade, number>;
  /** 座席数（フリーアドレス） */
  seats: number;
}

const PAY = { PTN: 2_500_000, MGR: 1_250_000, SNR: 850_000, CON: 580_000 };
export const PRACTICES: readonly Practice[] = [
  {
    cctr: '2000',
    pc: 'PC20',
    service: 'SAP',
    name: 'SAPプラクティス',
    headcount: { PTN: 2, MGR: 8, SNR: 18, CON: 22 },
    pay: PAY,
    costRate: { PTN: 30_000, MGR: 12_000, SNR: 8_500, CON: 6_000 },
    billRate: { PTN: 6_000_000, MGR: 3_300_000, SNR: 2_400_000, CON: 1_750_000 },
    seats: 30,
  },
  {
    cctr: '3000',
    pc: 'PC30',
    service: 'CLOUD',
    name: 'クラウドプラクティス',
    headcount: { PTN: 1, MGR: 5, SNR: 10, CON: 14 },
    pay: PAY,
    costRate: { PTN: 30_000, MGR: 12_000, SNR: 8_500, CON: 6_000 },
    billRate: { PTN: 6_000_000, MGR: 3_300_000, SNR: 2_400_000, CON: 1_750_000 },
    seats: 18,
  },
  {
    cctr: '4000',
    pc: 'PC40',
    service: 'STRAT',
    name: '戦略プラクティス',
    headcount: { PTN: 2, MGR: 4, SNR: 6, CON: 8 },
    pay: { PTN: 2_750_000, MGR: 1_375_000, SNR: 935_000, CON: 638_000 },
    costRate: { PTN: 33_000, MGR: 13_000, SNR: 9_500, CON: 6_500 },
    billRate: { PTN: 9_000_000, MGR: 4_500_000, SNR: 3_300_000, CON: 2_400_000 },
    seats: 12,
  },
];
const practiceOf = (cctr: string) => PRACTICES.find((p) => p.cctr === cctr)!;

// ---------- 顧客と案件 ----------
const CUSTOMERS = {
  A: { name: '製造A社', industry: 'MFG' },
  B: { name: '金融B社', industry: 'FIN' },
  C: { name: '流通C社', industry: 'RTL' },
  D: { name: '流通D社', industry: 'RTL' },
  E: { name: '製造E社', industry: 'MFG' },
} as const;
type CustomerId = keyof typeof CUSTOMERS;
const SERVICE_NAME = { SAP: 'SAP', CLOUD: 'クラウド', STRAT: '戦略' } as const;

interface Engagement {
  id: string;
  name: string;
  customer: CustomerId;
  practice: string;
  /** 準委任（工数×請求単価）、請負・定額、保守運用の月額 */
  billing: 'TM' | 'FIXED' | 'MONTHLY';
  /** 定額・月額の今月の売上（準委任は工数から計算） */
  fixedRevenue?: number;
  hours: Partial<Record<Grade, number>>;
  /** ビジネスパートナー（外注）の人数と1人あたりの原価・請求単価 */
  bp?: { people: number; cost: number; bill: number };
  travel?: number;
}

export const ENGAGEMENTS: readonly Engagement[] = [
  { id: 'C-101', name: '製造A社 S/4HANA新規導入', customer: 'A', practice: '2000', billing: 'FIXED', fixedRevenue: 42_000_000, hours: { PTN: 24, MGR: 480, SNR: 960, CON: 1_280 }, bp: { people: 4, cost: 1_400_000, bill: 1_900_000 }, travel: 800_000 },
  { id: 'C-102', name: '金融B社 S/4HANA移行', customer: 'B', practice: '2000', billing: 'TM', hours: { PTN: 16, MGR: 320, SNR: 640, CON: 640 }, bp: { people: 2, cost: 1_400_000, bill: 1_900_000 } },
  { id: 'C-103', name: '流通C社 SAP保守運用（AMS）', customer: 'C', practice: '2000', billing: 'MONTHLY', fixedRevenue: 15_000_000, hours: { SNR: 320, CON: 800 }, bp: { people: 4, cost: 625_000, bill: 0 } },
  { id: 'C-104', name: '製造E社 SAP追加開発', customer: 'E', practice: '2000', billing: 'TM', hours: { MGR: 160, SNR: 480, CON: 320 } },
  { id: 'C-201', name: '製造A社 クラウド基盤構築', customer: 'A', practice: '3000', billing: 'TM', hours: { MGR: 160, SNR: 480, CON: 640 }, bp: { people: 2, cost: 1_300_000, bill: 1_800_000 }, travel: 400_000 },
  { id: 'C-202', name: '流通D社 データ基盤・生成AI活用', customer: 'D', practice: '3000', billing: 'FIXED', fixedRevenue: 24_000_000, hours: { PTN: 24, MGR: 320, SNR: 480, CON: 640 } },
  { id: 'C-203', name: '金融B社 クラウド運用（月額）', customer: 'B', practice: '3000', billing: 'MONTHLY', fixedRevenue: 9_000_000, hours: { SNR: 160, CON: 480 } },
  { id: 'C-301', name: '金融B社 DX構想策定', customer: 'B', practice: '4000', billing: 'TM', hours: { PTN: 80, MGR: 320, SNR: 320, CON: 480 }, travel: 300_000 },
  { id: 'C-302', name: '製造E社 中期経営計画の策定支援', customer: 'E', practice: '4000', billing: 'FIXED', fixedRevenue: 16_000_000, hours: { PTN: 60, MGR: 160, SNR: 320, CON: 320 }, travel: 500_000 },
];

/** 準委任の売上＝工数÷所定時間×請求単価＋外注の請求額 */
export const revenueOf = (e: Engagement): number => {
  if (e.fixedRevenue !== undefined) return e.fixedRevenue;
  const p = practiceOf(e.practice);
  const staff = GRADES.reduce((t, g) => t + ((e.hours[g] ?? 0) / MONTH_HOURS) * p.billRate[g], 0);
  return Math.round(staff + (e.bp ? e.bp.people * e.bp.bill : 0));
};

/** 社内の案件（提案活動とテンプレート開発）の工数 */
const INTERNAL_HOURS: { wbs: string; practice: string; hours: Partial<Record<Grade, number>> }[] = [
  { wbs: 'P-901', practice: '2000', hours: { PTN: 120, MGR: 120 } },
  { wbs: 'P-901', practice: '3000', hours: { PTN: 60, MGR: 120 } },
  { wbs: 'P-901', practice: '4000', hours: { PTN: 80, MGR: 80 } },
  { wbs: 'P-902', practice: '2000', hours: { MGR: 80, SNR: 160, CON: 160 } },
];

const custChars = (e: Engagement) => {
  const p = practiceOf(e.practice);
  return { customer: e.customer, customerGroup: CUSTOMERS[e.customer].industry, productGroup: p.service, profitCenter: p.pc };
};
const engagementSeg = (e: Engagement) => segmentKey(custChars(e));
const practiceSeg = (p: Practice) => segmentKey({ productGroup: p.service, profitCenter: p.pc });

/** 顧客×サービスのセグメント（案件の属性）と、事業部（顧客未設定）のセグメント */
export const CONSULT_SEG = {
  ...Object.fromEntries(ENGAGEMENTS.map((e) => [`${e.customer}_${practiceOf(e.practice).service}`, engagementSeg(e)])),
  ...Object.fromEntries(PRACTICES.map((p) => [p.service, practiceSeg(p)])),
} as Record<string, string>;

const cc = (id: string): ObjRef => ({ type: 'CCTR', id });
const wbs = (id: string): ObjRef => ({ type: 'WBS', id });
const seg = (id: string): ObjRef => ({ type: 'PSEG', id });

// ---------- 本社部門 ----------
interface Dept {
  id: string;
  name: string;
  kind: 'ADMIN' | 'SALES' | 'SERVICE';
  tier: 'CORPORATE' | 'SUPPORT' | 'OPERATING';
  hc: number;
  pay: number;
  seats: number;
}
const HQ_DEPTS: Dept[] = [
  { id: '1000', name: '経営企画・経理部', kind: 'ADMIN', tier: 'CORPORATE', hc: 6, pay: 850_000, seats: 6 },
  { id: '1010', name: '人事・採用部', kind: 'ADMIN', tier: 'CORPORATE', hc: 5, pay: 750_000, seats: 5 },
  { id: '1090', name: 'オフィス（本社）', kind: 'ADMIN', tier: 'CORPORATE', hc: 0, pay: 0, seats: 0 },
  { id: '1100', name: '社内IT', kind: 'SERVICE', tier: 'SUPPORT', hc: 3, pay: 800_000, seats: 3 },
  { id: '1200', name: '人材開発', kind: 'SERVICE', tier: 'SUPPORT', hc: 2, pay: 800_000, seats: 2 },
  { id: '1300', name: '品質管理・PMO室', kind: 'SERVICE', tier: 'SUPPORT', hc: 3, pay: 950_000, seats: 3 },
  { id: '1400', name: '営業本部', kind: 'SALES', tier: 'SUPPORT', hc: 5, pay: 1_050_000, seats: 5 },
  { id: '1500', name: 'マーケティング', kind: 'SALES', tier: 'SUPPORT', hc: 2, pay: 800_000, seats: 2 },
];
const practiceHc = (p: Practice) => GRADES.reduce((t, g) => t + p.headcount[g], 0);
const ALL_HC: { id: string; hc: number }[] = [...HQ_DEPTS.filter((d) => d.hc > 0).map((d) => ({ id: d.id, hc: d.hc })), ...PRACTICES.map((p) => ({ id: p.cctr, hc: practiceHc(p) }))];
const others = (...except: string[]) => ALL_HC.map((x) => x.id).filter((id) => !except.includes(id));

const master: Master = {
  controllingArea: 'A000',
  companyCode: '4010',
  period: CONSULTING_PERIOD,
  currency: 'JPY',
  accounts: ACCOUNTS,
  profitCenters: [
    { id: 'PC10', name: '本社', groupId: 'PCG-ALL' },
    { id: 'PC20', name: 'SAP事業部', groupId: 'PCG-ALL' },
    { id: 'PC30', name: 'クラウド事業部', groupId: 'PCG-ALL' },
    { id: 'PC40', name: '戦略コンサルティング事業部', groupId: 'PCG-ALL' },
  ],
  costCenters: [
    ...HQ_DEPTS.map((d) => ({ id: d.id, name: d.name, profitCenter: 'PC10', kind: d.kind, tier: d.tier, groupId: 'CCG-HQ' })),
    ...PRACTICES.map((p) => ({ id: p.cctr, name: p.name, profitCenter: p.pc, kind: 'SERVICE' as const, tier: 'OPERATING' as const, groupId: 'CCG-PRACTICE' })),
  ],
  wbs: [
    ...ENGAGEMENTS.map((e) => ({
      id: e.id,
      name: e.name,
      projectType: 'CUSTOMER' as const,
      responsibleCctr: e.practice,
      profitCenter: practiceOf(e.practice).pc,
      statistical: false,
      attributedSegment: engagementSeg(e),
    })),
    { id: 'P-901', name: '提案活動（新規案件）', projectType: 'OVERHEAD', responsibleCctr: '1400', profitCenter: 'PC10', statistical: false, settlementProfileId: 'SP-INT' },
    { id: 'P-902', name: 'SAP導入テンプレートの開発', projectType: 'OVERHEAD', responsibleCctr: '2000', profitCenter: 'PC20', statistical: false, settlementProfileId: 'SP-INT' },
    { id: 'P-903', name: '新人・資格研修', projectType: 'OVERHEAD', responsibleCctr: '1200', profitCenter: 'PC10', statistical: false, settlementProfileId: 'SP-INT' },
  ],
  activityTypes: GRADES.map((g) => ({
    id: g,
    name: `${GRADE_NAME[g]}工数`,
    unit: '時間',
    allocAccount: '94300000',
    rates: PRACTICES.map((p) => ({ cctr: p.cctr, planRate: p.costRate[g] })),
  })),
  skfs: [
    { id: 'HC', name: '人員', unit: '人', values: ALL_HC.map((x) => ({ obj: cc(x.id), value: x.hc })) },
    {
      id: 'SEATS',
      name: '座席数',
      unit: '席',
      values: [...HQ_DEPTS.filter((d) => d.seats > 0).map((d) => ({ obj: cc(d.id), value: d.seats })), ...PRACTICES.map((p) => ({ obj: cc(p.cctr), value: p.seats }))],
    },
  ],
  segments: [
    ...[...new Map(ENGAGEMENTS.map((e) => [engagementSeg(e), e])).values()].map((e) => ({
      id: engagementSeg(e),
      name: `${CUSTOMERS[e.customer].name} × ${SERVICE_NAME[practiceOf(e.practice).service]}`,
      chars: custChars(e),
      attributed: true,
    })),
    ...PRACTICES.map((p) => ({ id: practiceSeg(p), name: `${SERVICE_NAME[p.service]}事業部（顧客未設定）`, chars: { productGroup: p.service, profitCenter: p.pc }, attributed: false })),
  ],
  settlementProfiles: [
    {
      id: 'SP-INT',
      allowed: ['CCTR', 'WBS', 'PSEG'],
      structure: [
        { accounts: [R.revenue], settleAccount: 'KEEP' },
        { accounts: [R.allCosts], settleAccount: '94900000' },
      ],
    },
  ],
  groups: [
    { id: 'PCG-ALL', type: 'PCTR', name: '全社', members: ['PC10', 'PC20', 'PC30', 'PC40'] },
    { id: 'CCG-HQ', type: 'CCTR', name: '本社部門', members: HQ_DEPTS.map((d) => d.id) },
    { id: 'CCG-PRACTICE', type: 'CCTR', name: '事業部（コンサルタント）', members: PRACTICES.map((p) => p.cctr) },
  ],
};

// ---------- 一次仕訳 ----------
const postings: PrimaryPosting[] = [];
let seq = 0;
const P = (account: string, obj: ObjRef, amount: number, text: string) => {
  postings.push({ id: `PP-${String(++seq).padStart(3, '0')}`, account, obj, amount, text });
};

// 売上（案件の WBS へ）と、案件に直接かかる外注費・旅費
const REVENUE_ACCOUNT = { TM: '41100000', FIXED: '41200000', MONTHLY: '41300000' } as const;
for (const e of ENGAGEMENTS) {
  P(REVENUE_ACCOUNT[e.billing], wbs(e.id), -revenueOf(e), `${e.name} 売上（${{ TM: '準委任', FIXED: '請負・進捗', MONTHLY: '月額' }[e.billing]}）`);
  if (e.bp) P('52000000', wbs(e.id), e.bp.people * e.bp.cost, `${e.name} ビジネスパートナー ${e.bp.people}名`);
  if (e.travel) P('53000000', wbs(e.id), e.travel, `${e.name} 出張旅費`);
}

// 給与（事業部は職位別）
for (const p of PRACTICES) {
  for (const g of GRADES) {
    const amount = p.headcount[g] * p.pay[g];
    P('51000000', cc(p.cctr), amount, `${p.name} ${GRADE_NAME[g]} 給与（${p.headcount[g]}人）`);
    P('51200000', cc(p.cctr), Math.round(amount * 0.15), `${p.name} ${GRADE_NAME[g]} 法定福利費`);
  }
}
for (const d of HQ_DEPTS.filter((x) => x.hc > 0)) {
  P('51000000', cc(d.id), d.hc * d.pay, `${d.name} 給与（${d.hc}人）`);
  P('51200000', cc(d.id), Math.round(d.hc * d.pay * 0.15), `${d.name} 法定福利費`);
}

// 本社の経費
P('59100000', cc('1000'), 800_000, '監査・税務の報酬');
P('54000000', cc('1010'), 4_000_000, '採用費（エージェント手数料・求人広告）');
P('56000000', cc('1100'), 2_500_000, 'SaaS（グループウェア・CRM・勤怠）');
P('57000000', cc('1100'), 1_000_000, 'PC・ネットワーク機器');
P('54100000', cc('1200'), 1_200_000, '外部研修・資格取得の支援');
P('59100000', cc('1400'), 1_200_000, '交際費・営業経費');
P('59000000', cc('1500'), 2_000_000, 'セミナー・展示会');
P('59000000', cc('1500'), 800_000, 'Web広告');
P('55000000', cc('1090'), 9_000_000, '本社オフィス賃料');
P('55100000', cc('1090'), 1_200_000, '共益費・水道光熱費');
P('54100000', wbs('P-903'), 1_500_000, '新人研修・資格研修（外部講師）');

// ---------- ルール ----------
const skf = (skfId: string): TracingFactor => ({ kind: 'SKF', skfId });
const list = (type: 'CCTR' | 'WBS' | 'PSEG', ids: string[]) => ({ type, mode: 'LIST' as const, ids });
const assess = (id: string, name: string, senders: string[], receiver: AllocationCycle['segments'][number]['receiver'], allocAccount: string) => ({
  id,
  name,
  sender: { objects: list('CCTR', senders), accounts: [R.allCosts], sharePct: 100 },
  receiver,
  allocAccount,
});
const toPractices = (weights: [string, number][]) => ({
  objects: list('PSEG', weights.map(([s]) => CONSULT_SEG[s]!)),
  factor: { kind: 'FIXED_PORTION' as const, weights: weights.map(([s, portion]) => ({ obj: seg(CONSULT_SEG[s]!), portion })) },
});
const toOne = (segId: string) => ({ objects: list('PSEG', [segId]), factor: { kind: 'FIXED_PERCENT' as const, weights: [{ obj: seg(segId), pct: 100 }] } });

let aa = 0;
const activityAllocs = [
  ...ENGAGEMENTS.flatMap((e) => GRADES.filter((g) => e.hours[g]).map((g) => ({ senderCctr: e.practice, activityType: g, receiver: wbs(e.id), quantity: e.hours[g]! }))),
  ...INTERNAL_HOURS.flatMap((x) => GRADES.filter((g) => x.hours[g]).map((g) => ({ senderCctr: x.practice, activityType: g, receiver: wbs(x.wbs), quantity: x.hours[g]! }))),
].map((a) => ({ id: `AA-${String(++aa).padStart(2, '0')}`, ...a }));

/** 事業部共通費（マーケティング）を事業部へ。売上の比に近い固定比率 */
const MARKETING_SPLIT: [string, number][] = [
  ['SAP', 50],
  ['CLOUD', 28],
  ['STRAT', 22],
];
const maCycle = (extra: AllocationCycle['segments'] = []): AllocationCycle => ({
  id: 'CY-MA',
  name: '事業部共通費 → 事業部',
  context: 'MA',
  type: 'OVERHEAD',
  iterative: false,
  segments: [assess('MA-01', 'マーケティング → 事業部（固定比率）', ['1500'], toPractices(MARKETING_SPLIT), '94150000'), ...extra],
});
const salesCycle: AllocationCycle = {
  id: 'CY-SALES',
  name: '営業本部費 → 案件',
  context: 'CCTR',
  type: 'OVERHEAD',
  iterative: false,
  segments: [assess('SL-01', '営業本部 → 顧客案件（売上の比）', ['1400'], { objects: list('WBS', ENGAGEMENTS.map((e) => e.id)), factor: { kind: 'VARIABLE', accounts: [R.revenue] } }, '94110000')],
};

const rules: Omit<Scenario, 'id' | 'name' | 'memo' | 'steps'> = {
  activityAllocs,
  costingSheets: [
    {
      id: 'CS-01',
      rows: [
        {
          base: [
            { from: '52000000', to: '52099999' },
            { from: '94300000', to: '94300000' },
          ],
          ratePct: 3,
          creditCctr: '1300',
          overheadAccount: '94200000',
        },
      ],
      targets: ENGAGEMENTS.map((e) => wbs(e.id)),
    },
  ],
  settlementRules: [
    { id: 'SR-P903', sender: wbs('P-903'), rules: [{ receiver: cc('1200'), basis: 'PCT', value: 100, settlementType: 'FUL', validFrom: 202604 }] },
    {
      id: 'SR-P901',
      sender: wbs('P-901'),
      // 提案に使った工数の比で事業部へ
      rules: [
        { receiver: seg(CONSULT_SEG.SAP!), basis: 'EQUIV', value: 504, settlementType: 'FUL', validFrom: 202604 },
        { receiver: seg(CONSULT_SEG.CLOUD!), basis: 'EQUIV', value: 324, settlementType: 'FUL', validFrom: 202604 },
        { receiver: seg(CONSULT_SEG.STRAT!), basis: 'EQUIV', value: 368, settlementType: 'FUL', validFrom: 202604 },
      ],
    },
    { id: 'SR-P902', sender: wbs('P-902'), rules: [{ receiver: seg(CONSULT_SEG.SAP!), basis: 'PCT', value: 100, settlementType: 'FUL', validFrom: 202604 }] },
  ],
  cycles: [
    {
      id: 'CY-DIST',
      name: 'オフィス費の配布',
      context: 'CCTR',
      type: 'DISTRIBUTION',
      iterative: false,
      segments: [
        {
          id: 'DS-01',
          name: 'オフィス → 各部門（座席数）',
          sender: { objects: list('CCTR', ['1090']), accounts: [R.office], sharePct: 100 },
          receiver: { objects: list('CCTR', others()), factor: skf('SEATS') },
        },
      ],
    },
    {
      id: 'CY-ASSESS',
      name: '本社費の配賦（反復）',
      context: 'CCTR',
      type: 'OVERHEAD',
      iterative: true,
      segments: [
        assess('AS-01', '人事・採用部 → 各部門（人員）', ['1010'], { objects: list('CCTR', others('1010')), factor: skf('HC') }, '94100000'),
        assess('AS-02', '社内IT → 各部門（人員）', ['1100'], { objects: list('CCTR', others('1100')), factor: skf('HC') }, '94100000'),
        assess('AS-03', '経営企画・経理部、人材開発、PMO → 事業部（人員）', ['1000', '1200', '1300'], { objects: list('CCTR', PRACTICES.map((p) => p.cctr)), factor: skf('HC') }, '94100000'),
      ],
    },
    salesCycle,
    maCycle(),
  ],
  tddRules: [],
};

const items = {
  'ST-01': activityAllocs.map((a) => a.id),
  'ST-02': ['CS-01'],
  'ST-03': ['SR-P903'],
  'ST-04': ['CY-DIST'],
  'ST-05': ['CY-ASSESS', 'CY-SALES'],
  'ST-07': ['SR-P901', 'SR-P902'],
  'ST-08': ['CY-MA'],
};

const defaultScenario: Scenario = {
  id: 'S-DEFAULT',
  name: '標準：工数は実績原価で、ベンチも案件に乗せる',
  memo: '事業部の費用（給与・本社費・オフィス費）を、実績原価レートの再評価で、工数の比ですべて案件に乗せる。稼働しなかった時間（ベンチ）の費用も案件の原価になる。営業本部費は売上の比で案件へ。',
  ...rules,
  steps: stepsFromTemplate(items),
};

/** ベンチの費用を案件に乗せず、事業部（顧客未設定）に残す案 */
const benchScenario: Scenario = {
  id: 'S-BENCH',
  name: 'ベンチの費用は事業部に残す',
  memo: '実績原価レートの再評価（ステップ6）をオフにして、案件には計画の原価レートで工数を乗せる。稼働しなかった時間と事業部の間接費は、マージン分析で事業部（顧客未設定）へ配る。案件の利益は良く見え、事業部の稼働率の差が見える。',
  ...rules,
  cycles: rules.cycles.map((c) =>
    c.id === 'CY-MA' ? maCycle(PRACTICES.map((p, i) => assess(`MA-0${i + 2}`, `${p.name}の残り（ベンチ・間接費）→ ${SERVICE_NAME[p.service]}事業部`, [p.cctr], toOne(practiceSeg(p)), '94150000'))) : c,
  ),
  steps: stepsFromTemplate(items).map((s) => (s.id === 'ST-06' ? { ...s, enabled: false } : s)),
};

/** 営業本部費を案件に配らず、事業部へ配る案 */
const salesScenario: Scenario = {
  id: 'S-SALES',
  name: '営業本部費は案件に配らず事業部へ',
  memo: '営業本部費を案件の原価にせず、マーケティングと同じく事業部（顧客未設定）へ配る案。案件別の損益は良く見えるが、事業部の損益は変わらない。',
  ...rules,
  cycles: rules.cycles.map((c) => (c.id === 'CY-MA' ? maCycle([assess('MA-05', '営業本部 → 事業部（固定比率）', ['1400'], toPractices(MARKETING_SPLIT), '94110000')]) : c)),
  steps: stepsFromTemplate({ ...items, 'ST-05': ['CY-ASSESS'] }),
};

const CONSULTING: Project = { schemaVersion: 1, master, primaryPostings: postings, scenarios: [defaultScenario, benchScenario, salesScenario] };

/** みずなぎコンサルティングのプロジェクト（毎回新しい写しを返す） */
export const consultingProject = (): Project => structuredClone(CONSULTING);

/**
 * サンプル「さざなみ電力」（架空の地域電力会社、社内カンパニー制、D-054）。1か月分（2026年10月）の値。
 *
 * - 発電・送配電・小売の3カンパニーとコーポレートを利益センタで分ける（送配電の法的分離の対象外の規模を想定）。
 * - 社内取引は活動配分で表す。発電所 → 小売の電力調達部へ「社内電力取引（MWh）」を社内取引価格で、
 *   送配電の託送プール → 小売の託送料へ「託送（MWh、電圧別）」を託送料金で振り替える。社外向けの卸と託送も同じ単価で振り替える（内外無差別）。
 * - 各カンパニーの損益は、発電・送配電は残った差額（振替収入 − 原価）をカンパニーのセグメントへ、小売は顧客区分×地域のセグメントへ配賦して見る。
 * - 数字は公表資料の傾向（託送料金の電圧別単価、燃料費の割合、卸市場の価格など）に合わせた架空の値。根拠は README。
 */
import { segmentKey } from '../model/keys.ts';
import type { AllocationCycle, GLAccount, Master, ObjRef, PrimaryPosting, Project, Scenario, TracingFactor } from '../model/types.ts';
import { stepsFromTemplate } from './template.ts';

export const UTILITY_PERIOD = 202610;

// ---------- 勘定科目 ----------
const ACCOUNTS: GLAccount[] = [
  { id: '41100000', name: '電灯料収入（低圧）', category: 'REVENUE' },
  { id: '41200000', name: '電力料収入（高圧・特別高圧）', category: 'REVENUE' },
  { id: '41300000', name: '卸電力販売収入', category: 'REVENUE' },
  { id: '41400000', name: '託送収益（他社小売）', category: 'REVENUE' },
  { id: '51000000', name: '給与手当', category: 'PRIMARY' },
  { id: '51200000', name: '法定福利費', category: 'PRIMARY' },
  { id: '52000000', name: '燃料費（LNG）', category: 'PRIMARY' },
  { id: '52100000', name: '燃料費（石炭）', category: 'PRIMARY' },
  { id: '52500000', name: '購入電力料（卸市場）', category: 'PRIMARY' },
  { id: '53000000', name: '修繕費', category: 'PRIMARY' },
  { id: '53100000', name: '修繕材料費', category: 'PRIMARY' },
  { id: '54000000', name: '委託費', category: 'PRIMARY' },
  { id: '55000000', name: '賃借料', category: 'PRIMARY' },
  { id: '55100000', name: '水道光熱費', category: 'PRIMARY' },
  { id: '56000000', name: '情報システム費', category: 'PRIMARY' },
  { id: '57000000', name: '減価償却費', category: 'PRIMARY' },
  { id: '58000000', name: '公租公課', category: 'PRIMARY' },
  { id: '58100000', name: '電源開発促進税', category: 'PRIMARY' },
  { id: '59000000', name: '広告宣伝・ポイント還元・手数料', category: 'PRIMARY' },
  { id: '94100000', name: '配賦（本店費）', category: 'SEC42' },
  { id: '94110000', name: '配賦（発電本部費）', category: 'SEC42' },
  { id: '94120000', name: '配賦（送配電費 → 託送プール）', category: 'SEC42' },
  { id: '94140000', name: '配賦（調達電力）', category: 'SEC42' },
  { id: '94150000', name: '配賦（託送料）', category: 'SEC42' },
  { id: '94160000', name: '配賦（小売の販売費）', category: 'SEC42' },
  { id: '94170000', name: '配賦（発電カンパニーの差額）', category: 'SEC42' },
  { id: '94180000', name: '配賦（送配電カンパニーの差額）', category: 'SEC42' },
  { id: '94200000', name: '間接費計算（工事管理費）', category: 'SEC41' },
  { id: '94300000', name: '活動配分（保修作業）', category: 'SEC43' },
  { id: '94310000', name: '活動配分（社内電力取引）', category: 'SEC43' },
  { id: '94320000', name: '活動配分（託送）', category: 'SEC43' },
  { id: '94900000', name: '決済', category: 'SEC21' },
];

const R = {
  revenue: { from: '41000000', to: '49999999' },
  sales: { from: '41100000', to: '41299999' },
  allCosts: { from: '50000000', to: '99999999' },
  hqBuilding: { from: '55000000', to: '55199999' },
  repairs: { from: '53000000', to: '53199999' },
} as const;

// ---------- 原価センタ ----------
interface Dept {
  id: string;
  name: string;
  pc: 'PC10' | 'PC20' | 'PC30' | 'PC40';
  kind: 'ADMIN' | 'PROD' | 'SALES' | 'SERVICE';
  tier: 'CORPORATE' | 'SUPPORT' | 'OPERATING';
  hc: number;
  /** 1人あたりの月の給与（賞与の引当を含む） */
  pay: number;
}

const DEPTS: Dept[] = [
  { id: '1000', name: '経営企画室', pc: 'PC10', kind: 'ADMIN', tier: 'CORPORATE', hc: 25, pay: 850_000 },
  { id: '1010', name: '総務人事部', pc: 'PC10', kind: 'ADMIN', tier: 'CORPORATE', hc: 40, pay: 750_000 },
  { id: '1020', name: '経理部', pc: 'PC10', kind: 'ADMIN', tier: 'CORPORATE', hc: 30, pay: 750_000 },
  { id: '1090', name: '本店ビル', pc: 'PC10', kind: 'ADMIN', tier: 'CORPORATE', hc: 0, pay: 0 },
  { id: '1100', name: '情報システム部', pc: 'PC10', kind: 'SERVICE', tier: 'SUPPORT', hc: 35, pay: 800_000 },
  { id: '2000', name: '発電本部', pc: 'PC20', kind: 'ADMIN', tier: 'SUPPORT', hc: 40, pay: 800_000 },
  { id: '2100', name: 'LNG火力発電所', pc: 'PC20', kind: 'PROD', tier: 'OPERATING', hc: 120, pay: 720_000 },
  { id: '2200', name: '石炭火力発電所', pc: 'PC20', kind: 'PROD', tier: 'OPERATING', hc: 100, pay: 720_000 },
  { id: '2300', name: '水力発電所', pc: 'PC20', kind: 'PROD', tier: 'OPERATING', hc: 30, pay: 720_000 },
  { id: '2400', name: '太陽光発電所', pc: 'PC20', kind: 'PROD', tier: 'OPERATING', hc: 0, pay: 0 },
  { id: '2500', name: '保修センター', pc: 'PC20', kind: 'SERVICE', tier: 'SUPPORT', hc: 80, pay: 700_000 },
  { id: '2900', name: '卸販売（社外向け）', pc: 'PC20', kind: 'SALES', tier: 'OPERATING', hc: 0, pay: 0 },
  { id: '3000', name: '送配電本部', pc: 'PC30', kind: 'ADMIN', tier: 'SUPPORT', hc: 50, pay: 800_000 },
  { id: '3100', name: '送変電部', pc: 'PC30', kind: 'SERVICE', tier: 'SUPPORT', hc: 150, pay: 700_000 },
  { id: '3200', name: '配電部', pc: 'PC30', kind: 'SERVICE', tier: 'SUPPORT', hc: 300, pay: 660_000 },
  { id: '3300', name: '中央給電指令所', pc: 'PC30', kind: 'SERVICE', tier: 'SUPPORT', hc: 50, pay: 750_000 },
  { id: '3900', name: '託送プール（ネットワーク利用）', pc: 'PC30', kind: 'SERVICE', tier: 'OPERATING', hc: 0, pay: 0 },
  { id: '3950', name: '託送（他社小売向け）', pc: 'PC30', kind: 'SALES', tier: 'OPERATING', hc: 0, pay: 0 },
  { id: '4000', name: '小売本部', pc: 'PC40', kind: 'ADMIN', tier: 'SUPPORT', hc: 30, pay: 780_000 },
  { id: '4100', name: '電力調達部', pc: 'PC40', kind: 'SALES', tier: 'OPERATING', hc: 20, pay: 800_000 },
  { id: '4150', name: '託送料（ネットワーク利用料）', pc: 'PC40', kind: 'SALES', tier: 'OPERATING', hc: 0, pay: 0 },
  { id: '4200', name: '法人営業部', pc: 'PC40', kind: 'SALES', tier: 'OPERATING', hc: 60, pay: 750_000 },
  { id: '4300', name: 'お客さまセンター', pc: 'PC40', kind: 'SALES', tier: 'OPERATING', hc: 30, pay: 600_000 },
];
const HQ = ['1000', '1010', '1020', '1100'];
const withHc = (except: string[] = []) => DEPTS.filter((d) => d.hc > 0 && !except.includes(d.id)).map((d) => d.id);

// ---------- 小売の顧客区分 × 地域 ----------
interface Customer {
  key: 'RES_N' | 'RES_S' | 'COM_N' | 'COM_S' | 'IND_N' | 'IND_S';
  group: 'RES' | 'COM' | 'IND';
  region: 'N' | 'S';
  name: string;
  /** 販売電力量（MWh／月） */
  mwh: number;
  /** 料金単価（円/kWh、燃料費調整を含み、再エネ賦課金を除く） */
  price: number;
  /** 託送料金（円/kWh） */
  takuso: number;
  /** 契約口数 */
  accounts: number;
}

/** 託送料金の電圧別単価（円/MWh）。低圧・高圧・特別高圧 */
const TAKUSO_RATE = { RES: 9_500, COM: 4_500, IND: 2_300 } as const;

export const UTIL_CUSTOMERS: readonly Customer[] = [
  { key: 'RES_N', group: 'RES', region: 'N', name: '家庭・低圧（北部）', mwh: 60_000, price: 29, takuso: 9.5, accounts: 180_000 },
  { key: 'RES_S', group: 'RES', region: 'S', name: '家庭・低圧（南部）', mwh: 80_000, price: 29, takuso: 9.5, accounts: 240_000 },
  { key: 'COM_N', group: 'COM', region: 'N', name: '業務・高圧（北部）', mwh: 55_000, price: 21.5, takuso: 4.5, accounts: 2_600 },
  { key: 'COM_S', group: 'COM', region: 'S', name: '業務・高圧（南部）', mwh: 85_000, price: 21.5, takuso: 4.5, accounts: 4_100 },
  { key: 'IND_N', group: 'IND', region: 'N', name: '産業・特別高圧（北部）', mwh: 70_000, price: 17.5, takuso: 2.3, accounts: 45 },
  { key: 'IND_S', group: 'IND', region: 'S', name: '産業・特別高圧（南部）', mwh: 50_000, price: 17.5, takuso: 2.3, accounts: 30 },
];

const custChars = (c: Customer) => ({ customerGroup: c.group, region: c.region, profitCenter: 'PC40' });
export const UTIL_SEG = {
  ...Object.fromEntries(UTIL_CUSTOMERS.map((c) => [c.key, segmentKey(custChars(c))])),
  RES_ALL: segmentKey({ customerGroup: 'RES', profitCenter: 'PC40' }),
  GEN: segmentKey({ productGroup: 'GEN', profitCenter: 'PC20' }),
  NW: segmentKey({ productGroup: 'NW', profitCenter: 'PC30' }),
} as Record<Customer['key'] | 'RES_ALL' | 'GEN' | 'NW', string>;

const cc = (id: string): ObjRef => ({ type: 'CCTR', id });
const wbs = (id: string): ObjRef => ({ type: 'WBS', id });
const seg = (id: string): ObjRef => ({ type: 'PSEG', id });
const custObj = (c: Customer) => seg(UTIL_SEG[c.key]);
const onCustomers = (value: (c: Customer) => number, pred: (c: Customer) => boolean = () => true) =>
  UTIL_CUSTOMERS.filter(pred).map((c) => ({ obj: custObj(c), value: value(c) }));

/** 社内取引価格（円/MWh）。発電 → 小売、社外の相対卸も同じ単価（内外無差別） */
export const TRANSFER_PRICE = 15_000;

/** 発電所の発電量（MWh／月）と設備容量（MW） */
const PLANTS = [
  { id: '2100', mwh: 210_000, mw: 600 },
  { id: '2200', mwh: 140_000, mw: 300 },
  { id: '2300', mwh: 25_000, mw: 100 },
  { id: '2400', mwh: 10_000, mw: 80 },
] as const;
/** LNG 火力の発電量のうち、社外へ卸す分（MWh） */
const WHOLESALE_MWH = 25_000;
/** 他社小売の託送量（MWh）。低圧・高圧 */
const OTHER_RETAILERS = { RES: 30_000, COM: 40_000 } as const;

const master: Master = {
  controllingArea: 'A000',
  companyCode: '3010',
  period: UTILITY_PERIOD,
  currency: 'JPY',
  accounts: ACCOUNTS,
  profitCenters: [
    { id: 'PC10', name: 'コーポレート', groupId: 'PCG-ALL' },
    { id: 'PC20', name: '発電カンパニー', groupId: 'PCG-ALL' },
    { id: 'PC30', name: '送配電カンパニー', groupId: 'PCG-ALL' },
    { id: 'PC40', name: '小売カンパニー', groupId: 'PCG-ALL' },
  ],
  costCenters: DEPTS.map((d) => ({ id: d.id, name: d.name, profitCenter: d.pc, kind: d.kind, tier: d.tier, groupId: `CCG-${d.pc}` })),
  wbs: [
    { id: 'P-100', name: '料金システム改修（費用分）', projectType: 'OVERHEAD', responsibleCctr: '4000', profitCenter: 'PC40', statistical: false, settlementProfileId: 'SP-UTIL' },
    { id: 'P-210', name: '石炭火力1号機 定期点検', projectType: 'OVERHEAD', responsibleCctr: '2200', profitCenter: 'PC20', statistical: false, settlementProfileId: 'SP-UTIL' },
    { id: 'P-310', name: '配電線 台風被害の復旧', projectType: 'OVERHEAD', responsibleCctr: '3200', profitCenter: 'PC30', statistical: false, settlementProfileId: 'SP-UTIL' },
  ],
  activityTypes: [
    { id: 'HOSHU', name: '保修作業時間', unit: '時間', allocAccount: '94300000', rates: [{ cctr: '2500', planRate: 9_000 }] },
    { id: 'DENRYOKU', name: '社内電力取引', unit: 'MWh', allocAccount: '94310000', rates: PLANTS.map((p) => ({ cctr: p.id, planRate: TRANSFER_PRICE })) },
    { id: 'TAKUSO_L', name: '託送（低圧）', unit: 'MWh', allocAccount: '94320000', rates: [{ cctr: '3900', planRate: TAKUSO_RATE.RES }] },
    { id: 'TAKUSO_H', name: '託送（高圧）', unit: 'MWh', allocAccount: '94320000', rates: [{ cctr: '3900', planRate: TAKUSO_RATE.COM }] },
    { id: 'TAKUSO_S', name: '託送（特別高圧）', unit: 'MWh', allocAccount: '94320000', rates: [{ cctr: '3900', planRate: TAKUSO_RATE.IND }] },
  ],
  skfs: [
    { id: 'HC', name: '人員', unit: '人', values: DEPTS.filter((d) => d.hc > 0).map((d) => ({ obj: cc(d.id), value: d.hc })) },
    {
      id: 'FLOOR',
      name: '本店ビル床面積',
      unit: 'm²',
      values: [
        { obj: cc('1000'), value: 400 },
        { obj: cc('1010'), value: 500 },
        { obj: cc('1020'), value: 350 },
        { obj: cc('1100'), value: 450 },
      ],
    },
    { id: 'MW', name: '設備容量', unit: 'MW', values: PLANTS.map((p) => ({ obj: cc(p.id), value: p.mw })) },
    { id: 'SALES_MWH', name: '販売電力量', unit: 'MWh', values: onCustomers((c) => c.mwh) },
    { id: 'TAKUSO_K', name: '託送料相当額', unit: '千円', values: onCustomers((c) => (c.mwh * TAKUSO_RATE[c.group]) / 1000) },
    { id: 'CUST', name: '契約口数', unit: '口', values: onCustomers((c) => c.accounts) },
  ],
  segments: [
    ...UTIL_CUSTOMERS.map((c) => ({ id: UTIL_SEG[c.key], name: c.name, chars: custChars(c), attributed: false })),
    { id: UTIL_SEG.RES_ALL, name: '家庭・低圧（地域未設定）', chars: { customerGroup: 'RES', profitCenter: 'PC40' }, attributed: false },
    { id: UTIL_SEG.GEN, name: '発電カンパニー（卸・社内取引）', chars: { productGroup: 'GEN', profitCenter: 'PC20' }, attributed: false },
    { id: UTIL_SEG.NW, name: '送配電カンパニー（託送）', chars: { productGroup: 'NW', profitCenter: 'PC30' }, attributed: false },
  ],
  settlementProfiles: [
    {
      id: 'SP-UTIL',
      allowed: ['CCTR', 'WBS', 'PSEG'],
      structure: [
        { accounts: [R.revenue], settleAccount: 'KEEP' },
        { accounts: [R.allCosts], settleAccount: '94900000' },
      ],
    },
  ],
  groups: [
    { id: 'PCG-ALL', type: 'PCTR', name: '全社', members: ['PC10', 'PC20', 'PC30', 'PC40'] },
    ...(['PC10', 'PC20', 'PC30', 'PC40'] as const).map((pc) => ({
      id: `CCG-${pc}`,
      type: 'CCTR' as const,
      name: { PC10: 'コーポレート', PC20: '発電カンパニー', PC30: '送配電カンパニー', PC40: '小売カンパニー' }[pc],
      members: DEPTS.filter((d) => d.pc === pc).map((d) => d.id),
    })),
  ],
};

// ---------- 一次仕訳（1か月分。収入はマイナス） ----------
const postings: PrimaryPosting[] = [];
let seq = 0;
const P = (account: string, obj: ObjRef, amount: number, text: string) => {
  postings.push({ id: `PP-${String(++seq).padStart(3, '0')}`, account, obj, amount, text });
};

// 収入
for (const c of UTIL_CUSTOMERS) {
  P(c.group === 'RES' ? '41100000' : '41200000', custObj(c), -c.mwh * c.price * 1000, `${c.name} ${(c.mwh / 1000).toFixed(0)}GWh × ${c.price}円`);
}
P('41300000', seg(UTIL_SEG.GEN), -15_000 * TRANSFER_PRICE, '相対卸（他社小売へ 15GWh、社内と同じ単価）');
P('41300000', seg(UTIL_SEG.GEN), -10_000 * 12_000, '卸市場への売り（10GWh × 12円）');
P('41400000', seg(UTIL_SEG.NW), -OTHER_RETAILERS.RES * TAKUSO_RATE.RES, '託送収益 他社小売・低圧（30GWh）');
P('41400000', seg(UTIL_SEG.NW), -OTHER_RETAILERS.COM * TAKUSO_RATE.COM, '託送収益 他社小売・高圧（40GWh）');

// 人件費：人数×1人あたりの給与、法定福利費は給与の15%
for (const d of DEPTS.filter((x) => x.hc > 0)) {
  P('51000000', cc(d.id), d.hc * d.pay, `${d.name} 給与（${d.hc}人）`);
  P('51200000', cc(d.id), Math.round(d.hc * d.pay * 0.15), `${d.name} 法定福利費`);
}

// 燃料費と卸市場からの購入
P('52000000', cc('2100'), 2_310_000_000, 'LNG（210GWh × 約11円/kWh）');
P('52100000', cc('2200'), 910_000_000, '石炭（140GWh × 約6.5円/kWh）');
P('52500000', cc('4100'), 737_500_000, '卸市場からの購入（59GWh × 12.5円）');

// 修繕費・材料費
P('53000000', cc('2100'), 120_000_000, 'LNG火力 経常修繕');
P('53000000', cc('2200'), 80_000_000, '石炭火力 経常修繕');
P('53000000', cc('2300'), 15_000_000, '水力 経常修繕');
P('53000000', cc('3100'), 180_000_000, '送電線・変電所の修繕');
P('53000000', cc('3200'), 220_000_000, '配電線・電柱の修繕');
P('53100000', cc('2500'), 10_000_000, '保修用の部品');
P('53100000', cc('3200'), 40_000_000, '配電資材');
P('53000000', wbs('P-210'), 520_000_000, '定期点検（ボイラ・タービン、外注）');
P('53100000', wbs('P-210'), 60_000_000, '定期点検 交換部品');
P('53000000', wbs('P-310'), 160_000_000, '台風被害の復旧工事（外注）');
P('53100000', wbs('P-310'), 30_000_000, '電柱・電線');

// 委託費
P('54000000', cc('2100'), 40_000_000, '運転補助・環境測定の委託');
P('54000000', cc('2200'), 90_000_000, '石炭の荷役・灰処理の委託');
P('54000000', cc('2400'), 12_000_000, '太陽光の保守（O&M）委託');
P('54000000', cc('3100'), 40_000_000, '送電線の巡視・樹木伐採の委託');
P('54000000', cc('3200'), 90_000_000, '検針・配電線巡視の委託');
P('54000000', cc('4300'), 90_000_000, 'コールセンター委託');
P('54000000', cc('1010'), 8_000_000, '給与計算・福利厚生の委託');

// 減価償却費・公租公課・電源開発促進税
P('57000000', cc('2100'), 250_000_000, 'LNG火力 設備');
P('57000000', cc('2200'), 300_000_000, '石炭火力 設備');
P('57000000', cc('2300'), 60_000_000, '水力 設備');
P('57000000', cc('2400'), 70_000_000, '太陽光 設備');
P('57000000', cc('3100'), 420_000_000, '送電線・変電所');
P('57000000', cc('3200'), 400_000_000, '配電線・電柱・スマートメーター');
P('57000000', cc('3300'), 40_000_000, '系統運用システム');
P('57000000', cc('1100'), 40_000_000, '社内システム');
P('57000000', cc('4000'), 30_000_000, '料金システム');
P('58000000', cc('2100'), 60_000_000, '固定資産税');
P('58000000', cc('2200'), 50_000_000, '固定資産税');
P('58000000', cc('2300'), 25_000_000, '固定資産税・水利使用料');
P('58000000', cc('2400'), 8_000_000, '固定資産税');
P('58000000', cc('3100'), 90_000_000, '固定資産税');
P('58000000', cc('3200'), 110_000_000, '固定資産税');
P('58100000', cc('3000'), 176_250_000, '電源開発促進税（470GWh × 0.375円）');

// 本店・小売の経費
P('55000000', cc('1090'), 30_000_000, '本店ビル賃借料');
P('55100000', cc('1090'), 5_000_000, '本店ビル水道光熱費');
P('56000000', cc('1100'), 60_000_000, '社内システムの保守・クラウド利用料');
P('59000000', cc('1000'), 10_000_000, '企業広告');
P('59000000', cc('4000'), 40_000_000, '料金プランの広告宣伝');
P('59000000', cc('4300'), 40_000_000, '請求書の郵送・収納手数料');
P('59000000', seg(UTIL_SEG.RES_ALL), 25_000_000, '家庭向けポイント還元');
P('56000000', wbs('P-100'), 45_000_000, '料金システム改修（外注、費用分）');

// ---------- ルール ----------
const skf = (skfId: string): TracingFactor => ({ kind: 'SKF', skfId });
const list = (type: 'CCTR' | 'PSEG', ids: string[]) => ({ type, mode: 'LIST' as const, ids });
const customers = (pred: (c: Customer) => boolean = () => true) => list('PSEG', UTIL_CUSTOMERS.filter(pred).map((c) => UTIL_SEG[c.key]));
const segment = (id: string, name: string, senders: string[], receiver: AllocationCycle['segments'][number]['receiver'], allocAccount: string) => ({
  id,
  name,
  sender: { objects: list('CCTR', senders), accounts: [R.allCosts], sharePct: 100 },
  receiver,
  allocAccount,
});
const toOne = (segId: string) => ({ objects: list('PSEG', [segId]), factor: { kind: 'FIXED_PERCENT' as const, weights: [{ obj: seg(segId), pct: 100 }] } });

const maCycle: AllocationCycle = {
  id: 'CY-MA',
  name: 'カンパニー・顧客区分への配賦',
  context: 'MA',
  type: 'OVERHEAD',
  iterative: false,
  segments: [
    segment('MA-01', '発電所・保修・卸販売の差額 → 発電カンパニー', ['2100', '2200', '2300', '2400', '2500', '2900'], toOne(UTIL_SEG.GEN), '94170000'),
    segment('MA-02', '託送プール・他社向け託送の差額 → 送配電カンパニー', ['3900', '3950'], toOne(UTIL_SEG.NW), '94180000'),
    segment('MA-03', '電力調達部 → 顧客区分（販売電力量）', ['4100'], { objects: customers(), factor: skf('SALES_MWH') }, '94140000'),
    segment('MA-04', '託送料 → 顧客区分（託送料相当額）', ['4150'], { objects: customers(), factor: skf('TAKUSO_K') }, '94150000'),
    segment('MA-05', 'お客さまセンター → 家庭（契約口数）', ['4300'], { objects: customers((c) => c.group === 'RES'), factor: skf('CUST') }, '94160000'),
    segment('MA-06', '法人営業部 → 業務・産業（電力料収入）', ['4200'], { objects: customers((c) => c.group !== 'RES'), factor: { kind: 'VARIABLE', accounts: [{ from: '41200000', to: '41299999' }] } }, '94160000'),
    segment('MA-07', '小売本部 → 顧客区分（料金収入）', ['4000'], { objects: customers(), factor: { kind: 'VARIABLE', accounts: [R.sales] } }, '94160000'),
  ],
};

const rules: Omit<Scenario, 'id' | 'name' | 'memo' | 'steps'> = {
  activityAllocs: [
    { id: 'AA-01', senderCctr: '2500', activityType: 'HOSHU', receiver: cc('2100'), quantity: 4_000 },
    { id: 'AA-02', senderCctr: '2500', activityType: 'HOSHU', receiver: cc('2200'), quantity: 6_000 },
    { id: 'AA-11', senderCctr: '2100', activityType: 'DENRYOKU', receiver: cc('4100'), quantity: 210_000 - WHOLESALE_MWH },
    { id: 'AA-12', senderCctr: '2100', activityType: 'DENRYOKU', receiver: cc('2900'), quantity: WHOLESALE_MWH },
    { id: 'AA-13', senderCctr: '2200', activityType: 'DENRYOKU', receiver: cc('4100'), quantity: 140_000 },
    { id: 'AA-14', senderCctr: '2300', activityType: 'DENRYOKU', receiver: cc('4100'), quantity: 25_000 },
    { id: 'AA-15', senderCctr: '2400', activityType: 'DENRYOKU', receiver: cc('4100'), quantity: 10_000 },
    { id: 'AA-21', senderCctr: '3900', activityType: 'TAKUSO_L', receiver: cc('4150'), quantity: 140_000 },
    { id: 'AA-22', senderCctr: '3900', activityType: 'TAKUSO_H', receiver: cc('4150'), quantity: 140_000 },
    { id: 'AA-23', senderCctr: '3900', activityType: 'TAKUSO_S', receiver: cc('4150'), quantity: 120_000 },
    { id: 'AA-24', senderCctr: '3900', activityType: 'TAKUSO_L', receiver: cc('3950'), quantity: OTHER_RETAILERS.RES },
    { id: 'AA-25', senderCctr: '3900', activityType: 'TAKUSO_H', receiver: cc('3950'), quantity: OTHER_RETAILERS.COM },
  ],
  costingSheets: [
    { id: 'CS-01', rows: [{ base: [R.repairs], ratePct: 6, creditCctr: '2000', overheadAccount: '94200000' }], targets: [wbs('P-210')] },
    { id: 'CS-02', rows: [{ base: [R.repairs], ratePct: 6, creditCctr: '3000', overheadAccount: '94200000' }], targets: [wbs('P-310')] },
  ],
  settlementRules: [
    { id: 'SR-P100', sender: wbs('P-100'), rules: [{ receiver: cc('4000'), basis: 'PCT', value: 100, settlementType: 'FUL', validFrom: 202604 }] },
    { id: 'SR-P210', sender: wbs('P-210'), rules: [{ receiver: cc('2200'), basis: 'PCT', value: 100, settlementType: 'FUL', validFrom: 202604 }] },
    { id: 'SR-P310', sender: wbs('P-310'), rules: [{ receiver: cc('3200'), basis: 'PCT', value: 100, settlementType: 'FUL', validFrom: 202604 }] },
  ],
  cycles: [
    {
      id: 'CY-DIST',
      name: '本店ビル費の配布',
      context: 'CCTR',
      type: 'DISTRIBUTION',
      iterative: false,
      segments: [
        {
          id: 'DS-01',
          name: '本店ビル → 本店部門（床面積）',
          sender: { objects: list('CCTR', ['1090']), accounts: [R.hqBuilding], sharePct: 100 },
          receiver: { objects: list('CCTR', HQ), factor: skf('FLOOR') },
        },
      ],
    },
    {
      id: 'CY-ASSESS',
      name: '本店費の配賦（反復）',
      context: 'CCTR',
      type: 'OVERHEAD',
      iterative: true,
      segments: [
        segment('AS-01', '総務人事部 → 各部門（人員）', ['1010'], { objects: list('CCTR', withHc(['1010'])), factor: skf('HC') }, '94100000'),
        segment('AS-02', '情報システム部 → 各部門（人員）', ['1100'], { objects: list('CCTR', withHc(['1100'])), factor: skf('HC') }, '94100000'),
        segment('AS-03', '経営企画室・経理部 → カンパニーの部門（人員）', ['1000', '1020'], { objects: list('CCTR', withHc(HQ)), factor: skf('HC') }, '94100000'),
      ],
    },
    {
      id: 'CY-GEN',
      name: '発電本部費の配賦',
      context: 'CCTR',
      type: 'OVERHEAD',
      iterative: false,
      segments: [segment('GN-01', '発電本部 → 発電所（設備容量）', ['2000'], { objects: list('CCTR', PLANTS.map((p) => p.id)), factor: skf('MW') }, '94110000')],
    },
    {
      id: 'CY-NW',
      name: '送配電費を託送プールへ',
      context: 'CCTR',
      type: 'OVERHEAD',
      iterative: false,
      segments: [
        segment('NW-01', '送配電本部・送変電部・配電部・給電指令所 → 託送プール', ['3000', '3100', '3200', '3300'], { objects: list('CCTR', ['3900']), factor: { kind: 'FIXED_PERCENT', weights: [{ obj: cc('3900'), pct: 100 }] } }, '94120000'),
      ],
    },
    maCycle,
  ],
  tddRules: [
    {
      id: 'TDD-01',
      name: '家庭向けポイント還元 → 地域（電灯料収入の比）',
      sender: { segments: { type: 'PSEG', mode: 'FILTER', chars: { customerGroup: 'RES' } }, accounts: [R.allCosts] },
      distributeChars: ['region'],
      reference: { accounts: [{ from: '41100000', to: '41199999' }], source: 'CURRENT_PERIOD' },
    },
  ],
};

/** 託送の社内振替。送配電の費用を託送プールに集めた後（ステップ5の後）に回す */
const NETWORK_AA = rules.activityAllocs.filter((a) => a.senderCctr === '3900').map((a) => a.id);
const items = {
  'ST-01': rules.activityAllocs.filter((a) => !NETWORK_AA.includes(a.id)).map((a) => a.id),
  'ST-02': ['CS-01', 'CS-02'],
  'ST-03': ['SR-P100', 'SR-P210', 'SR-P310'],
  'ST-04': ['CY-DIST'],
  'ST-05': ['CY-ASSESS', 'CY-GEN', 'CY-NW'],
  'ST-08': ['CY-MA'],
  'ST-09': ['TDD-01'],
};
/** 標準の並びに、託送の社内振替のステップ（ステップ5の後）を足す */
const utilitySteps = (its: Partial<Record<string, string[]>>, reval: boolean) => {
  const steps = stepsFromTemplate(its).map((s) => (s.id === 'ST-06' ? { ...s, enabled: reval } : s));
  const at = steps.findIndex((s) => s.id === 'ST-06');
  steps.splice(at, 0, { id: 'ST-05N', name: '託送料金の社内振替', kind: 'ACTIVITY_ALLOC', itemIds: NETWORK_AA, enabled: true });
  return steps;
};
/** 実績原価レート（ステップ6）をオフにする：社内取引は振替価格のまま */
const transferPriceSteps = (its: Partial<Record<string, string[]>>) => utilitySteps(its, false);

const defaultScenario: Scenario = {
  id: 'S-DEFAULT',
  name: '標準：社内取引は振替価格、本店費は部門へ',
  memo: '発電 → 小売は社内取引価格 15円/kWh、送配電 → 小売は託送料金で振り替える（実績原価レートの再評価はオフ）。発電・送配電の損益は、振替収入と原価の差としてカンパニーに残る。本店費は人員で各部門へ配賦する。',
  ...rules,
  steps: transferPriceSteps(items),
};

/** 社内取引を実績原価で振り替える案。発電・送配電の原価がそのまま小売に乗る */
const costScenario: Scenario = {
  id: 'S-COST',
  name: '社内取引を実績原価で振り替える',
  memo: '実績原価レートの再評価（ステップ6）をオンにして、発電所と託送プールの原価をそのまま受け手に流す案。発電・送配電の損益は社外取引の分だけになり、小売の損益が全社の利益に近づく。',
  ...rules,
  steps: utilitySteps(items, true),
};

/** 本店費を利益センタ間の配賦で各カンパニーへ負担させる案（カンパニー負担金） */
const pcScenario: Scenario = {
  id: 'S-PCALLOC',
  name: '本店費をカンパニー負担金として利益センタで配賦',
  memo: '本店費を部門に配らず、コーポレート（PC10）から各カンパニーの利益センタへ売上高の比（33:15:52）で配賦する案。本店の原価センタには残高が残る。',
  ...rules,
  cycles: [
    ...rules.cycles,
    {
      id: 'CY-PC',
      name: '本店費のカンパニー負担金',
      context: 'PCTR',
      type: 'OVERHEAD',
      iterative: false,
      segments: [
        {
          id: 'PC-01',
          name: 'コーポレート → 各カンパニー（売上高の比）',
          sender: { objects: { type: 'PCTR', mode: 'LIST', ids: ['PC10'] }, accounts: [R.allCosts], sharePct: 100 },
          receiver: {
            objects: { type: 'PCTR', mode: 'LIST', ids: ['PC20', 'PC30', 'PC40'] },
            factor: {
              kind: 'FIXED_PORTION',
              weights: [
                { obj: { type: 'PCTR', id: 'PC20' }, portion: 33 },
                { obj: { type: 'PCTR', id: 'PC30' }, portion: 15 },
                { obj: { type: 'PCTR', id: 'PC40' }, portion: 52 },
              ],
            },
          },
          allocAccount: '94100000',
        },
      ],
    },
  ],
  steps: transferPriceSteps({ ...items, 'ST-05': ['CY-PC', 'CY-GEN', 'CY-NW'] }),
};

const UTILITY: Project = { schemaVersion: 1, master, primaryPostings: postings, scenarios: [defaultScenario, costScenario, pcScenario] };

/** さざなみ電力のプロジェクト（毎回新しい写しを返す） */
export const utilityProject = (): Project => structuredClone(UTILITY);

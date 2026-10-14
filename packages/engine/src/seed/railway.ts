/**
 * サンプル「みどり川電鉄」（架空の私鉄、D-052）。最終的に駅ごとの収益性を見る。1か月分（2026年10月）の値。
 *
 * - 本線（PC20）24.0km・8駅と、川辺で分かれるみどり台線（PC30）6.0km・3駅。
 * - 駅は収益性セグメントの特性「地域」に駅コードを入れて表す（S01〜S11）。線区全体（駅未設定）のセグメントは、
 *   Web・定期券センターで売った定期と車内広告を受け、TDD で駅へ細分化する。
 * - 費用は鉄道事業会計規則の営業費の区分に寄せて、部門の原価センタに置く（線路保存費＝工務部、電路保存費＝電気部、
 *   車両保存費＝車両部、運転費＝運転区、動力費＝動力費の原価センタ、輸送管理費＝運輸指令所、運輸費（駅務）＝駅管区）。
 *   本社部門は人数などで部門へ配賦し、部門の費用は区分ごとの二次勘定でマージン分析（駅）へ配賦する。
 * - 数字は公表資料の傾向（定期の割合、運輸雑収の割合、電車1両1kmあたりの電力量など）に合わせた架空の値。根拠は README。
 */
import { segmentKey } from '../model/keys.ts';
import type { AllocationCycle, GLAccount, Master, ObjRef, PrimaryPosting, Project, Scenario, TracingFactor } from '../model/types.ts';
import { stepsFromTemplate } from './template.ts';

export const RAILWAY_PERIOD = 202610;

// ---------- 勘定科目（YCOA に寄せた番号の架空の科目） ----------
const ACCOUNTS: GLAccount[] = [
  { id: '41100000', name: '旅客運輸収入（定期外）', category: 'REVENUE' },
  { id: '41200000', name: '旅客運輸収入（定期）', category: 'REVENUE' },
  { id: '41300000', name: '運輸雑収（構内営業料）', category: 'REVENUE' },
  { id: '41400000', name: '運輸雑収（広告料）', category: 'REVENUE' },
  { id: '51000000', name: '給与手当', category: 'PRIMARY' },
  { id: '51200000', name: '法定福利費', category: 'PRIMARY' },
  { id: '52100000', name: '動力費（購入電力）', category: 'PRIMARY' },
  { id: '53000000', name: '修繕費（外注）', category: 'PRIMARY' },
  { id: '53100000', name: '修繕材料費', category: 'PRIMARY' },
  { id: '54000000', name: '業務委託費', category: 'PRIMARY' },
  { id: '55000000', name: '賃借料', category: 'PRIMARY' },
  { id: '55100000', name: '水道光熱費', category: 'PRIMARY' },
  { id: '56000000', name: '情報システム費', category: 'PRIMARY' },
  { id: '57000000', name: '減価償却費', category: 'PRIMARY' },
  { id: '58000000', name: '租税公課', category: 'PRIMARY' },
  { id: '59000000', name: 'その他経費（案内宣伝費など）', category: 'PRIMARY' },
  { id: '94100000', name: '配賦（一般管理費）', category: 'SEC42' },
  { id: '94110000', name: '配賦（運輸費・駅務）', category: 'SEC42' },
  { id: '94120000', name: '配賦（運転費）', category: 'SEC42' },
  { id: '94130000', name: '配賦（動力費）', category: 'SEC42' },
  { id: '94140000', name: '配賦（車両保存費）', category: 'SEC42' },
  { id: '94150000', name: '配賦（線路・電路保存費）', category: 'SEC42' },
  { id: '94160000', name: '配賦（輸送管理費）', category: 'SEC42' },
  { id: '94200000', name: '間接費計算（工事管理費）', category: 'SEC41' },
  { id: '94300000', name: '活動配分', category: 'SEC43' },
  { id: '94900000', name: '決済', category: 'SEC21' },
];

const R = {
  revenue: { from: '41000000', to: '49999999' },
  fares: { from: '41100000', to: '41299999' },
  allCosts: { from: '50000000', to: '99999999' },
  hqBuilding: { from: '55000000', to: '55199999' },
  repairs: { from: '53000000', to: '53199999' },
} as const;

// ---------- 駅 ----------
interface Station {
  code: string;
  name: string;
  pc: 'PC20' | 'PC30';
  /** 駅務を受け持つ駅管区（原価センタ） */
  office: string;
  /** 駅勢キロ：隣の駅との間の半分ずつを足した長さ（km） */
  km: number;
  /** 乗車人員（人／月） */
  pax: number;
  /** 駅務量（人日／月。委託の要員を含む） */
  staffDays: number;
  /** 定期外の運賃収入（駅の発売分、円） */
  nonCommuter: number;
  /** 定期の運賃収入のうち、駅の窓口・券売機で売った分（円）。ほかに線区全体で Web 発売分がある */
  commuter: number;
  /** 構内営業料（駅ナカ・駅ビルの賃料と歩合、円） */
  concession: number;
  /** 駅構内の広告料（円） */
  ads: number;
}

/** 本線は1日240本（5両）、みどり台線は80本（3両）。31日分 */
const TRAINS = { PC20: 240 * 31, PC30: 80 * 31 } as const;
const CARS = { PC20: 5, PC30: 3 } as const;

export const RAIL_STATIONS: readonly Station[] = [
  { code: 'S01', name: '中央駅', pc: 'PC20', office: '4100', km: 1.05, pax: 1_150_000, staffDays: 280, nonCommuter: 139_725_000, commuter: 37_633_750, concession: 9_800_000, ads: 3_500_000 },
  { code: 'S02', name: '市役所前駅', pc: 'PC20', office: '4100', km: 2.25, pax: 330_000, staffDays: 120, nonCommuter: 26_565_000, commuter: 12_012_000, concession: 600_000, ads: 600_000 },
  { code: 'S03', name: '大学前駅', pc: 'PC20', office: '4100', km: 2.85, pax: 420_000, staffDays: 160, nonCommuter: 25_200_000, commuter: 15_435_000, concession: 1_200_000, ads: 700_000 },
  { code: 'S04', name: '緑ヶ丘駅', pc: 'PC20', office: '4200', km: 3.25, pax: 260_000, staffDays: 90, nonCommuter: 20_280_000, commuter: 12_103_000, concession: 400_000, ads: 250_000 },
  { code: 'S05', name: '川辺駅', pc: 'PC20', office: '4200', km: 3.4, pax: 310_000, staffDays: 180, nonCommuter: 30_380_000, commuter: 14_105_000, concession: 1_500_000, ads: 500_000 },
  { code: 'S06', name: '新町駅', pc: 'PC20', office: '4200', km: 4.1, pax: 230_000, staffDays: 70, nonCommuter: 20_700_000, commuter: 12_397_000, concession: 350_000, ads: 200_000 },
  { code: 'S07', name: '工業団地駅', pc: 'PC20', office: '4300', km: 4.7, pax: 180_000, staffDays: 60, nonCommuter: 11_880_000, commuter: 12_096_000, concession: 150_000, ads: 150_000 },
  { code: 'S08', name: '港駅', pc: 'PC20', office: '4300', km: 2.4, pax: 150_000, staffDays: 130, nonCommuter: 24_300_000, commuter: 7_507_500, concession: 1_100_000, ads: 300_000 },
  { code: 'S09', name: 'みどり台駅', pc: 'PC30', office: '4400', km: 3.25, pax: 140_000, staffDays: 60, nonCommuter: 14_280_000, commuter: 8_575_000, concession: 450_000, ads: 200_000 },
  { code: 'S10', name: '公園前駅', pc: 'PC30', office: '4400', km: 1.8, pax: 45_000, staffDays: 30, nonCommuter: 7_425_000, commuter: 1_890_000, concession: 50_000, ads: 50_000 },
  { code: 'S11', name: '温泉駅', pc: 'PC30', office: '4400', km: 0.95, pax: 60_000, staffDays: 45, nonCommuter: 18_900_000, commuter: 1_470_000, concession: 900_000, ads: 150_000 },
];

const stationSeg = (s: Station) => segmentKey({ region: s.code, profitCenter: s.pc });
/** 駅のセグメントと、線区全体（駅未設定）のセグメント */
export const RAIL_SEG = {
  ...Object.fromEntries(RAIL_STATIONS.map((s) => [s.code, stationSeg(s)])),
  MAIN: segmentKey({ profitCenter: 'PC20' }),
  BRANCH: segmentKey({ profitCenter: 'PC30' }),
} as Record<string, string> & { MAIN: string; BRANCH: string };

const cc = (id: string): ObjRef => ({ type: 'CCTR', id });
const wbs = (id: string): ObjRef => ({ type: 'WBS', id });
const seg = (id: string): ObjRef => ({ type: 'PSEG', id });
const stationObj = (code: string) => seg(RAIL_SEG[code]!);
const stations = (pred: (s: Station) => boolean = () => true) => RAIL_STATIONS.filter(pred);
const skfOnStations = (value: (s: Station) => number) => RAIL_STATIONS.map((s) => ({ obj: stationObj(s.code), value: value(s) }));

// ---------- 原価センタ（人数は SKF「人員」と給与の計算に使う） ----------
interface Dept {
  id: string;
  name: string;
  pc: string;
  kind: 'ADMIN' | 'PROD' | 'SALES' | 'SERVICE';
  tier: 'CORPORATE' | 'SUPPORT' | 'OPERATING';
  group: string;
  hc: number;
  /** 1人あたりの月の給与（賞与の引当を含む） */
  pay: number;
  /** 端末台数（情報システム部の配賦基準） */
  pcs: number;
}

const DEPTS: Dept[] = [
  { id: '1000', name: '経営企画部', pc: 'PC10', kind: 'ADMIN', tier: 'CORPORATE', group: 'CCG-HQ', hc: 6, pay: 620_000, pcs: 8 },
  { id: '1010', name: '総務人事部', pc: 'PC10', kind: 'ADMIN', tier: 'CORPORATE', group: 'CCG-HQ', hc: 8, pay: 600_000, pcs: 10 },
  { id: '1020', name: '経理部', pc: 'PC10', kind: 'ADMIN', tier: 'CORPORATE', group: 'CCG-HQ', hc: 6, pay: 580_000, pcs: 8 },
  { id: '1090', name: '本社共通費（本社ビル）', pc: 'PC10', kind: 'ADMIN', tier: 'CORPORATE', group: 'CCG-HQ', hc: 0, pay: 0, pcs: 0 },
  { id: '1100', name: '情報システム部', pc: 'PC10', kind: 'SERVICE', tier: 'SUPPORT', group: 'CCG-HQ', hc: 8, pay: 600_000, pcs: 0 },
  { id: '2100', name: '運輸指令所', pc: 'PC10', kind: 'SERVICE', tier: 'SUPPORT', group: 'CCG-TECH', hc: 14, pay: 560_000, pcs: 20 },
  { id: '2200', name: '電気部（電力・信号通信）', pc: 'PC10', kind: 'SERVICE', tier: 'SUPPORT', group: 'CCG-TECH', hc: 22, pay: 560_000, pcs: 15 },
  { id: '2300', name: '工務部（保線）', pc: 'PC10', kind: 'SERVICE', tier: 'SUPPORT', group: 'CCG-TECH', hc: 24, pay: 550_000, pcs: 12 },
  { id: '2400', name: '車両部（車両基地）', pc: 'PC10', kind: 'SERVICE', tier: 'SUPPORT', group: 'CCG-TECH', hc: 28, pay: 540_000, pcs: 14 },
  { id: '2500', name: '工事所（直営工事班）', pc: 'PC10', kind: 'SERVICE', tier: 'SUPPORT', group: 'CCG-TECH', hc: 16, pay: 540_000, pcs: 6 },
  { id: '3100', name: '運転区（乗務員）', pc: 'PC10', kind: 'PROD', tier: 'OPERATING', group: 'CCG-OPS', hc: 68, pay: 520_000, pcs: 30 },
  { id: '3200', name: '動力費（購入電力）', pc: 'PC10', kind: 'PROD', tier: 'OPERATING', group: 'CCG-OPS', hc: 0, pay: 0, pcs: 0 },
  { id: '4100', name: '中央駅管区', pc: 'PC20', kind: 'SALES', tier: 'OPERATING', group: 'CCG-STATION', hc: 18, pay: 480_000, pcs: 25 },
  { id: '4200', name: '川辺駅管区', pc: 'PC20', kind: 'SALES', tier: 'OPERATING', group: 'CCG-STATION', hc: 11, pay: 480_000, pcs: 12 },
  { id: '4300', name: '港駅管区', pc: 'PC20', kind: 'SALES', tier: 'OPERATING', group: 'CCG-STATION', hc: 8, pay: 480_000, pcs: 8 },
  { id: '4400', name: 'みどり台駅管区', pc: 'PC30', kind: 'SALES', tier: 'OPERATING', group: 'CCG-STATION', hc: 3, pay: 480_000, pcs: 4 },
];
const OPS_CCTRS = ['2100', '2200', '2300', '2400', '2500', '3100', '4100', '4200', '4300', '4400'];

const master: Master = {
  controllingArea: 'A000',
  companyCode: '2010',
  period: RAILWAY_PERIOD,
  currency: 'JPY',
  accounts: ACCOUNTS,
  profitCenters: [
    { id: 'PC10', name: '本社', groupId: 'PCG-ALL' },
    { id: 'PC20', name: '本線', groupId: 'PCG-ALL' },
    { id: 'PC30', name: 'みどり台線', groupId: 'PCG-ALL' },
  ],
  costCenters: DEPTS.map((d) => ({ id: d.id, name: d.name, profitCenter: d.pc, kind: d.kind, tier: d.tier, groupId: d.group })),
  wbs: [
    { id: 'P-100', name: '出改札システム更改（費用分）', projectType: 'OVERHEAD', responsibleCctr: '1100', profitCenter: 'PC10', statistical: false, settlementProfileId: 'SP-RAIL' },
    { id: 'P-110', name: '架空電車線張替え（新町〜港）', projectType: 'OVERHEAD', responsibleCctr: '2200', profitCenter: 'PC20', statistical: false, settlementProfileId: 'SP-RAIL' },
    { id: 'P-120', name: 'レール交換（みどり台線）', projectType: 'OVERHEAD', responsibleCctr: '2300', profitCenter: 'PC30', statistical: false, settlementProfileId: 'SP-RAIL' },
    { id: 'P-130', name: '港駅 駅舎外壁修繕', projectType: 'OVERHEAD', responsibleCctr: '4300', profitCenter: 'PC20', statistical: false, settlementProfileId: 'SP-RAIL' },
  ],
  activityTypes: [{ id: 'KOJI', name: '工事作業時間', unit: '時間', allocAccount: '94300000', rates: [{ cctr: '2500', planRate: 6_500 }] }],
  skfs: [
    { id: 'HC', name: '人員', unit: '人', values: DEPTS.filter((d) => d.hc > 0).map((d) => ({ obj: cc(d.id), value: d.hc })) },
    { id: 'PCS', name: '端末台数', unit: '台', values: DEPTS.filter((d) => d.pcs > 0).map((d) => ({ obj: cc(d.id), value: d.pcs })) },
    {
      id: 'FLOOR',
      name: '本社ビル床面積',
      unit: 'm²',
      values: [
        { obj: cc('1000'), value: 300 },
        { obj: cc('1010'), value: 400 },
        { obj: cc('1020'), value: 250 },
        { obj: cc('1100'), value: 350 },
      ],
    },
    { id: 'PAX', name: '乗車人員', unit: '人', values: skfOnStations((s) => s.pax) },
    { id: 'STAFF', name: '駅務量', unit: '人日', values: skfOnStations((s) => s.staffDays) },
    { id: 'SECKM', name: '駅勢キロ', unit: 'km', values: skfOnStations((s) => s.km) },
    { id: 'TRKM', name: '列車キロ（駅勢区間）', unit: '列車km', values: skfOnStations((s) => Math.round(s.km * TRAINS[s.pc])) },
    { id: 'CARKM', name: '車両キロ（駅勢区間）', unit: '車両km', values: skfOnStations((s) => Math.round(s.km * TRAINS[s.pc] * CARS[s.pc])) },
  ],
  segments: [
    ...RAIL_STATIONS.map((s) => ({ id: stationSeg(s), name: s.name, chars: { region: s.code, profitCenter: s.pc }, attributed: false })),
    { id: RAIL_SEG.MAIN, name: '本線（駅未設定）', chars: { profitCenter: 'PC20' }, attributed: false },
    { id: RAIL_SEG.BRANCH, name: 'みどり台線（駅未設定）', chars: { profitCenter: 'PC30' }, attributed: false },
  ],
  settlementProfiles: [
    {
      id: 'SP-RAIL',
      allowed: ['CCTR', 'WBS', 'PSEG'],
      structure: [
        { accounts: [R.revenue], settleAccount: 'KEEP' },
        { accounts: [R.allCosts], settleAccount: '94900000' },
      ],
    },
  ],
  groups: [
    { id: 'PCG-ALL', type: 'PCTR', name: '全社', members: ['PC10', 'PC20', 'PC30'] },
    { id: 'CCG-HQ', type: 'CCTR', name: '本社部門', members: DEPTS.filter((d) => d.group === 'CCG-HQ').map((d) => d.id) },
    { id: 'CCG-TECH', type: 'CCTR', name: '技術・輸送部門', members: DEPTS.filter((d) => d.group === 'CCG-TECH').map((d) => d.id) },
    { id: 'CCG-OPS', type: 'CCTR', name: '運転部門', members: ['3100', '3200'] },
    { id: 'CCG-STATION', type: 'CCTR', name: '駅管区', members: DEPTS.filter((d) => d.group === 'CCG-STATION').map((d) => d.id) },
  ],
};

// ---------- 一次仕訳（1か月分。売上は貸方なのでマイナス） ----------
const postings: PrimaryPosting[] = [];
let seq = 0;
const P = (account: string, obj: ObjRef, amount: number, text: string) => {
  postings.push({ id: `PP-${String(++seq).padStart(3, '0')}`, account, obj, amount, text });
};

// 収入：駅で売った分は駅のセグメントへ、Web・定期券センターの定期と車内広告は線区全体へ
for (const s of RAIL_STATIONS) {
  P('41100000', stationObj(s.code), -s.nonCommuter, `定期外運賃 ${s.name}発売`);
  P('41200000', stationObj(s.code), -s.commuter, `定期運賃 ${s.name}発売`);
  P('41300000', stationObj(s.code), -s.concession, `構内営業料 ${s.name}`);
  P('41400000', stationObj(s.code), -s.ads, `駅構内広告 ${s.name}`);
}
P('41200000', seg(RAIL_SEG.MAIN), -52_838_250, '定期運賃 Web・定期券センター発売（本線）');
P('41200000', seg(RAIL_SEG.BRANCH), -5_115_000, '定期運賃 Web・定期券センター発売（みどり台線）');
P('41400000', seg(RAIL_SEG.MAIN), -7_200_000, '車内広告（本線）');
P('41400000', seg(RAIL_SEG.BRANCH), -600_000, '車内広告（みどり台線）');

// 人件費：人数×1人あたりの給与、法定福利費は給与の15%
for (const d of DEPTS.filter((x) => x.hc > 0)) {
  P('51000000', cc(d.id), d.hc * d.pay, `${d.name} 給与（${d.hc}人）`);
  P('51200000', cc(d.id), Math.round(d.hc * d.pay * 0.15), `${d.name} 法定福利費`);
}

// 動力費：車両キロ 約94万 × 約1.93kWh × 19円
P('52100000', cc('3200'), 34_400_000, '購入電力（運転用 約181万kWh）');

// 修繕費・材料費
P('53000000', cc('2200'), 14_000_000, '変電所・信号設備の保守（外注）');
P('53000000', cc('2300'), 22_000_000, '軌道整備・除草（外注）');
P('53000000', cc('2400'), 18_000_000, '車両の重要部検査（外注）');
P('53000000', cc('4100'), 1_800_000, 'エスカレーター・エレベーター保守');
P('53000000', cc('4200'), 600_000, '駅設備の修繕');
P('53000000', cc('4300'), 400_000, '駅設備の修繕');
P('53000000', cc('4400'), 300_000, '駅設備の修繕');
P('53100000', cc('2200'), 2_100_000, '電気設備の保守材料');
P('53100000', cc('2300'), 3_200_000, 'レール・まくらぎ（保守用）');
P('53100000', cc('2400'), 4_500_000, '車両部品');
P('53000000', wbs('P-110'), 16_000_000, 'トロリ線張替え工事（外注）');
P('53100000', wbs('P-110'), 5_400_000, 'トロリ線・ハンガ');
P('53000000', wbs('P-120'), 9_000_000, 'レール交換工事（外注）');
P('53100000', wbs('P-120'), 4_800_000, '50kgNレール');
P('53000000', wbs('P-130'), 6_500_000, '港駅 外壁塗装・防水');

// 業務委託費
P('54000000', cc('4400'), 6_200_000, '駅業務委託（みどり台線3駅）');
P('54000000', cc('4300'), 1_800_000, '駅業務委託（工業団地駅）');
P('54000000', cc('4100'), 3_600_000, '駅清掃・警備委託');
P('54000000', cc('4200'), 1_500_000, '駅清掃委託');
P('54000000', cc('2400'), 2_800_000, '車両清掃委託');
P('54000000', cc('2300'), 1_200_000, '踏切保安委託');
P('54000000', cc('1010'), 800_000, '給与計算委託');

// 本社ビル、駅の光熱費、情報システム
P('55000000', cc('1090'), 4_200_000, '本社ビル賃借料');
P('55100000', cc('1090'), 600_000, '本社ビル水道光熱費');
P('55100000', cc('4100'), 2_400_000, '駅の電灯・空調電力');
P('55100000', cc('4200'), 900_000, '駅の電灯・空調電力');
P('55100000', cc('4300'), 700_000, '駅の電灯・空調電力');
P('55100000', cc('4400'), 450_000, '駅の電灯・空調電力');
P('56000000', cc('1100'), 5_600_000, '出改札・IC システム保守、クラウド利用料');
P('56000000', wbs('P-100'), 3_800_000, '出改札システム更改（費用分）');

// 減価償却費（設備を持つ部門に計上）と租税公課（固定資産税など）
P('57000000', cc('2200'), 32_000_000, '電路設備（架空電車線・変電所・信号）');
P('57000000', cc('2300'), 38_000_000, '線路設備（軌道・橋りょう・トンネル）');
P('57000000', cc('2400'), 36_000_000, '車両（約90両）');
P('57000000', cc('4100'), 9_500_000, '駅舎・ホームドア（中央駅管区）');
P('57000000', cc('4200'), 3_800_000, '駅舎（川辺駅管区）');
P('57000000', cc('4300'), 2_600_000, '駅舎（港駅管区）');
P('57000000', cc('4400'), 1_600_000, '駅舎（みどり台駅管区）');
P('57000000', cc('1100'), 4_200_000, '出改札機器・IC システム');
P('57000000', cc('2500'), 600_000, '工事用車両');
P('58000000', cc('2300'), 9_500_000, '固定資産税（線路設備）');
P('58000000', cc('2200'), 6_000_000, '固定資産税（電路設備）');
P('58000000', cc('2400'), 4_500_000, '固定資産税（車両）');
P('58000000', cc('4100'), 2_000_000, '固定資産税（駅舎）');
P('58000000', cc('1020'), 200_000, '印紙税など');

// その他経費
P('59000000', cc('1000'), 3_000_000, '案内宣伝費（沿線観光キャンペーン）');
P('59000000', cc('2100'), 1_500_000, '指令システム通信費');
P('59000000', cc('3100'), 900_000, '乗務員の被服・旅費');
P('59000000', cc('4100'), 800_000, '駅の案内表示・消耗品');

// ---------- ルール ----------
const skf = (skfId: string): TracingFactor => ({ kind: 'SKF', skfId });
const toStations = (pred?: (s: Station) => boolean) => ({ type: 'PSEG' as const, mode: 'LIST' as const, ids: stations(pred).map((s) => stationSeg(s)) });

/** 部門 → 駅（マージン分析）。区分ごとに二次勘定を分け、駅の損益で営業費の区分が見えるようにする */
const maSegments = (infraFactor: TracingFactor): AllocationCycle['segments'] => [
  ...(['4100', '4200', '4300', '4400'] as const).map((office, i) => ({
    id: `MA-0${i + 1}`,
    name: `${DEPTS.find((d) => d.id === office)!.name} → 受け持ちの駅（駅務量）`,
    sender: { objects: { type: 'CCTR' as const, mode: 'LIST' as const, ids: [office] }, accounts: [R.allCosts], sharePct: 100 },
    receiver: { objects: toStations((s) => s.office === office), factor: skf('STAFF') },
    allocAccount: '94110000',
  })),
  {
    id: 'MA-05',
    name: '運転区 → 駅（列車キロ）',
    sender: { objects: { type: 'CCTR', mode: 'LIST', ids: ['3100'] }, accounts: [R.allCosts], sharePct: 100 },
    receiver: { objects: toStations(), factor: skf('TRKM') },
    allocAccount: '94120000',
  },
  {
    id: 'MA-06',
    name: '動力費 → 駅（車両キロ）',
    sender: { objects: { type: 'CCTR', mode: 'LIST', ids: ['3200'] }, accounts: [R.allCosts], sharePct: 100 },
    receiver: { objects: toStations(), factor: skf('CARKM') },
    allocAccount: '94130000',
  },
  {
    id: 'MA-07',
    name: '車両部 → 駅（車両キロ）',
    sender: { objects: { type: 'CCTR', mode: 'LIST', ids: ['2400'] }, accounts: [R.allCosts], sharePct: 100 },
    receiver: { objects: toStations(), factor: skf('CARKM') },
    allocAccount: '94140000',
  },
  {
    id: 'MA-08',
    name: `電気部・工務部 → 駅（${infraFactor.kind === 'SKF' && infraFactor.skfId === 'PAX' ? '乗車人員' : '駅勢キロ'}）`,
    sender: { objects: { type: 'CCTR', mode: 'LIST', ids: ['2200', '2300'] }, accounts: [R.allCosts], sharePct: 100 },
    receiver: { objects: toStations(), factor: infraFactor },
    allocAccount: '94150000',
  },
  {
    id: 'MA-09',
    name: '運輸指令所 → 駅（列車キロ）',
    sender: { objects: { type: 'CCTR', mode: 'LIST', ids: ['2100'] }, accounts: [R.allCosts], sharePct: 100 },
    receiver: { objects: toStations(), factor: skf('TRKM') },
    allocAccount: '94160000',
  },
];

const maCycle = (segments: AllocationCycle['segments']): AllocationCycle => ({
  id: 'CY-MA',
  name: '部門の費用 → 駅別収支',
  context: 'MA',
  type: 'OVERHEAD',
  iterative: false,
  segments,
});

const rules: Omit<Scenario, 'id' | 'name' | 'memo' | 'steps'> = {
  activityAllocs: [
    { id: 'AA-01', senderCctr: '2500', activityType: 'KOJI', receiver: wbs('P-110'), quantity: 1_000 },
    { id: 'AA-02', senderCctr: '2500', activityType: 'KOJI', receiver: wbs('P-120'), quantity: 800 },
    { id: 'AA-03', senderCctr: '2500', activityType: 'KOJI', receiver: wbs('P-130'), quantity: 150 },
  ],
  costingSheets: [
    { id: 'CS-01', rows: [{ base: [R.repairs], ratePct: 6, creditCctr: '2200', overheadAccount: '94200000' }], targets: [wbs('P-110')] },
    { id: 'CS-02', rows: [{ base: [R.repairs], ratePct: 6, creditCctr: '2300', overheadAccount: '94200000' }], targets: [wbs('P-120'), wbs('P-130')] },
  ],
  settlementRules: [
    { id: 'SR-P100', sender: wbs('P-100'), rules: [{ receiver: cc('1100'), basis: 'PCT', value: 100, settlementType: 'FUL', validFrom: 202604 }] },
    {
      id: 'SR-P110',
      sender: wbs('P-110'),
      // 張り替えた区間（新町〜港）の駅へ、駅勢キロの比で
      rules: [
        { receiver: stationObj('S06'), basis: 'EQUIV', value: 41, settlementType: 'FUL', validFrom: 202604 },
        { receiver: stationObj('S07'), basis: 'EQUIV', value: 47, settlementType: 'FUL', validFrom: 202604 },
        { receiver: stationObj('S08'), basis: 'EQUIV', value: 24, settlementType: 'FUL', validFrom: 202604 },
      ],
    },
    {
      id: 'SR-P120',
      sender: wbs('P-120'),
      rules: [
        { receiver: stationObj('S09'), basis: 'EQUIV', value: 325, settlementType: 'FUL', validFrom: 202604 },
        { receiver: stationObj('S10'), basis: 'EQUIV', value: 180, settlementType: 'FUL', validFrom: 202604 },
        { receiver: stationObj('S11'), basis: 'EQUIV', value: 95, settlementType: 'FUL', validFrom: 202604 },
      ],
    },
    { id: 'SR-P130', sender: wbs('P-130'), rules: [{ receiver: stationObj('S08'), basis: 'PCT', value: 100, settlementType: 'FUL', validFrom: 202604 }] },
  ],
  cycles: [
    {
      id: 'CY-DIST',
      name: '本社ビル費の配布',
      context: 'CCTR',
      type: 'DISTRIBUTION',
      iterative: false,
      segments: [
        {
          id: 'DS-01',
          name: '本社ビル → 本社部門（床面積）',
          sender: { objects: { type: 'CCTR', mode: 'LIST', ids: ['1090'] }, accounts: [R.hqBuilding], sharePct: 100 },
          receiver: { objects: { type: 'CCTR', mode: 'LIST', ids: ['1000', '1010', '1020', '1100'] }, factor: skf('FLOOR') },
        },
      ],
    },
    {
      id: 'CY-ASSESS',
      name: '本社部門の配賦（反復）',
      context: 'CCTR',
      type: 'OVERHEAD',
      iterative: true,
      segments: [
        {
          id: 'AS-01',
          name: '総務人事部 → 各部門（人員）',
          sender: { objects: { type: 'CCTR', mode: 'LIST', ids: ['1010'] }, accounts: [R.allCosts], sharePct: 100 },
          receiver: { objects: { type: 'CCTR', mode: 'LIST', ids: ['1000', '1020', '1100', ...OPS_CCTRS] }, factor: skf('HC') },
          allocAccount: '94100000',
        },
        {
          id: 'AS-02',
          name: '情報システム部 → 各部門（端末台数）',
          sender: { objects: { type: 'CCTR', mode: 'LIST', ids: ['1100'] }, accounts: [R.allCosts], sharePct: 100 },
          receiver: { objects: { type: 'CCTR', mode: 'LIST', ids: ['1000', '1010', '1020', ...OPS_CCTRS] }, factor: skf('PCS') },
          allocAccount: '94100000',
        },
        {
          id: 'AS-03',
          name: '経営企画部・経理部 → 現業部門（人員）',
          sender: { objects: { type: 'CCTR', mode: 'LIST', ids: ['1000', '1020'] }, accounts: [R.allCosts], sharePct: 100 },
          receiver: { objects: { type: 'CCTR', mode: 'LIST', ids: OPS_CCTRS }, factor: skf('HC') },
          allocAccount: '94100000',
        },
      ],
    },
    maCycle(maSegments(skf('SECKM'))),
  ],
  tddRules: [
    {
      id: 'TDD-01',
      name: 'Web・定期券センターの定期 → 駅（駅で売った定期の比）',
      sender: { segments: { type: 'PSEG', mode: 'FILTER', chars: {} }, accounts: [{ from: '41200000', to: '41299999' }] },
      distributeChars: ['region'],
      reference: { accounts: [{ from: '41200000', to: '41299999' }], source: 'CURRENT_PERIOD' },
    },
    {
      id: 'TDD-02',
      name: '車内広告 → 駅（定期外運賃の比）',
      sender: { segments: { type: 'PSEG', mode: 'FILTER', chars: {} }, accounts: [{ from: '41400000', to: '41499999' }] },
      distributeChars: ['region'],
      reference: { accounts: [{ from: '41100000', to: '41199999' }], source: 'CURRENT_PERIOD' },
    },
  ],
};

const items = {
  'ST-01': ['AA-01', 'AA-02', 'AA-03'],
  'ST-02': ['CS-01', 'CS-02'],
  'ST-03': ['SR-P100'],
  'ST-04': ['CY-DIST'],
  'ST-05': ['CY-ASSESS'],
  'ST-07': ['SR-P110', 'SR-P120', 'SR-P130'],
  'ST-08': ['CY-MA'],
  'ST-09': ['TDD-01', 'TDD-02'],
};

const defaultScenario: Scenario = {
  id: 'S-DEFAULT',
  name: '標準：設備は駅勢キロ、運行は列車キロ',
  memo: '線路・電路の保存費は駅が受け持つ区間の長さ（駅勢キロ）、運転費・輸送管理費は列車キロ、車両保存費と動力費は車両キロ、駅務費は駅務量で駅へ配る。本社費は人員などで部門へ配賦してから流す。',
  ...rules,
  steps: stepsFromTemplate(items),
};

/** 線路・電路の保存費を乗車人員で配る案。利用の多い駅が設備費を多く持ち、利用の少ない駅の収支が良く見える */
const paxScenario: Scenario = {
  id: 'S-PAX',
  name: '線路・電路の保存費を乗車人員で',
  memo: '設備は使う人が多い駅ほど負担すべき、という考え方の案。末端の駅（温泉駅、公園前駅）の負担が軽くなり、中央駅の負担が重くなる。',
  ...rules,
  cycles: rules.cycles.map((c) => (c.id === 'CY-MA' ? maCycle(maSegments(skf('PAX'))) : c)),
  steps: stepsFromTemplate(items),
};

/** 本社費を部門経由で流さず、運賃収入の比で駅へ直接配る案 */
const hqScenario: Scenario = {
  id: 'S-HQREV',
  name: '本社費を運賃収入の比で駅へ',
  memo: '本社部門の配賦（ステップ5）をオフにし、本社部門と情報システム部の費用を、マージン分析で運賃収入の比で駅へ直接配る案。工事所の実績レートも本社費を含まなくなる。',
  ...rules,
  cycles: rules.cycles.map((c) =>
    c.id === 'CY-MA'
      ? maCycle([
          {
            id: 'MA-00',
            name: '本社部門 → 駅（運賃収入）',
            sender: { objects: { type: 'CCTR', mode: 'LIST', ids: ['1000', '1010', '1020', '1100'] }, accounts: [R.allCosts], sharePct: 100 },
            receiver: { objects: toStations(), factor: { kind: 'VARIABLE', accounts: [R.fares] } },
            allocAccount: '94100000',
          },
          ...maSegments(skf('SECKM')),
        ])
      : c,
  ),
  steps: stepsFromTemplate(items).map((s) => (s.id === 'ST-05' ? { ...s, enabled: false } : s)),
};

const RAILWAY: Project = { schemaVersion: 1, master, primaryPostings: postings, scenarios: [defaultScenario, paxScenario, hqScenario] };

/** みどり川電鉄のプロジェクト（毎回新しい写しを返す） */
export const railwayProject = (): Project => structuredClone(RAILWAY);

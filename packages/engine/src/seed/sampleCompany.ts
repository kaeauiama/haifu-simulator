/**
 * サンプル会社「サンプル商事」（8.1）。シードデータとして同梱し、F2-03 で生成する。テストもこの会社を使う。
 * マスタと一次仕訳は 8.1 の表のとおり（1000 の給与は D-017 で追加）。シナリオのルールは、5.1 の各ステップを一通り動かすための例（D-010）。
 */
import { segmentKey } from '../model/keys.ts';
import type { Master, PrimaryPosting, Project, Scenario } from '../model/types.ts';
import { stepsFromTemplate } from './template.ts';
import { ACCOUNT_RANGES, YCOA_MOCK_ACCOUNTS } from './ycoa.ts';

/** 会計期間（YYYYMM、D-009） */
export const SAMPLE_PERIOD = 202610;

export const SEG = {
  A_PG1: segmentKey({ customer: 'A', productGroup: 'PG1', profitCenter: 'PC20' }),
  B_PG1: segmentKey({ customer: 'B', productGroup: 'PG1', profitCenter: 'PC20' }),
  C_PG1: segmentKey({ customer: 'C', productGroup: 'PG1', profitCenter: 'PC20' }),
  /** 全社×PG1（顧客未設定） */
  ALL_PG1: segmentKey({ productGroup: 'PG1', profitCenter: 'PC20' }),
  /** 顧客A×サービス。C-200 の属性セグメント */
  A_SVC: segmentKey({ customer: 'A', productGroup: 'SVC', profitCenter: 'PC30' }),
} as const;

const master: Master = {
  controllingArea: 'A000',
  companyCode: '1010',
  period: SAMPLE_PERIOD,
  currency: 'JPY',
  accounts: [...YCOA_MOCK_ACCOUNTS],
  profitCenters: [
    { id: 'PC10', name: '本社', groupId: 'PCG-ALL' },
    { id: 'PC20', name: '製品事業', groupId: 'PCG-ALL' },
    { id: 'PC30', name: 'サービス事業', groupId: 'PCG-ALL' },
  ],
  costCenters: [
    { id: '1000', name: '管理部', profitCenter: 'PC10', kind: 'ADMIN', groupId: 'CCG-SUPPORT' },
    { id: '1100', name: 'IT部', profitCenter: 'PC10', kind: 'SERVICE', groupId: 'CCG-SUPPORT' },
    { id: '2000', name: '製造部', profitCenter: 'PC20', kind: 'PROD', groupId: 'CCG-OPS' },
    { id: '2100', name: '製品営業部', profitCenter: 'PC20', kind: 'SALES', groupId: 'CCG-OPS' },
    { id: '3000', name: 'サービス部', profitCenter: 'PC30', kind: 'SERVICE', groupId: 'CCG-OPS' },
  ],
  wbs: [
    {
      id: 'P-100',
      name: '社内システム刷新',
      projectType: 'OVERHEAD',
      responsibleCctr: '1100',
      profitCenter: 'PC10',
      statistical: false,
      settlementProfileId: 'SP-OH',
    },
    {
      id: 'C-200',
      name: '顧客A保守案件',
      projectType: 'CUSTOMER',
      responsibleCctr: '3000',
      profitCenter: 'PC30',
      statistical: false,
      attributedSegment: SEG.A_SVC,
    },
  ],
  activityTypes: [{ id: 'ENG', name: '技術工数', unit: '時間', allocAccount: '94300000', rates: [{ cctr: '3000', planRate: 8000 }] }],
  skfs: [
    {
      id: 'HC',
      name: '人数',
      unit: '人',
      values: [
        { obj: { type: 'CCTR', id: '1000' }, value: 5 },
        { obj: { type: 'CCTR', id: '1100' }, value: 4 },
        { obj: { type: 'CCTR', id: '2000' }, value: 20 },
        { obj: { type: 'CCTR', id: '2100' }, value: 8 },
        { obj: { type: 'CCTR', id: '3000' }, value: 12 },
      ],
    },
  ],
  segments: [
    { id: SEG.A_PG1, chars: { customer: 'A', productGroup: 'PG1', profitCenter: 'PC20' }, attributed: false },
    { id: SEG.B_PG1, chars: { customer: 'B', productGroup: 'PG1', profitCenter: 'PC20' }, attributed: false },
    { id: SEG.C_PG1, chars: { customer: 'C', productGroup: 'PG1', profitCenter: 'PC20' }, attributed: false },
    { id: SEG.ALL_PG1, chars: { productGroup: 'PG1', profitCenter: 'PC20' }, attributed: false },
    { id: SEG.A_SVC, chars: { customer: 'A', productGroup: 'SVC', profitCenter: 'PC30' }, attributed: true },
  ],
  settlementProfiles: [
    {
      id: 'SP-OH',
      allowed: ['CCTR', 'WBS', 'PSEG'],
      structure: [
        { accounts: [ACCOUNT_RANGES.revenue], settleAccount: 'KEEP' },
        { accounts: [ACCOUNT_RANGES.allCosts], settleAccount: '94900000' },
      ],
    },
  ],
  groups: [
    { id: 'PCG-ALL', type: 'PCTR', name: '全社', members: ['PC10', 'PC20', 'PC30'] },
    { id: 'CCG-SUPPORT', type: 'CCTR', name: '補助部門', members: ['1000', '1100'] },
    { id: 'CCG-OPS', type: 'CCTR', name: '事業部門', members: ['2000', '2100', '3000'] },
  ],
};

const P = (id: string, account: string, obj: PrimaryPosting['obj'], amount: number, text: string): PrimaryPosting => ({
  id,
  account,
  obj,
  amount,
  text,
});
const cc = (id: string) => ({ type: 'CCTR' as const, id });
const wbs = (id: string) => ({ type: 'WBS' as const, id });
const seg = (id: string) => ({ type: 'PSEG' as const, id });

/** 8.1 の一次仕訳。売上は貸方なのでマイナス */
const primaryPostings: PrimaryPosting[] = [
  P('PP-010', '61000000', cc('1000'), 1_000_000, '管理部 給与'),
  P('PP-001', '61000000', cc('1100'), 4_000_000, 'IT部 給与'),
  P('PP-002', '65000000', cc('1100'), 1_000_000, 'IT部 減価償却'),
  P('PP-003', '66000000', wbs('P-100'), 3_000_000, '社内システム刷新 外注費'),
  P('PP-004', '66000000', wbs('C-200'), 1_500_000, '顧客A保守 外注費'),
  P('PP-005', '61000000', cc('3000'), 2_700_000, 'サービス部 給与'),
  P('PP-006', '41000000', seg(SEG.A_PG1), -6_000_000, '製品売上 顧客A'),
  P('PP-007', '41000000', seg(SEG.B_PG1), -3_000_000, '製品売上 顧客B'),
  P('PP-008', '41000000', seg(SEG.C_PG1), -1_000_000, '製品売上 顧客C'),
  P('PP-009', '68000000', seg(SEG.ALL_PG1), 300_000, '運賃 全社×PG1'),
];

const rules: Omit<Scenario, 'id' | 'name' | 'memo' | 'steps'> = {
  activityAllocs: [{ id: 'AA-01', senderCctr: '3000', activityType: 'ENG', receiver: wbs('C-200'), quantity: 300 }],
  costingSheets: [
    {
      id: 'CS-01',
      rows: [{ base: [{ from: '66000000', to: '66999999' }], ratePct: 10, creditCctr: '1000', overheadAccount: '94200000' }],
      targets: [wbs('C-200')],
    },
  ],
  settlementRules: [
    {
      id: 'SR-P100',
      sender: wbs('P-100'),
      rules: [{ receiver: cc('1100'), basis: 'PCT', value: 100, settlementType: 'FUL', validFrom: 202604 }],
    },
  ],
  cycles: [
    {
      id: 'CY-DIST',
      name: 'IT部 減価償却費の配布',
      context: 'CCTR',
      type: 'DISTRIBUTION',
      iterative: false,
      segments: [
        {
          id: 'DS-01',
          name: 'IT部→事業部門（人数）',
          sender: { objects: { type: 'CCTR', mode: 'LIST', ids: ['1100'] }, accounts: [{ from: '65000000', to: '65999999' }], sharePct: 100 },
          receiver: { objects: { type: 'CCTR', mode: 'GROUP', groupId: 'CCG-OPS' }, factor: { kind: 'SKF', skfId: 'HC' } },
        },
      ],
    },
    {
      id: 'CY-ASSESS',
      name: '補助部門の配賦（反復）',
      context: 'CCTR',
      type: 'OVERHEAD',
      iterative: true,
      segments: [
        {
          id: 'AS-01',
          name: '管理部（人数）',
          sender: { objects: { type: 'CCTR', mode: 'LIST', ids: ['1000'] }, accounts: [ACCOUNT_RANGES.allCosts], sharePct: 100 },
          receiver: { objects: { type: 'CCTR', mode: 'LIST', ids: ['1100', '2000', '2100', '3000'] }, factor: { kind: 'SKF', skfId: 'HC' } },
          allocAccount: '94100000',
        },
        {
          id: 'AS-02',
          name: 'IT部（人数）',
          sender: { objects: { type: 'CCTR', mode: 'LIST', ids: ['1100'] }, accounts: [ACCOUNT_RANGES.allCosts], sharePct: 100 },
          receiver: { objects: { type: 'CCTR', mode: 'LIST', ids: ['1000', '2000', '2100', '3000'] }, factor: { kind: 'SKF', skfId: 'HC' } },
          allocAccount: '94100000',
        },
      ],
    },
    {
      id: 'CY-MA',
      name: '製品事業部門→マージン分析',
      context: 'MA',
      type: 'OVERHEAD',
      iterative: false,
      segments: [
        {
          id: 'MA-01',
          name: '製造部・製品営業部→全社×PG1',
          sender: { objects: { type: 'CCTR', mode: 'LIST', ids: ['2000', '2100'] }, accounts: [ACCOUNT_RANGES.allCosts], sharePct: 100 },
          receiver: {
            objects: { type: 'PSEG', mode: 'LIST', ids: [SEG.ALL_PG1] },
            factor: { kind: 'FIXED_PERCENT', weights: [{ obj: seg(SEG.ALL_PG1), pct: 100 }] },
          },
          allocAccount: '94100000',
        },
      ],
    },
  ],
  tddRules: [
    {
      id: 'TDD-01',
      name: '全社×PG1を顧客別に',
      sender: { segments: { type: 'PSEG', mode: 'FILTER', chars: { productGroup: 'PG1' } }, accounts: [ACCOUNT_RANGES.allCosts] },
      distributeChars: ['customer'],
      reference: { accounts: [ACCOUNT_RANGES.revenue], source: 'CURRENT_PERIOD' },
    },
  ],
};

const defaultItems = {
  'ST-01': ['AA-01'],
  'ST-02': ['CS-01'],
  'ST-03': ['SR-P100'],
  'ST-04': ['CY-DIST'],
  'ST-05': ['CY-ASSESS'],
  'ST-08': ['CY-MA'],
  'ST-09': ['TDD-01'],
};

const defaultScenario: Scenario = {
  id: 'S-DEFAULT',
  name: '既定順（標準テンプレート）',
  memo: '5.1 の既定順。間接費計算と決済①を配賦の前に回す。',
  ...rules,
  steps: stepsFromTemplate(defaultItems),
};

/** 間接費計算と決済①を、原価センタの配賦の後に回した案（ワークショップでの主な比較） */
const lateScenario: Scenario = {
  id: 'S-LATE',
  name: '間接費計算と決済①を配賦の後に',
  memo: '5.1 の2つの依存を逆にした案。1000がマイナスになり、1100に決済額が残る。',
  ...rules,
  steps: (() => {
    const s = stepsFromTemplate(defaultItems);
    const byId = new Map(s.map((x) => [x.id, x]));
    return ['ST-01', 'ST-04', 'ST-05', 'ST-02', 'ST-03', 'ST-06', 'ST-07', 'ST-08', 'ST-09'].map((id) => byId.get(id)!);
  })(),
};

/** 補助部門の費用を、原価センタではなく利益センタで配る案（PC10 → PC20・PC30、人数の合計 28:12） */
const pcScenario: Scenario = {
  id: 'S-PC',
  name: '本社費を利益センタで配賦',
  memo: '原価センタ間の配賦の代わりに、利益センタ間の配賦で本社（PC10）の費用を事業に配る案。原価センタには残高が残る。',
  ...rules,
  cycles: [
    ...rules.cycles,
    {
      id: 'CY-PC',
      name: '本社費の利益センタ配賦',
      context: 'PCTR',
      type: 'OVERHEAD',
      iterative: false,
      segments: [
        {
          id: 'PC-01',
          name: '本社→製品事業・サービス事業',
          sender: { objects: { type: 'PCTR', mode: 'LIST', ids: ['PC10'] }, accounts: [ACCOUNT_RANGES.allCosts], sharePct: 100 },
          receiver: {
            objects: { type: 'PCTR', mode: 'LIST', ids: ['PC20', 'PC30'] },
            factor: {
              kind: 'FIXED_PORTION',
              weights: [
                { obj: { type: 'PCTR', id: 'PC20' }, portion: 28 },
                { obj: { type: 'PCTR', id: 'PC30' }, portion: 12 },
              ],
            },
          },
          allocAccount: '94100000',
        },
      ],
    },
  ],
  steps: stepsFromTemplate({ ...defaultItems, 'ST-05': ['CY-PC'] }),
};

const SAMPLE: Project = { schemaVersion: 1, master, primaryPostings, scenarios: [defaultScenario, lateScenario, pcScenario] };

/** サンプル商事のプロジェクト（毎回新しい写しを返す） */
export const sampleProject = (): Project => structuredClone(SAMPLE);

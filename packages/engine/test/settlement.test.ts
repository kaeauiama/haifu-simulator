import { describe, expect, it } from 'vitest';
import type { AllocationCycle, SettlementRule } from '../src/model/types.ts';
import { ACCOUNT_RANGES } from '../src/seed/ycoa.ts';
import { bal, cc, codes, emptyScenario, linesOf, run, seg, step, testProject, wbs } from './helpers.ts';
import { SEG } from '../src/seed/sampleCompany.ts';

const settleP100 = (pct = 100): SettlementRule => ({
  id: 'SR-P100',
  sender: wbs('P-100'),
  rules: [{ receiver: cc('1100'), basis: 'PCT', value: pct, settlementType: 'FUL', validFrom: 202604 }],
});

const assess1100: AllocationCycle = {
  id: 'CY-1100',
  name: 'IT部の配賦（人数）',
  context: 'CCTR',
  type: 'OVERHEAD',
  iterative: false,
  segments: [
    {
      id: 'SEG-1',
      name: '1100→2000/2100/3000',
      sender: { objects: { type: 'CCTR', mode: 'LIST', ids: ['1100'] }, accounts: [ACCOUNT_RANGES.allCosts], sharePct: 100 },
      receiver: { objects: { type: 'CCTR', mode: 'LIST', ids: ['2000', '2100', '3000'] }, factor: { kind: 'SKF', skfId: 'HC' } },
      allocAccount: '94100000',
    },
  ],
};

describe('決済（F3-02、5.2）と順序（F4）', () => {
  it('T-06 決済が先：1100の8,000,000円を人数で 4,000,000／1,600,000／2,400,000', () => {
    const sc = emptyScenario([step('ST-S', 'SETTLEMENT', ['SR-P100']), step('ST-A', 'ALLOC_CYCLE', ['CY-1100'])], {
      settlementRules: [settleP100()],
      cycles: [assess1100],
    });
    const r = run(testProject({ scenario: sc }));
    expect(bal(r, cc('2000'), '94100000')).toBe(4_000_000);
    expect(bal(r, cc('2100'), '94100000')).toBe(1_600_000);
    expect(bal(r, cc('3000'), '94100000')).toBe(2_400_000);
    expect(bal(r, cc('1100'))).toBe(0);
    expect(bal(r, wbs('P-100'))).toBe(0);
    // 決済は決済用の二次勘定（カテゴリ21）で計上する
    expect(linesOf(r, 'ST-S').every((l) => l.account === '94900000')).toBe(true);
  });

  it('T-06 配賦が先：2,500,000／1,000,000／1,500,000、1100に3,000,000円残る（V-16、V-11）', () => {
    const sc = emptyScenario([step('ST-A', 'ALLOC_CYCLE', ['CY-1100']), step('ST-S', 'SETTLEMENT', ['SR-P100'])], {
      settlementRules: [settleP100()],
      cycles: [assess1100],
    });
    const r = run(testProject({ scenario: sc }));
    expect(bal(r, cc('2000'), '94100000')).toBe(2_500_000);
    expect(bal(r, cc('2100'), '94100000')).toBe(1_000_000);
    expect(bal(r, cc('3000'), '94100000')).toBe(1_500_000);
    expect(bal(r, cc('1100'))).toBe(3_000_000);
    const v16 = r.issues.filter((i) => i.code === 'V-16').map((i) => i.obj?.id);
    expect(v16).toContain('1100');
    expect(r.issues.find((i) => i.code === 'V-11')?.obj).toEqual(cc('1100'));
  });

  it('T-12 P-100の分配規則を70%だけにして決済：2,100,000円を決済、900,000円がP-100に残る（V-06）', () => {
    const r = run(testProject({ scenario: emptyScenario([step('ST-S', 'SETTLEMENT', ['SR-P100'])], { settlementRules: [settleP100(70)] }) }));
    expect(bal(r, cc('1100'), '94900000')).toBe(2_100_000);
    expect(bal(r, wbs('P-100'))).toBe(900_000);
    expect(codes(r)).toContain('V-06');
  });

  it('T-13 P-100→P-101→P-100の決済規則：V-07エラー、仕訳を作らない', () => {
    const rules: SettlementRule[] = [
      { id: 'SR-P100', sender: wbs('P-100'), rules: [{ receiver: wbs('P-101'), basis: 'PCT', value: 100, settlementType: 'FUL', validFrom: 202604 }] },
      { id: 'SR-P101', sender: wbs('P-101'), rules: [{ receiver: wbs('P-100'), basis: 'PCT', value: 100, settlementType: 'FUL', validFrom: 202604 }] },
    ];
    const p = testProject({
      scenario: emptyScenario([step('ST-S', 'SETTLEMENT', ['SR-P100', 'SR-P101'])], { settlementRules: rules }),
      master: (m) =>
        m.wbs.push({ id: 'P-101', name: '基盤更改', projectType: 'OVERHEAD', responsibleCctr: '1100', profitCenter: 'PC10', statistical: false, settlementProfileId: 'SP-OH' }),
    });
    const r = run(p);
    expect(codes(r).filter((c) => c === 'V-07')).toHaveLength(2);
    expect(linesOf(r, 'ST-S')).toHaveLength(0);
  });

  it('WBSからWBSへの決済は、受信者を後にする順（トポロジカル順）で処理する', () => {
    // P-100 → P-101 → 1100。定義の並びが逆でも P-100 を先に決済する
    const rules: SettlementRule[] = [
      { id: 'SR-P101', sender: wbs('P-101'), rules: [{ receiver: cc('1100'), basis: 'PCT', value: 100, settlementType: 'FUL', validFrom: 202604 }] },
      { id: 'SR-P100', sender: wbs('P-100'), rules: [{ receiver: wbs('P-101'), basis: 'PCT', value: 100, settlementType: 'FUL', validFrom: 202604 }] },
    ];
    const p = testProject({
      scenario: emptyScenario([step('ST-S', 'SETTLEMENT', ['SR-P101', 'SR-P100'])], { settlementRules: rules }),
      master: (m) =>
        m.wbs.push({ id: 'P-101', name: '基盤更改', projectType: 'OVERHEAD', responsibleCctr: '1100', profitCenter: 'PC10', statistical: false, settlementProfileId: 'SP-OH' }),
    });
    const r = run(p);
    expect(bal(r, wbs('P-100'))).toBe(0);
    expect(bal(r, wbs('P-101'))).toBe(0);
    expect(bal(r, cc('1100'), '94900000')).toBe(3_000_000);
  });

  it('P-04 分配規則：金額を先に引き、残りに%、さらに残りに等価係数を当てる', () => {
    const rule: SettlementRule = {
      id: 'SR-P100',
      sender: wbs('P-100'),
      rules: [
        { receiver: cc('1000'), basis: 'AMOUNT', value: 600_000, settlementType: 'FUL', validFrom: 202604 },
        { receiver: cc('1100'), basis: 'PCT', value: 50, settlementType: 'FUL', validFrom: 202604 },
        { receiver: cc('2000'), basis: 'EQUIV', value: 2, settlementType: 'FUL', validFrom: 202604 },
        { receiver: seg(SEG.ALL_PG1), basis: 'EQUIV', value: 1, settlementType: 'FUL', validFrom: 202604 },
      ],
    };
    const r = run(testProject({ scenario: emptyScenario([step('ST-S', 'SETTLEMENT', ['SR-P100'])], { settlementRules: [rule] }) }));
    // 3,000,000 − 600,000 = 2,400,000 → 50% = 1,200,000、残り 1,200,000 を 2:1
    expect(bal(r, cc('1000'), '94900000')).toBe(600_000);
    expect(bal(r, cc('1100'), '94900000')).toBe(1_200_000);
    expect(bal(r, cc('2000'))).toBe(800_000);
    expect(bal(r, seg(SEG.ALL_PG1), '94900000')).toBe(400_000);
    expect(bal(r, wbs('P-100'))).toBe(0);
  });

  it('有効期間外の分配規則は使わない', () => {
    const rule = settleP100();
    rule.rules[0]!.validFrom = 202611;
    const r = run(testProject({ scenario: emptyScenario([step('ST-S', 'SETTLEMENT', ['SR-P100'])], { settlementRules: [rule] }) }));
    expect(linesOf(r, 'ST-S')).toHaveLength(0);
  });

  it('同じWBSを2回決済しても、2回目は決済済みの額を二重に流さない（V-08）', () => {
    const sc = emptyScenario([step('ST-S1', 'SETTLEMENT', ['SR-P100']), step('ST-S2', 'SETTLEMENT', ['SR-P100'])], { settlementRules: [settleP100()] });
    const r = run(testProject({ scenario: sc }));
    expect(bal(r, cc('1100'), '94900000')).toBe(3_000_000);
    expect(linesOf(r, 'ST-S2')).toHaveLength(0);
    expect(codes(r)).toContain('V-08');
  });
});

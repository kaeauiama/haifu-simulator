import { describe, expect, it } from 'vitest';
import type { AllocationCycle, TDDRule } from '../src/model/types.ts';
import { SEG, sampleProject } from '../src/seed/sampleCompany.ts';
import { ACCOUNT_RANGES } from '../src/seed/ycoa.ts';
import { bal, cc, codes, emptyScenario, linesOf, pp, run, seg, step, testProject, wbs } from './helpers.ts';

const sample = sampleProject().scenarios[0]!;
const tdd01 = sample.tddRules.find((r) => r.id === 'TDD-01')!;
const cs01 = sample.costingSheets.find((c) => c.id === 'CS-01')!;
const aa01 = sample.activityAllocs.find((a) => a.id === 'AA-01')!;

describe('TDD（F3-05）', () => {
  it('T-08 全社×PG1の運賃300,000円を、PG1の売上を参照して顧客別にTDD：A 180,000、B 90,000、C 30,000', () => {
    const r = run(testProject({ scenario: emptyScenario([step('ST-T', 'TDD', ['TDD-01'])], { tddRules: [tdd01] }) }));
    expect(bal(r, seg(SEG.A_PG1), '68000000')).toBe(180_000);
    expect(bal(r, seg(SEG.B_PG1), '68000000')).toBe(90_000);
    expect(bal(r, seg(SEG.C_PG1), '68000000')).toBe(30_000);
    expect(bal(r, seg(SEG.ALL_PG1))).toBe(0);
    // 勘定は送信と同じ
    expect(linesOf(r, 'ST-T').every((l) => l.account === '68000000')).toBe(true);
  });

  it('T-09 C-200の属性セグメントをTDDの送信者に指定：V-09エラー、仕訳を作らない', () => {
    const rule: TDDRule = { ...tdd01, id: 'TDD-ATTR', sender: { segments: { type: 'PSEG', mode: 'LIST', ids: [SEG.A_SVC] }, accounts: [ACCOUNT_RANGES.allCosts] } };
    const r = run(testProject({ scenario: emptyScenario([step('ST-T', 'TDD', ['TDD-ATTR'])], { tddRules: [rule] }) }));
    expect(codes(r)).toContain('V-09');
    expect(r.issues.find((i) => i.code === 'V-09')?.severity).toBe('ERROR');
    expect(linesOf(r, 'ST-T')).toHaveLength(0);
  });

  it('V-10 参照データが0円なら按分できない', () => {
    const r = run(
      testProject({
        postings: [pp('PP-009', '68000000', seg(SEG.ALL_PG1), 300_000)],
        scenario: emptyScenario([step('ST-T', 'TDD', ['TDD-01'])], { tddRules: [tdd01] }),
      }),
    );
    expect(codes(r)).toContain('V-10');
    expect(linesOf(r, 'ST-T')).toHaveLength(0);
  });
});

describe('間接費計算（F3-04）', () => {
  it('T-07 C-200の外注費1,500,000円に10%、貸方1000。1000を配賦し終えた後に実行：C-200 +150,000（94200000）、1000が−150,000円（V-15）', () => {
    const assess1000: AllocationCycle = {
      id: 'CY-1000',
      name: '管理部の配賦',
      context: 'CCTR',
      type: 'OVERHEAD',
      iterative: false,
      segments: [
        {
          id: 'SEG-1',
          name: '1000→2000/2100',
          sender: { objects: { type: 'CCTR', mode: 'LIST', ids: ['1000'] }, accounts: [ACCOUNT_RANGES.allCosts], sharePct: 100 },
          receiver: {
            objects: { type: 'CCTR', mode: 'LIST', ids: ['2000', '2100'] },
            factor: { kind: 'FIXED_PERCENT', weights: [{ obj: cc('2000'), pct: 60 }, { obj: cc('2100'), pct: 40 }] },
          },
          allocAccount: '94100000',
        },
      ],
    };
    const sc = emptyScenario([step('ST-A', 'ALLOC_CYCLE', ['CY-1000']), step('ST-O', 'OVERHEAD_CALC', ['CS-01'])], {
      cycles: [assess1000],
      costingSheets: [cs01],
    });
    const r = run(testProject({ scenario: sc }));
    expect(bal(r, wbs('C-200'), '94200000')).toBe(150_000);
    expect(bal(r, cc('1000'))).toBe(-150_000);
    expect(r.issues.find((i) => i.code === 'V-15')?.obj).toEqual(cc('1000'));
  });

  it('間接費計算を配賦より先に回せば、貸方原価センタはマイナスにならない（5.1 の依存）', () => {
    const sc = emptyScenario([step('ST-O', 'OVERHEAD_CALC', ['CS-01'])], { costingSheets: [cs01] });
    const r = run(testProject({ scenario: sc }));
    expect(bal(r, wbs('C-200'), '94200000')).toBe(150_000);
    expect(codes(r)).not.toContain('V-15');
  });
});

describe('直接活動配分と再評価（F3-03、F5-05）', () => {
  it('T-11 3000からC-200へ300時間の活動配分、続けて実績レートで再評価：配分2,400,000円、実績9,000円で再評価+300,000円', () => {
    const sc = emptyScenario([step('ST-01', 'ACTIVITY_ALLOC', ['AA-01']), step('ST-06', 'ACTUAL_RATE_REVAL', [])], { activityAllocs: [aa01] });
    const r = run(testProject({ scenario: sc }));
    const alloc = linesOf(r, 'ST-01').find((l) => l.obj.id === 'C-200')!;
    expect(alloc.account).toBe('94300000');
    expect(alloc.amount).toBe(2_400_000);
    const reval = linesOf(r, 'ST-06').find((l) => l.obj.id === 'C-200')!;
    expect(reval.account).toBe('94300000');
    expect(reval.amount).toBe(300_000);
    expect(r.issues.find((i) => i.code === 'X-RATE')?.message).toContain('実績 9,000円/時間（計画 8,000円）');
    expect(bal(r, cc('3000'))).toBe(0);
  });

  it('再評価を2回回しても、2回目は差額0（既に配った再評価を差し引く）', () => {
    const sc = emptyScenario(
      [step('ST-01', 'ACTIVITY_ALLOC', ['AA-01']), step('ST-06', 'ACTUAL_RATE_REVAL', []), step('ST-06B', 'ACTUAL_RATE_REVAL', [])],
      { activityAllocs: [aa01] },
    );
    const r = run(testProject({ scenario: sc }));
    expect(linesOf(r, 'ST-06B')).toHaveLength(0);
    expect(bal(r, wbs('C-200'), '94300000')).toBe(2_700_000);
  });
});

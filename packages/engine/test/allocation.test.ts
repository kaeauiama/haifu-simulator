import { describe, expect, it } from 'vitest';
import type { AllocSegment, AllocationCycle, Master } from '../src/model/types.ts';
import { LineageTracer } from '../src/lineage/lineage.ts';
import { bal, cc, codes, emptyScenario, linesOf, pp, run, step, testProject } from './helpers.ts';

/** サンプル商事の 1000 の給与（PP-010）だけを残した一次仕訳 */
const salary1000 = pp('PP-010', '61000000', cc('1000'), 1_000_000);

function cycle1000(type: AllocationCycle['type']): AllocationCycle {
  return {
    id: 'CY-T',
    name: 'T-01',
    context: 'CCTR',
    type,
    iterative: false,
    segments: [
      {
        id: 'SEG-1',
        name: '1000→2000/2100',
        sender: { objects: { type: 'CCTR', mode: 'LIST', ids: ['1000'] }, accounts: [{ from: '61000000', to: '61999999' }], sharePct: 100 },
        receiver: {
          objects: { type: 'CCTR', mode: 'LIST', ids: ['2000', '2100'] },
          factor: { kind: 'FIXED_PORTION', weights: [{ obj: cc('2000'), portion: 60 }, { obj: cc('2100'), portion: 40 }] },
        },
        ...(type === 'OVERHEAD' ? { allocAccount: '94100000' } : {}),
      },
    ],
  };
}

describe('配布・配賦（F3-01、5.2）', () => {
  it('T-01 1000の給与1,000,000円を2000と2100へ60:40で配布：勘定61000000のまま、PC10→PC20', () => {
    const p = testProject({
      scenario: emptyScenario([step('ST-A', 'ALLOC_CYCLE', ['CY-T'])], { cycles: [cycle1000('DISTRIBUTION')] }),
    });
    const r = run(p);
    expect(bal(r, cc('2000'), '61000000')).toBe(600_000);
    expect(bal(r, cc('2100'), '61000000')).toBe(400_000);
    expect(bal(r, cc('1000'), '61000000')).toBe(0);
    const byPC = new Map<string, number>();
    for (const l of linesOf(r, 'ST-A')) byPC.set(l.profitCenter, (byPC.get(l.profitCenter) ?? 0) + l.amount);
    expect(byPC.get('PC10')).toBe(-1_000_000);
    expect(byPC.get('PC20')).toBe(1_000_000);
    expect(linesOf(r, 'ST-A').every((l) => l.account === '61000000')).toBe(true);
  });

  it('T-02 T-01を配賦で実行：61000000は1000に残り、94100000で送信−1,000,000、受信+600,000／+400,000', () => {
    const p = testProject({
      scenario: emptyScenario([step('ST-A', 'ALLOC_CYCLE', ['CY-T'])], { cycles: [cycle1000('OVERHEAD')] }),
    });
    const r = run(p);
    expect(bal(r, cc('1000'), '61000000')).toBe(1_000_000);
    expect(bal(r, cc('1000'), '94100000')).toBe(-1_000_000);
    expect(bal(r, cc('2000'), '94100000')).toBe(600_000);
    expect(bal(r, cc('2100'), '94100000')).toBe(400_000);
    expect(bal(r, cc('1000'))).toBe(0);
  });

  it('T-03 1,000,000円を3者に均等配布：333,334／333,333／333,333、端数はIDが最小の受信者へ', () => {
    const c = cycle1000('DISTRIBUTION');
    c.segments[0]!.receiver = {
      objects: { type: 'CCTR', mode: 'LIST', ids: ['3000', '2100', '2000'] },
      factor: { kind: 'FIXED_PORTION', weights: [{ obj: cc('3000'), portion: 1 }, { obj: cc('2100'), portion: 1 }, { obj: cc('2000'), portion: 1 }] },
    };
    const r = run(testProject({ postings: [salary1000], scenario: emptyScenario([step('ST-A', 'ALLOC_CYCLE', ['CY-T'])], { cycles: [c] }) }));
    expect(bal(r, cc('2000'))).toBe(333_334);
    expect(bal(r, cc('2100'))).toBe(333_333);
    expect(bal(r, cc('3000'))).toBe(333_333);
  });

  it('送信割合が100%未満なら、残りを送信側に残す（F5-06）', () => {
    const c = cycle1000('DISTRIBUTION');
    c.segments[0]!.sender.sharePct = 80;
    const r = run(testProject({ postings: [salary1000], scenario: emptyScenario([step('ST-A', 'ALLOC_CYCLE', ['CY-T'])], { cycles: [c] }) }));
    expect(bal(r, cc('1000'))).toBe(200_000);
    expect(bal(r, cc('2000'))).toBe(480_000);
    expect(codes(r)).toContain('V-16');
  });

  it('統計KF（人数）で配る：受信側の値で按分する', () => {
    const c = cycle1000('DISTRIBUTION');
    c.segments[0]!.receiver = { objects: { type: 'CCTR', mode: 'GROUP', groupId: 'CCG-OPS' }, factor: { kind: 'SKF', skfId: 'HC' } };
    const r = run(testProject({ postings: [salary1000], scenario: emptyScenario([step('ST-A', 'ALLOC_CYCLE', ['CY-T'])], { cycles: [c] }) }));
    // 20:8:12
    expect(bal(r, cc('2000'))).toBe(500_000);
    expect(bal(r, cc('2100'))).toBe(200_000);
    expect(bal(r, cc('3000'))).toBe(300_000);
  });

  it('VARIABLE はステップ開始時点の受信側残高で按分する', () => {
    const c = cycle1000('DISTRIBUTION');
    c.segments[0]!.receiver = {
      objects: { type: 'CCTR', mode: 'LIST', ids: ['1100', '3000'] },
      factor: { kind: 'VARIABLE', accounts: [{ from: '61000000', to: '61999999' }] },
    };
    // 1100: 4,000,000、3000: 2,700,000（給与）。1000 の給与 1,000,000 はサンプルに含まれる（D-017）
    const p = testProject({ scenario: emptyScenario([step('ST-A', 'ALLOC_CYCLE', ['CY-T'])], { cycles: [c] }) });
    const r = run(p);
    expect(bal(r, cc('1100'), '61000000') - 4_000_000).toBe(597_015);
    expect(bal(r, cc('3000'), '61000000') - 2_700_000).toBe(402_985);
  });
});

// T-04 / T-05 用に、送信者 A・B と受信者 X・Y の原価センタを足す
const addABXY = (m: Master) => {
  for (const id of ['A', 'B', 'X', 'Y']) m.costCenters.push({ id, name: id, profitCenter: 'PC10', kind: 'SERVICE' });
};
const abPostings = [pp('PA', '61000000', cc('A'), 100_000), pp('PB', '61000000', cc('B'), 50_000)];

function abCycle(iterative: boolean, type: AllocationCycle['type'] = 'OVERHEAD'): AllocationCycle {
  const seg = (id: string, sender: string, weights: [string, number][]): AllocSegment => ({
    id,
    name: `${sender}の配賦`,
    sender: { objects: { type: 'CCTR', mode: 'LIST', ids: [sender] }, accounts: [{ from: '61000000', to: '61999999' }], sharePct: 100 },
    receiver: {
      objects: { type: 'CCTR', mode: 'LIST', ids: weights.map(([o]) => o) },
      factor: { kind: 'FIXED_PERCENT', weights: weights.map(([o, pct]) => ({ obj: cc(o), pct })) },
    },
    ...(type === 'OVERHEAD' ? { allocAccount: '94100000' } : {}),
  });
  return {
    id: 'CY-AB',
    name: 'A・Bの相互配賦',
    context: 'CCTR',
    type,
    iterative,
    segments: [seg('SEG-A', 'A', [['B', 50], ['X', 50]]), seg('SEG-B', 'B', [['A', 20], ['Y', 80]])],
  };
}

describe('反復配賦（F5-04、5.3）', () => {
  it('T-04 反復：X 61,111円、Y 88,889円、A・Bの残高0', () => {
    const r = run(testProject({ postings: abPostings, master: addABXY, scenario: emptyScenario([step('ST-A', 'ALLOC_CYCLE', ['CY-AB'])], { cycles: [abCycle(true)] }) }));
    expect(bal(r, cc('X'))).toBe(61_111);
    expect(bal(r, cc('Y'))).toBe(88_889);
    expect(bal(r, cc('A'))).toBe(0);
    expect(bal(r, cc('B'))).toBe(0);
    expect(codes(r)).not.toContain('V-12');
  });

  it('T-04 配布タイプで反復しても同じ額になる（勘定ごとに解く）', () => {
    const r = run(
      testProject({ postings: abPostings, master: addABXY, scenario: emptyScenario([step('ST-A', 'ALLOC_CYCLE', ['CY-AB'])], { cycles: [abCycle(true, 'DISTRIBUTION')] }) }),
    );
    expect(bal(r, cc('X'), '61000000')).toBe(61_111);
    expect(bal(r, cc('Y'), '61000000')).toBe(88_889);
    expect(bal(r, cc('A'))).toBe(0);
    expect(bal(r, cc('B'))).toBe(0);
  });

  it('T-04 反復の来歴：Xの61,111円は、A由来とB由来に連立方程式の解の比で分かれる', () => {
    const r = run(testProject({ postings: abPostings, master: addABXY, scenario: emptyScenario([step('ST-A', 'ALLOC_CYCLE', ['CY-AB'])], { cycles: [abCycle(true)] }) }));
    const v = new LineageTracer(r.ledger).balance(cc('X'));
    // x_A = (100,000 + 0.2 × 50,000) / 0.9。X はその50%で、A 由来 0.5×100,000/0.9、B 由来 0.5×10,000/0.9
    expect(v.get('PA')).toBeCloseTo(55_555.6, 0);
    expect(v.get('PB')).toBeCloseTo(5_555.6, 0);
    expect([...v.values()].reduce((s, x) => s + x, 0)).toBeCloseTo(61_111, 6);
  });

  it('T-05 T-04を非反復で、A→Bの順に実行：X 50,000円、Y 80,000円、Aに20,000円残る（V-12）', () => {
    const r = run(testProject({ postings: abPostings, master: addABXY, scenario: emptyScenario([step('ST-A', 'ALLOC_CYCLE', ['CY-AB'])], { cycles: [abCycle(false)] }) }));
    expect(bal(r, cc('X'))).toBe(50_000);
    expect(bal(r, cc('Y'))).toBe(80_000);
    expect(bal(r, cc('A'))).toBe(20_000);
    expect(bal(r, cc('B'))).toBe(0);
    expect(r.issues.find((i) => i.code === 'V-12')?.obj).toEqual(cc('A'));
  });

  it('F5-04 送信者同士で額が回り続けて出口がない反復サイクルは X-ITER-SINGULAR', () => {
    const c = abCycle(true);
    c.segments[0]!.receiver.factor = { kind: 'FIXED_PERCENT', weights: [{ obj: cc('B'), pct: 100 }] };
    c.segments[1]!.receiver.factor = { kind: 'FIXED_PERCENT', weights: [{ obj: cc('A'), pct: 100 }] };
    const r = run(testProject({ postings: abPostings, master: addABXY, scenario: emptyScenario([step('ST-A', 'ALLOC_CYCLE', ['CY-AB'])], { cycles: [c] }) }));
    expect(codes(r)).toContain('X-ITER-SINGULAR');
    expect(linesOf(r, 'ST-A')).toHaveLength(0);
  });
});

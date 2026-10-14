import { describe, expect, it } from 'vitest';
import type { AllocationCycle } from '../src/model/types.ts';
import { MasterIndex } from '../src/ledger/masterIndex.ts';
import { totalsByProfitCenter } from '../src/report/totals.ts';
import { runAll } from '../src/run.ts';
import { sampleProject } from '../src/seed/sampleCompany.ts';
import { bal, cc, codes, emptyScenario, finalOf, linesOf, run, step, testProject } from './helpers.ts';

const pc = (id: string) => ({ type: 'PCTR' as const, id });

function pcCycle(type: AllocationCycle['type'], factor: AllocationCycle['segments'][number]['receiver']['factor'], iterative = false): AllocationCycle {
  return {
    id: 'CY-PCT',
    name: 'PC配賦',
    context: 'PCTR',
    type,
    iterative,
    segments: [
      {
        id: 'S1',
        name: 'PC10',
        sender: { objects: { type: 'PCTR', mode: 'LIST', ids: ['PC10'] }, accounts: [{ from: '50000000', to: '99999999' }], sharePct: 100 },
        receiver: { objects: { type: 'PCTR', mode: 'LIST', ids: ['PC20', 'PC30'] }, factor },
        ...(type === 'OVERHEAD' ? { allocAccount: '94100000' } : {}),
      },
    ],
  };
}

const pcTotals = (p: ReturnType<typeof sampleProject>, r: ReturnType<typeof run>) => totalsByProfitCenter(finalOf(r), new MasterIndex(p.master));

describe('利益センタ間の配布・配賦（U-03 を MVP に、P-23）', () => {
  it('配賦：PC10 に導出される全対象の残高 9,000,000 を 60:40 で配り、利益センタに計上する。原価センタの残高は動かない', () => {
    const p = testProject({
      scenario: emptyScenario([step('ST-P', 'ALLOC_CYCLE', ['CY-PCT'])], {
        cycles: [pcCycle('OVERHEAD', { kind: 'FIXED_PERCENT', weights: [{ obj: pc('PC20'), pct: 60 }, { obj: pc('PC30'), pct: 40 }] })],
      }),
    });
    const r = run(p);
    // PC10 = 1000 給与 1,000,000 + 1100 5,000,000 + P-100 3,000,000
    expect(bal(r, pc('PC10'), '94100000')).toBe(-9_000_000);
    expect(bal(r, pc('PC20'), '94100000')).toBe(5_400_000);
    expect(bal(r, pc('PC30'), '94100000')).toBe(3_600_000);
    expect(pcTotals(p, r).get('PC10')).toBe(0);
    expect(bal(r, cc('1100'))).toBe(5_000_000);
    expect(linesOf(r, 'ST-P').every((l) => l.obj.type === 'PCTR')).toBe(true);
    expect(codes(r)).not.toContain('X-UNSUPPORTED');
  });

  it('配布：勘定ごとに、元の勘定のまま配る', () => {
    const p = testProject({
      scenario: emptyScenario([step('ST-P', 'ALLOC_CYCLE', ['CY-PCT'])], {
        cycles: [pcCycle('DISTRIBUTION', { kind: 'FIXED_PORTION', weights: [{ obj: pc('PC20'), portion: 1 }, { obj: pc('PC30'), portion: 1 }] })],
      }),
    });
    p.scenarios[0]!.cycles[0]!.segments[0]!.sender.accounts = [{ from: '50000000', to: '89999999' }];
    const r = run(p);
    expect(bal(r, pc('PC20'), '61000000')).toBe(2_500_000);
    expect(bal(r, pc('PC20'), '66000000')).toBe(1_500_000);
    expect(bal(r, pc('PC30'), '65000000')).toBe(500_000);
  });

  it('実績値の配分基準は、受信利益センタに導出される全対象の残高で見る（売上は PC20 だけ）', () => {
    const p = testProject({
      scenario: emptyScenario([step('ST-P', 'ALLOC_CYCLE', ['CY-PCT'])], {
        cycles: [pcCycle('OVERHEAD', { kind: 'VARIABLE', accounts: [{ from: '41000000', to: '41999999' }] })],
      }),
    });
    const r = run(p);
    expect(bal(r, pc('PC20'), '94100000')).toBe(9_000_000);
    expect(bal(r, pc('PC30'))).toBe(0);
  });

  it('サンプル S-PC：本社費を利益センタで配ると PC10 は0、原価センタには残高が残る（V-16）。ゼロサムは保たれる', () => {
    const p = sampleProject();
    const r = runAll(p, 'S-PC');
    const byPc = totalsByProfitCenter(finalOf(r), new MasterIndex(p.master));
    expect(byPc.get('PC10')).toBe(0);
    expect(finalOf(r).grandTotal()).toBe(3_500_000);
    expect(r.issues.filter((i) => i.severity === 'ERROR')).toEqual([]);
    expect(r.issues.filter((i) => i.code === 'V-16').map((i) => i.obj?.id)).toEqual(expect.arrayContaining(['1000', '1100']));
  });

  it('送信側が利益センタでなければ X-RECEIVER-TYPE', () => {
    const c = pcCycle('OVERHEAD', { kind: 'FIXED_PORTION', weights: [{ obj: pc('PC20'), portion: 1 }] });
    c.segments[0]!.sender.objects = { type: 'CCTR', mode: 'LIST', ids: ['1000'] };
    const r = run(testProject({ scenario: emptyScenario([step('ST-P', 'ALLOC_CYCLE', ['CY-PCT'])], { cycles: [c] }) }));
    expect(codes(r)).toContain('X-RECEIVER-TYPE');
  });
});

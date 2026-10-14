import { describe, expect, it } from 'vitest';
import { MasterIndex } from '../src/ledger/masterIndex.ts';
import { ProjectSchema } from '../src/model/schema.ts';
import { totalsByProfitCenter } from '../src/report/totals.ts';
import { runAll, type RunResult } from '../src/run.ts';
import { UTIL_CUSTOMERS, UTIL_SEG, utilityProject } from '../src/seed/utility.ts';
import { bal, codes, finalOf, seg } from './helpers.ts';

const PRIMARY_TOTAL = utilityProject().primaryPostings.reduce((t, p) => t + p.amount, 0);
const mi = new MasterIndex(utilityProject().master);
/** カンパニー（利益センタ）の利益。プラスが黒字 */
const pcProfit = (r: RunResult, pc: string) => 0 - (totalsByProfitCenter(finalOf(r), mi).get(pc) ?? 0);
const custProfit = (r: RunResult, key: keyof typeof UTIL_SEG) => -bal(r, seg(UTIL_SEG[key]));

describe('さざなみ電力（F2-03、D-054）', () => {
  it('F9-01 スキーマに合い、JSON を往復しても同じ', () => {
    const p = utilityProject();
    expect(ProjectSchema.parse(p)).toEqual(p);
    expect(ProjectSchema.parse(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });

  it('1か月の収入は約100億円、営業利益は約8.5%', () => {
    const revenue = -utilityProject()
      .primaryPostings.filter((p) => p.account.startsWith('41'))
      .reduce((t, p) => t + p.amount, 0);
    expect(revenue).toBe(9_980_000_000);
    expect(-PRIMARY_TOTAL / revenue).toBeCloseTo(0.085, 3);
  });

  for (const scenarioId of ['S-DEFAULT', 'S-COST', 'S-PCALLOC']) {
    it(`T-10 ${scenarioId}：エラーなく締まり、ゼロサムが一致する`, () => {
      const r = runAll(utilityProject(), scenarioId);
      expect(r.issues.filter((i) => i.severity === 'ERROR')).toEqual([]);
      expect(finalOf(r).grandTotal()).toBe(PRIMARY_TOTAL);
      expect(codes(r)).not.toContain('V-17');
      expect(bal(r, seg(UTIL_SEG.RES_ALL))).toBe(0); // ポイント還元は TDD で地域へ
    });
  }

  it('標準（振替価格）：3カンパニーとも黒字、コーポレートは0。特別高圧の産業は赤字', () => {
    const r = runAll(utilityProject(), 'S-DEFAULT');
    expect(codes(r)).not.toContain('V-16');
    for (const pc of ['PC20', 'PC30', 'PC40']) expect(pcProfit(r, pc)).toBeGreaterThan(0);
    expect(pcProfit(r, 'PC10')).toBe(0);
    expect(custProfit(r, 'IND_N')).toBeLessThan(0);
    expect(custProfit(r, 'IND_S')).toBeLessThan(0);
    expect(custProfit(r, 'RES_S')).toBeGreaterThan(0);
  });

  it('標準：託送料は託送料金どおり（電圧別の単価×販売電力量）で各顧客区分に乗る', () => {
    const r = runAll(utilityProject(), 'S-DEFAULT');
    const rate = { RES: 9_500, COM: 4_500, IND: 2_300 } as const;
    for (const c of UTIL_CUSTOMERS) expect(bal(r, seg(UTIL_SEG[c.key]), '94150000')).toBe(c.mwh * rate[c.group]);
  });

  it('実績原価で振り替えると、発電・送配電の損益は社外取引の分だけになり、小売に寄る。全社の利益は同じ', () => {
    const a = runAll(utilityProject(), 'S-DEFAULT');
    const b = runAll(utilityProject(), 'S-COST');
    expect(codes(b)).toContain('X-RATE');
    expect(codes(b)).not.toContain('V-16');
    expect(Math.abs(pcProfit(b, 'PC20'))).toBeLessThan(pcProfit(a, 'PC20') / 5);
    expect(pcProfit(b, 'PC30')).toBeLessThan(pcProfit(a, 'PC30'));
    expect(pcProfit(b, 'PC40')).toBeGreaterThan(pcProfit(a, 'PC40'));
    expect(custProfit(b, 'IND_N')).toBeGreaterThan(0);
    expect(finalOf(b).grandTotal()).toBe(finalOf(a).grandTotal());
  });

  it('本店費を利益センタで配賦すると、本店の原価センタに残高が残り（V-16）、コーポレートの利益センタは0になる', () => {
    const r = runAll(utilityProject(), 'S-PCALLOC');
    const left = r.issues.filter((i) => i.code === 'V-16').map((i) => i.obj?.id);
    expect(left.sort()).toEqual(['1000', '1010', '1020', '1100']);
    expect(pcProfit(r, 'PC10')).toBe(0);
  });
});

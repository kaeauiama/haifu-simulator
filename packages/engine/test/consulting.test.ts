import { describe, expect, it } from 'vitest';
import { ProjectSchema } from '../src/model/schema.ts';
import { runAll, type RunResult } from '../src/run.ts';
import { SimSession } from '../src/session.ts';
import { CONSULT_SEG, ENGAGEMENTS, consultingProject, revenueOf } from '../src/seed/consulting.ts';
import { bal, cc, codes, finalOf, seg, wbs } from './helpers.ts';

const PRIMARY_TOTAL = consultingProject().primaryPostings.reduce((t, p) => t + p.amount, 0);
const profit = (r: RunResult, id: string) => -bal(r, wbs(id));

describe('みずなぎコンサルティング（F2-03、D-054）', () => {
  it('F9-01 スキーマに合い、JSON を往復しても同じ', () => {
    const p = consultingProject();
    expect(ProjectSchema.parse(p)).toEqual(p);
    expect(ProjectSchema.parse(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });

  it('準委任の売上は工数÷160時間×請求単価＋外注の請求額（C-102：27,600,000円）。営業利益は約13%', () => {
    expect(revenueOf(ENGAGEMENTS.find((e) => e.id === 'C-102')!)).toBe(27_600_000);
    const revenue = ENGAGEMENTS.reduce((t, e) => t + revenueOf(e), 0);
    expect(-PRIMARY_TOTAL / revenue).toBeCloseTo(0.13, 2);
  });

  for (const scenarioId of ['S-DEFAULT', 'S-BENCH', 'S-SALES']) {
    it(`T-10 ${scenarioId}：エラーなく締まり、ゼロサムが一致し、原価センタと社内の WBS に残高が残らない`, () => {
      const r = runAll(consultingProject(), scenarioId);
      expect(r.issues.filter((i) => i.severity === 'ERROR')).toEqual([]);
      expect(finalOf(r).grandTotal()).toBe(PRIMARY_TOTAL);
      expect(codes(r)).not.toContain('V-16');
      expect(codes(r)).not.toContain('V-17');
      for (const id of ['P-901', 'P-902', 'P-903']) expect(bal(r, wbs(id))).toBe(0);
    });
  }

  it('標準：事業部の費用は実績原価レートですべて案件へ（事業部の原価センタは0）。どの案件も黒字', () => {
    const r = runAll(consultingProject(), 'S-DEFAULT');
    for (const id of ['2000', '3000', '4000']) expect(bal(r, cc(id))).toBe(0);
    for (const e of ENGAGEMENTS) expect(profit(r, e.id)).toBeGreaterThan(0);
  });

  it('ベンチを事業部に残すと、どの案件の利益も増え、その分が事業部（顧客未設定）の費用になる', () => {
    const a = runAll(consultingProject(), 'S-DEFAULT');
    const b = runAll(consultingProject(), 'S-BENCH');
    expect(codes(b)).not.toContain('X-RATE');
    for (const e of ENGAGEMENTS) expect(profit(b, e.id)).toBeGreaterThan(profit(a, e.id));
    for (const s of ['SAP', 'CLOUD', 'STRAT']) expect(bal(b, seg(CONSULT_SEG[s]!))).toBeGreaterThan(bal(a, seg(CONSULT_SEG[s]!)));
    expect(finalOf(b).grandTotal()).toBe(finalOf(a).grandTotal());
  });

  it('営業本部費を事業部へ配ると、案件の利益は増え、全社の利益は変わらない', () => {
    const a = runAll(consultingProject(), 'S-DEFAULT');
    const b = runAll(consultingProject(), 'S-SALES');
    for (const e of ENGAGEMENTS) expect(profit(b, e.id)).toBeGreaterThan(profit(a, e.id));
    expect(finalOf(b).grandTotal()).toBe(finalOf(a).grandTotal());
  });

  it('P-08 顧客別の収益性：案件の WBS は属性セグメント（顧客×サービス）にまとめて見える', () => {
    const s = new SimSession(consultingProject(), 'S-DEFAULT');
    const r = runAll(consultingProject(), 'S-DEFAULT');
    const row = s.stepView('ST-09').bySegment.find((x) => x.label === '金融B社 × SAP')!;
    expect(row.amount).toBe(bal(r, wbs('C-102')));
  });
});

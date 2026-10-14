import { describe, expect, it } from 'vitest';
import { compareRuns } from '../src/compare/compare.ts';
import { MasterIndex } from '../src/ledger/masterIndex.ts';
import { LineageTracer, UNATTRIBUTED } from '../src/lineage/lineage.ts';
import { ProjectSchema } from '../src/model/schema.ts';
import { objectStepTable, totalsByProfitCenter, totalsBySegment } from '../src/report/totals.ts';
import { runAll, runStep } from '../src/run.ts';
import { SEG, sampleProject } from '../src/seed/sampleCompany.ts';
import { bal, cc, codes, finalOf, seg, wbs } from './helpers.ts';

const PRIMARY_TOTAL = 3_500_000;

describe('サンプル商事（F2-03、8.1）', () => {
  it('F9-01 サンプルは Project スキーマに合い、JSON を往復しても同じ', () => {
    const p = sampleProject();
    expect(ProjectSchema.parse(p)).toEqual(p);
    expect(ProjectSchema.parse(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });

  it('実行前検証でエラーが出ない', () => {
    const r = runAll(sampleProject(), 'S-DEFAULT');
    expect(r.issues.filter((i) => i.severity === 'ERROR')).toEqual([]);
  });

  for (const scenarioId of ['S-DEFAULT', 'S-LATE']) {
    it(`T-10 サンプル全体を実行（${scenarioId}）：全対象の残高合計が一次仕訳合計と一致（V-17が出ない）`, () => {
      const r = runAll(sampleProject(), scenarioId);
      expect(finalOf(r).grandTotal()).toBe(PRIMARY_TOTAL);
      expect(codes(r)).not.toContain('V-17');
    });
  }

  it('既定順：補助部門・事業部門の原価センタとP-100は締め後に残高0、利益は顧客別セグメントとC-200に出る', () => {
    const r = runAll(sampleProject(), 'S-DEFAULT');
    for (const id of ['1000', '1100', '2000', '2100', '3000']) expect(bal(r, cc(id))).toBe(0);
    expect(bal(r, wbs('P-100'))).toBe(0);
    expect(bal(r, seg(SEG.ALL_PG1))).toBe(0);
    expect(codes(r)).not.toContain('V-16');
    const mi = new MasterIndex(sampleProject().master);
    const bySeg = totalsBySegment(finalOf(r), mi);
    // C-200 は属性セグメント（顧客A×SVC）に含めて見る
    expect(bySeg.get(SEG.A_SVC)).toBe(bal(r, wbs('C-200')));
    const sumSeg = [...bySeg.values()].reduce((s, v) => s + v, 0);
    expect(sumSeg).toBe(PRIMARY_TOTAL);
    const byPC = totalsByProfitCenter(finalOf(r), mi);
    expect(byPC.get('PC10')).toBe(0);
    expect([...byPC.values()].reduce((s, v) => s + v, 0)).toBe(PRIMARY_TOTAL);
  });

  it('S-LATE：1000がマイナス（V-15）、1100に決済額が残る（V-16、V-11）', () => {
    const r = runAll(sampleProject(), 'S-LATE');
    expect(bal(r, cc('1000'))).toBe(-150_000);
    expect(bal(r, cc('1100'))).toBe(3_000_000);
    expect(codes(r)).toEqual(expect.arrayContaining(['V-15', 'V-16', 'V-11']));
  });

  it('F8-02 / F4-04 2案の差：PC別の差が出て、順序を変えたステップが分かる', () => {
    const p = sampleProject();
    const a = runAll(p, 'S-DEFAULT');
    const b = runAll(p, 'S-LATE');
    const cmp = compareRuns(a, b, new MasterIndex(p.master));
    const pc10 = cmp.byProfitCenter.find((r) => r.key === 'PC10')!;
    expect(pc10.diff).toBe(2_850_000); // 1000 −150,000 と 1100 +3,000,000 が PC10 に残る
    expect(cmp.byProfitCenter.reduce((s, r) => s + r.diff, 0)).toBe(0);
    // 間接費計算と決済①そのものの仕訳は同じ。変わるのは、その後ろで残高を読む配賦以降のステップ
    expect(cmp.changedSteps).toEqual(['ST-05', 'ST-06', 'ST-08', 'ST-09']);
  });

  it('F7-03 オブジェクトの「勘定×ステップ」の残高表', () => {
    const r = runAll(sampleProject(), 'S-DEFAULT');
    const t = objectStepTable(r, cc('1100'));
    expect(t.steps[0]).toBe('PRIMARY');
    expect(t.totals[0]).toBe(5_000_000);
    expect(t.totals[t.totals.length - 1]).toBe(0);
    const i61 = t.accounts.indexOf('61000000');
    expect(t.cells[i61]![0]).toBe(4_000_000);
  });

  it('F7-04 来歴：顧客Aセグメントの残高は一次仕訳まで遡れ、合計が残高に一致する', () => {
    const r = runAll(sampleProject(), 'S-DEFAULT');
    const tracer = new LineageTracer(r.ledger);
    const v = tracer.balance(seg(SEG.A_PG1));
    const sum = [...v.values()].reduce((s, x) => s + x, 0);
    expect(sum).toBeCloseTo(bal(r, seg(SEG.A_PG1)), 6);
    expect(v.get('PP-006')).toBeCloseTo(-6_000_000, 6);
    expect(v.get('PP-009')).toBeCloseTo(180_000, 6); // 運賃の60%
    expect(v.has('PP-001')).toBe(true); // IT部の給与が配賦→マージン分析→TDDを経て届く
    // 全対象の来歴の合計は、一次仕訳ごとの額に一致する
    const all = tracer.lines(r.ledger.map((l) => l.id));
    for (const p of sampleProject().primaryPostings) expect(all.get(p.id) ?? 0).toBeCloseTo(p.amount, 4);
    expect(Math.abs(all.get(UNATTRIBUTED) ?? 0)).toBeLessThan(1e-6);
  });

  it('runStep は台帳を変えずに、runAll と同じ仕訳を返す', () => {
    const p = sampleProject();
    const s = p.scenarios[0]!;
    const full = runAll(p, s.id);
    const before = full.ledger.filter((l) => ['PRIMARY', 'ST-01', 'ST-02'].includes(l.stepId));
    const frozen = Object.freeze([...before]);
    const res = runStep(frozen, s.steps[2]!, { master: p.master, scenario: s });
    expect(res.lines).toEqual(full.ledger.filter((l) => l.stepId === 'ST-03'));
    expect(frozen).toHaveLength(before.length);
  });

  it('同じ入力なら毎回同じ結果になる（決定的）', () => {
    const a = runAll(sampleProject(), 'S-DEFAULT');
    const b = runAll(sampleProject(), 'S-DEFAULT');
    expect(b.ledger).toEqual(a.ledger);
    expect(b.issues).toEqual(a.issues);
  });
});

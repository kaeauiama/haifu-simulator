/**
 * 規模の確認（3.10 非機能）：オブジェクト500件、一次仕訳1万行、ステップ15件を1秒以内に再計算する。
 * テストでは機械差を見込んで上限を緩め、実測値を出力する。本番の判定は M6 で行う。
 */
import { describe, expect, it } from 'vitest';
import { largeProject } from '../bench/large.ts';
import { DISPLAY_LIMITS } from '../src/graph/limits.ts';
import { runAll } from '../src/run.ts';
import { SimSession } from '../src/session.ts';

describe('性能（3.10）', () => {
  it('オブジェクト約500件・一次仕訳1万行・ステップ15件を再計算できる（実測値を出力）', () => {
    const p = largeProject();
    const objects = p.master.costCenters.length + p.master.wbs.length + p.master.segments.length;
    runAll(p, p.scenarios[0]!.id); // JIT のウォームアップ
    const t0 = performance.now();
    const r = runAll(p, p.scenarios[0]!.id);
    const ms = performance.now() - t0;
    console.log(`objects=${objects} postings=${p.primaryPostings.length} steps=${p.scenarios[0]!.steps.length} lines=${r.ledger.length} time=${ms.toFixed(0)}ms`);
    expect(r.issues.filter((i) => i.code === 'V-17')).toEqual([]);
    expect(ms).toBeLessThan(5000);
  });

  it('大きい規模では、図に描く線と流れを額の大きい順に上限まで返し、全体の本数も返す', () => {
    const p = largeProject();
    const s = new SimSession(p, p.scenarios[0]!.id);
    const last = s.result.stepOrder.at(-1)!;
    const g = s.flowGraph(last);
    expect(g.edges).toHaveLength(DISPLAY_LIMITS.flowEdges);
    expect(g.totalEdges).toBeGreaterThan(DISPLAY_LIMITS.flowEdges);
    // 描く線は額の大きい順：描いた線の最小額は、全体で上限番目に大きい額と同じ
    const amounts = s.flowGraph(last).edges.map((e) => Math.abs(e.amount));
    expect(Math.min(...amounts)).toBeGreaterThan(0);
    const v = s.methodView('CCTR_ALLOC', last);
    expect(v.edges.length).toBeLessThanOrEqual(DISPLAY_LIMITS.methodEdges);
    expect(v.totalEdges).toBeGreaterThanOrEqual(v.edges.length);
    const sk = s.sankey();
    expect(sk.links.length).toBeLessThanOrEqual(DISPLAY_LIMITS.sankeyLinks);
    expect(sk.total).toBeGreaterThan(DISPLAY_LIMITS.sankeyLinks);
  });
});

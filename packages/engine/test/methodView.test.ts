import { describe, expect, it } from 'vitest';
import { removeRelation, setRelationValue } from '../src/edit/relations.ts';
import { applyDrag, connectInCycle, createBlankRule } from '../src/edit/rules.ts';
import { SimSession } from '../src/session.ts';
import { SEG, sampleProject } from '../src/seed/sampleCompany.ts';

const view = (scenario: string, ...args: Parameters<SimSession['methodView']>) => new SimSession(sampleProject(), scenario).methodView(...args);
const edge = (v: ReturnType<typeof view>, from: string, to: string) => v.edges.find((e) => e.source === from && e.target === to)!;

describe('手法別ビュー（送信側・受信側の2列）', () => {
  it('原価センタ配賦：最初のサイクルを表示し、統計KFの値と構成比、時点までの額を線に持つ', () => {
    const v = view('S-DEFAULT', 'CCTR_ALLOC', 'ST-04');
    expect(v.rules.map((r) => r.id)).toEqual(['CY-DIST', 'CY-ASSESS']);
    expect(v.focusRuleId).toBe('CY-DIST');
    expect(v.left.map((n) => n.id)).toEqual(['1000', '1100', '2000', '2100', '3000']);
    expect(v.right.map((n) => n.type)).toContain('WBS');
    expect(edge(v, 'CCTR:1100', 'CCTR:2000')).toMatchObject({ basis: 'SKF', value: 20, share: 0.5, editable: false, amount: 500_000, state: 'done' });
    expect(edge(v, 'CCTR:1100', 'CCTR:3000').share).toBeCloseTo(0.3, 10);
  });

  it('反復サイクルを表示すると、送信者同士の線も出る', () => {
    const v = view('S-DEFAULT', 'CCTR_ALLOC', 'ST-09', 'CY-ASSESS');
    expect(v.segments.map((s) => s.id)).toEqual(['AS-01', 'AS-02']);
    expect(edge(v, 'CCTR:1000', 'CCTR:1100')).toMatchObject({ rowId: 'AS-01', value: 4 });
    expect(edge(v, 'CCTR:1100', 'CCTR:1000')).toMatchObject({ rowId: 'AS-02', value: 5 });
  });

  it('マージン分析・決済・間接費計算', () => {
    expect(edge(view('S-DEFAULT', 'MA', 'ST-09'), 'CCTR:2000', `PSEG:${SEG.ALL_PG1}`)).toMatchObject({ basis: 'PERCENT', value: 100, share: 1, editable: true });
    expect(edge(view('S-DEFAULT', 'SETTLEMENT', 'ST-09'), 'WBS:P-100', 'CCTR:1100')).toMatchObject({ basis: 'PCT', value: 100, amount: 3_000_000, rowId: '0' });
    expect(edge(view('S-DEFAULT', 'OVERHEAD_CALC', 'ST-09'), 'CCTR:1000', 'WBS:C-200')).toMatchObject({ basis: 'RATE', value: 10, amount: 150_000 });
  });

  it('活動配分：送信側は原価センタ×活動タイプ。額は計画レートでの配分に再評価を足したもの', () => {
    const at1 = view('S-DEFAULT', 'ACTIVITY', 'ST-01');
    const left = at1.left.find((n) => n.key === 'CCTR:3000#ENG')!;
    expect(left).toMatchObject({ activityType: 'ENG', planRate: 8000, unit: '時間' });
    expect(edge(at1, 'CCTR:3000#ENG', 'WBS:C-200')).toMatchObject({ basis: 'QUANTITY', value: 300, amount: 2_400_000 });
    expect(edge(view('S-DEFAULT', 'ACTIVITY', 'ST-09'), 'CCTR:3000#ENG', 'WBS:C-200').amount).toBe(2_400_000 + 2_955_000);
  });

  it('TDD：参照データ（売上）の額と構成比を線に持つ', () => {
    const v = view('S-DEFAULT', 'TDD', 'ST-09');
    const e = edge(v, `PSEG:${SEG.ALL_PG1}`, `PSEG:${SEG.A_PG1}`);
    expect(e).toMatchObject({ basis: 'REFERENCE', value: -6_000_000, editable: false, removable: false });
    expect(e.share).toBeCloseTo(0.6, 10);
  });

  it('利益センタ配賦（S-PC）：利益センタの残高は導出される全対象の合計', () => {
    expect(view('S-PC', 'PCTR_ALLOC', 'PRIMARY').left.find((n) => n.id === 'PC10')!.balance).toBe(9_000_000);
    const v = view('S-PC', 'PCTR_ALLOC', 'ST-04');
    expect(v.focusRuleId).toBe('CY-PC');
    // 間接費計算（-150,000）と IT部の減価償却の配布（-1,000,000）で、ST-04 の時点では PC10 から出ている
    expect(v.left.find((n) => n.id === 'PC10')!.balance).toBe(7_850_000);
    expect(edge(v, 'PCTR:PC10', 'PCTR:PC20')).toMatchObject({ basis: 'PORTION', value: 28, state: 'pending' });
    expect(edge(v, 'PCTR:PC10', 'PCTR:PC20').share).toBeCloseTo(0.7, 10);
  });
});

describe('全体のフロー図の利益センタ', () => {
  it('利益センタのノードは、導出される全対象の合計（S-PC の締め後は PC10 が0）', () => {
    const g = new SimSession(sampleProject(), 'S-PC').flowGraph('ST-09');
    expect(g.nodes.find((n) => n.key === 'PCTR:PC10')).toMatchObject({ balance: 0 });
    expect(g.edges.some((e) => e.source === 'PCTR:PC10' && e.target === 'PCTR:PC20')).toBe(true);
  });
});

describe('線の上での編集', () => {
  it('固定比率・分配規則・数量・率を直せる。関係を外せる', () => {
    const p = sampleProject();
    const s = () => p.scenarios[0]!;
    p.scenarios[0]!.cycles.find((c) => c.id === 'CY-MA')!.segments[0]!.receiver.factor = {
      kind: 'FIXED_PORTION',
      weights: [{ obj: { type: 'PSEG', id: SEG.ALL_PG1 }, portion: 1 }],
    };
    setRelationValue(p, 'S-DEFAULT', { ruleKind: 'CYCLE', ruleId: 'CY-MA', rowId: 'MA-01', source: 'CCTR:2000', target: `PSEG:${SEG.ALL_PG1}` }, 3);
    const f = s().cycles.find((c) => c.id === 'CY-MA')!.segments[0]!.receiver.factor;
    expect(f.kind === 'FIXED_PORTION' && f.weights[0]!.portion).toBe(3);

    setRelationValue(p, 'S-DEFAULT', { ruleKind: 'SETTLEMENT', ruleId: 'SR-P100', rowId: '0', source: 'WBS:P-100', target: 'CCTR:1100' }, 70);
    expect(s().settlementRules[0]!.rules[0]!.value).toBe(70);
    setRelationValue(p, 'S-DEFAULT', { ruleKind: 'ACTIVITY', ruleId: 'AA-01', source: 'CCTR:3000#ENG', target: 'WBS:C-200' }, 250);
    expect(s().activityAllocs[0]!.quantity).toBe(250);
    setRelationValue(p, 'S-DEFAULT', { ruleKind: 'COSTING', ruleId: 'CS-01', rowId: '0', source: 'CCTR:1000', target: 'WBS:C-200' }, 12);
    expect(s().costingSheets[0]!.rows[0]!.ratePct).toBe(12);

    removeRelation(p, 'S-DEFAULT', { ruleKind: 'CYCLE', ruleId: 'CY-DIST', rowId: 'DS-01', source: 'CCTR:1100', target: 'CCTR:2000' });
    // 統計KF の受信者はグループで選んでいるので、グループのままなら外れない（選択条件が個別のときだけ外せる）
    expect(s().cycles.find((c) => c.id === 'CY-DIST')!.segments[0]!.receiver.objects).toMatchObject({ mode: 'GROUP' });
    removeRelation(p, 'S-DEFAULT', { ruleKind: 'CYCLE', ruleId: 'CY-ASSESS', rowId: 'AS-01', source: 'CCTR:1000', target: 'CCTR:3000' });
    expect(s().cycles.find((c) => c.id === 'CY-ASSESS')!.segments[0]!.receiver.objects).toMatchObject({ ids: ['1100', '2000', '2100'] });
    removeRelation(p, 'S-DEFAULT', { ruleKind: 'ACTIVITY', ruleId: 'AA-01', source: 'CCTR:3000#ENG', target: 'WBS:C-200' });
    expect(s().activityAllocs).toEqual([]);
    expect(s().steps.find((x) => x.id === 'ST-01')!.itemIds).toEqual([]);
  });

  it('表示中のサイクルに線を引くと、送信者のセグメントに受信者を足すか、新しいセグメントを作る', () => {
    const p = sampleProject();
    const created = applyDrag(p, 'S-DEFAULT', { type: 'CCTR', id: '2100' }, { type: 'CCTR', id: '2000' }, { kind: 'NEW', method: 'ASSESS' }, { stepName: (m) => m });
    connectInCycle(p, 'S-DEFAULT', created.id, { type: 'CCTR', id: '2100' }, { type: 'CCTR', id: '3000' });
    connectInCycle(p, 'S-DEFAULT', created.id, { type: 'CCTR', id: '3000' }, { type: 'WBS', id: 'C-200' });
    const c = p.scenarios[0]!.cycles.find((x) => x.id === created.id)!;
    expect(c.segments).toHaveLength(2);
    expect(c.segments[0]!.receiver.objects).toMatchObject({ ids: ['2000', '3000'] });
    expect(c.segments[1]).toMatchObject({ id: 'SEG-02', allocAccount: '94100000' });
    expect(c.segments[1]!.receiver.objects).toMatchObject({ type: 'WBS', ids: ['C-200'] });
  });

  it('追加したばかりの空のサイクルに線を引くと、空のセグメントを使う（利益センタのコンテキスト）', () => {
    const p = sampleProject();
    const b = createBlankRule(p, 'S-DEFAULT', 'CYCLE', '新しいサイクル', { context: 'PCTR' });
    connectInCycle(p, 'S-DEFAULT', b.id, { type: 'PCTR', id: 'PC10' }, { type: 'PCTR', id: 'PC30' });
    const c = p.scenarios[0]!.cycles.find((x) => x.id === b.id)!;
    expect(c.segments).toHaveLength(1);
    expect(c.segments[0]).toMatchObject({ id: 'SEG-01', sender: { objects: { type: 'PCTR', ids: ['PC10'] } }, allocAccount: '94100000' });
  });

  it('活動配分を線で作るときは、送信側の活動タイプを使う', () => {
    const p = sampleProject();
    p.master.activityTypes.push({ id: 'SUP', name: 'サポート', unit: '時間', allocAccount: '94300000', rates: [{ cctr: '3000', planRate: 5000 }] });
    const r = applyDrag(p, 'S-DEFAULT', { type: 'CCTR', id: '3000' }, { type: 'WBS', id: 'P-100' }, { kind: 'NEW', method: 'ACTIVITY', activityType: 'SUP' }, { stepName: (m) => m });
    expect(p.scenarios[0]!.activityAllocs.find((a) => a.id === r.id)!.activityType).toBe('SUP');
  });
});

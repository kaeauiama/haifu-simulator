import { describe, expect, it } from 'vitest';
import { applyDrag, createBlankRule, deleteRule, dragOptions } from '../src/edit/rules.ts';
import { MasterIndex } from '../src/ledger/masterIndex.ts';
import { methodsFor, structuralEdges } from '../src/graph/rules.ts';
import { runAll } from '../src/run.ts';
import { SimSession } from '../src/session.ts';
import { SEG, sampleProject } from '../src/seed/sampleCompany.ts';
import { validateStatic } from '../src/validate/static.ts';

const cc = (id: string) => ({ type: 'CCTR' as const, id });
const wbs = (id: string) => ({ type: 'WBS' as const, id });
const seg = (id: string) => ({ type: 'PSEG' as const, id });
const stepName = (m: string) => `新しい${m}`;

describe('ノード間ドラッグで選べる手法（6章の表）', () => {
  it('送信と受信の組み合わせごとの候補', () => {
    expect(methodsFor('CCTR', 'CCTR')).toEqual(['DIST', 'ASSESS', 'ACTIVITY']);
    expect(methodsFor('CCTR', 'WBS')).toEqual(['DIST', 'ASSESS', 'ACTIVITY', 'OVERHEAD_CALC']);
    expect(methodsFor('CCTR', 'PSEG')).toEqual(['MA']);
    for (const r of ['CCTR', 'WBS', 'PSEG'] as const) expect(methodsFor('WBS', r)).toEqual(['SETTLEMENT']);
    expect(methodsFor('PSEG', 'PSEG')).toEqual(['TDD']);
    expect(methodsFor('PSEG', 'CCTR')).toEqual([]);
    expect(methodsFor('PSEG', 'WBS')).toEqual([]);
  });
});

describe('フロー図（F7-01）', () => {
  it('ルールの定義から線を導く。TDD の受信者は参照データから求める', () => {
    const p = sampleProject();
    const mi = new MasterIndex(p.master);
    const final = runAll(p, 'S-DEFAULT').snapshots.get('ST-09')!;
    const keys = structuralEdges(p.scenarios[0]!, mi, final).map((e) => `${e.method}:${e.sender.id}>${e.receiver.id}`);
    expect(keys).toEqual(
      expect.arrayContaining([
        'ACTIVITY:3000>C-200',
        'OVERHEAD_CALC:1000>C-200',
        'SETTLEMENT:P-100>1100',
        'DIST:1100>2000',
        'ASSESS:1000>1100',
        'ASSESS:1100>1000',
        `MA:2000>${SEG.ALL_PG1}`,
        `TDD:${SEG.ALL_PG1}>${SEG.A_PG1}`,
      ]),
    );
  });

  it('線の状態と金額は、選んだ時点で決まる（済み／まだ先／オフ／未割当）', () => {
    const p = sampleProject();
    p.scenarios[0]!.steps.find((s) => s.id === 'ST-04')!.enabled = false;
    p.scenarios[0]!.activityAllocs.push({ id: 'AA-99', senderCctr: '3000', activityType: 'ENG', receiver: wbs('C-200'), quantity: 10 });
    const session = new SimSession(p, 'S-DEFAULT');
    const g = session.flowGraph('ST-03');
    const edge = (rule: string, from: string, to: string) => g.edges.find((e) => e.ruleId === rule && e.source.endsWith(`:${from}`) && e.target.endsWith(`:${to}`))!;
    expect(edge('SR-P100', 'P-100', '1100')).toMatchObject({ state: 'done', amount: 3_000_000, method: 'SETTLEMENT' });
    expect(edge('CY-ASSESS', '1100', '2000')).toMatchObject({ state: 'pending', amount: 0 });
    expect(edge('CY-DIST', '1100', '2000')).toMatchObject({ state: 'disabled' });
    expect(edge('AA-99', '3000', 'C-200')).toMatchObject({ state: 'unassigned' });
    // 時点より後のステップで流れた額は入れない
    expect(session.flowGraph('PRIMARY').edges.every((e) => e.amount === 0)).toBe(true);
  });

  it('検証結果のあるルールの線とノードに印を付ける（F6-01）', () => {
    const g = new SimSession(sampleProject(), 'S-LATE').flowGraph('ST-09');
    expect(g.edges.find((e) => e.ruleId === 'CS-01')!.severity).toBe('WARNING');
    expect(g.nodes.find((n) => n.key === 'CCTR:1000')!.warnings).toBeGreaterThan(0);
  });
});

describe('線を引いてルールを作る（6章）', () => {
  it('CCTR→CCTR の配賦は新しいサイクルになり、標準の「原価センタ間の配賦」に入る。2本目からは同じセグメントに足せる', () => {
    const p = sampleProject();
    const s = () => p.scenarios[0]!;
    const created = applyDrag(p, 'S-DEFAULT', cc('2100'), cc('2000'), { kind: 'NEW', method: 'ASSESS' }, { stepName });
    expect(created.kind).toBe('CYCLE');
    const cycle = s().cycles.find((c) => c.id === created.id)!;
    expect(cycle).toMatchObject({ context: 'CCTR', type: 'OVERHEAD' });
    expect(cycle.segments[0]!.allocAccount).toBe('94100000');
    expect(s().steps.find((x) => x.id === 'ST-05')!.itemIds).toContain(created.id);

    const add = dragOptions(p, 'S-DEFAULT', cc('2100'), cc('3000')).find((o) => o.kind === 'ADD_TO_SEGMENT' && o.cycleId === created.id)!;
    expect(add).toBeDefined();
    applyDrag(p, 'S-DEFAULT', cc('2100'), cc('3000'), add, { stepName });
    const f = cycle.segments[0]!.receiver.factor;
    expect(f.kind === 'FIXED_PORTION' && f.weights.map((w) => w.obj.id)).toEqual(['2000', '3000']);
    expect(validateStatic(p, s(), new MasterIndex(p.master)).filter((i) => i.severity === 'ERROR')).toEqual([]);
  });

  it('WBS→CCTR の決済は決済①、WBS→セグメントは決済②に入る。既存の決済規則には残りの%で受信者を足す', () => {
    const p = sampleProject();
    p.scenarios[0]!.settlementRules[0]!.rules[0]!.value = 60;
    const opts = dragOptions(p, 'S-DEFAULT', wbs('P-100'), cc('1000'));
    expect(opts).toEqual([{ kind: 'ADD_TO_SETTLEMENT', method: 'SETTLEMENT', ruleId: 'SR-P100' }]);
    applyDrag(p, 'S-DEFAULT', wbs('P-100'), cc('1000'), opts[0]!, { stepName });
    expect(p.scenarios[0]!.settlementRules[0]!.rules[1]).toMatchObject({ receiver: cc('1000'), basis: 'PCT', value: 40 });

    p.master.wbs.push({ id: 'P-300', name: '新製品', projectType: 'OVERHEAD', responsibleCctr: '2000', profitCenter: 'PC20', statistical: false, settlementProfileId: 'SP-OH' });
    const r = applyDrag(p, 'S-DEFAULT', wbs('P-300'), seg(SEG.ALL_PG1), { kind: 'NEW', method: 'SETTLEMENT' }, { stepName });
    expect(p.scenarios[0]!.steps.find((x) => x.id === 'ST-07')!.itemIds).toContain(r.id);
  });

  it('TDD は受信側にだけある特性を細分化する特性にする。細かくない組は理由つきで作らない', () => {
    const p = sampleProject();
    const r = applyDrag(p, 'S-DEFAULT', seg(SEG.ALL_PG1), seg(SEG.B_PG1), { kind: 'NEW', method: 'TDD' }, { stepName });
    expect(p.scenarios[0]!.tddRules.find((x) => x.id === r.id)!.distributeChars).toEqual(['customer']);
    expect(() => applyDrag(p, 'S-DEFAULT', seg(SEG.A_PG1), seg(SEG.ALL_PG1), { kind: 'NEW', method: 'TDD' }, { stepName })).toThrow('細かい特性');
  });

  it('活動配分・間接費計算も作れる。作ったルールの識別子は種類をまたいで重ならない', () => {
    const p = sampleProject();
    const a = applyDrag(p, 'S-DEFAULT', cc('3000'), wbs('P-100'), { kind: 'NEW', method: 'ACTIVITY' }, { stepName });
    const c = applyDrag(p, 'S-DEFAULT', cc('1100'), wbs('P-100'), { kind: 'NEW', method: 'OVERHEAD_CALC' }, { stepName });
    expect(a.id).toBe('AA-02');
    expect(c.id).toBe('CS-02');
    expect(p.scenarios[0]!.steps.find((x) => x.id === 'ST-01')!.itemIds).toContain(a.id);
  });

  it('その種類のステップがなければ、新しいステップを作って入れる', () => {
    const p = sampleProject();
    p.scenarios[0]!.steps = p.scenarios[0]!.steps.filter((x) => x.kind !== 'TDD');
    applyDrag(p, 'S-DEFAULT', seg(SEG.ALL_PG1), seg(SEG.C_PG1), { kind: 'NEW', method: 'TDD' }, { stepName });
    expect(p.scenarios[0]!.steps.at(-1)).toMatchObject({ kind: 'TDD', name: '新しいTDD' });
  });

  it('ルールを消すと、ステップのジョブからも外れる。空のルールも作れる', () => {
    const p = sampleProject();
    deleteRule(p, 'S-DEFAULT', 'CYCLE', 'CY-DIST');
    expect(p.scenarios[0]!.cycles.map((c) => c.id)).not.toContain('CY-DIST');
    expect(p.scenarios[0]!.steps.find((x) => x.id === 'ST-04')!.itemIds).toEqual([]);
    const b = createBlankRule(p, 'S-DEFAULT', 'CYCLE', '新しいサイクル');
    expect(p.scenarios[0]!.cycles.find((c) => c.id === b.id)!.name).toBe('新しいサイクル');
  });

  it('種類の違うルールで識別子が重なれば X-DUP-ID', () => {
    const p = sampleProject();
    p.scenarios[0]!.tddRules[0]!.id = 'CY-DIST';
    expect(validateStatic(p, p.scenarios[0]!, new MasterIndex(p.master)).map((i) => i.code)).toContain('X-DUP-ID');
  });
});

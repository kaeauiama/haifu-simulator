import { describe, expect, it } from 'vitest';
import type { AllocationCycle, Scenario, SettlementRule } from '../src/model/types.ts';
import { SEG, sampleProject } from '../src/seed/sampleCompany.ts';
import { ACCOUNT_RANGES } from '../src/seed/ycoa.ts';
import { cc, codes, emptyScenario, linesOf, run, seg, step, testProject, wbs } from './helpers.ts';

const base = sampleProject().scenarios[0]!;
const dist = base.cycles.find((c) => c.id === 'CY-DIST')!;

function withCycle(c: AllocationCycle, extra: Partial<Scenario> = {}) {
  return run(testProject({ scenario: emptyScenario([step('ST-A', 'ALLOC_CYCLE', [c.id])], { cycles: [c], ...extra }) }));
}

describe('実行前検証（F6-01、5.5）', () => {
  it('V-01 配布の送信勘定に二次原価が含まれる → エラー、仕訳を作らない', () => {
    const c = structuredClone(dist);
    c.segments[0]!.sender.accounts = [ACCOUNT_RANGES.allCosts];
    const r = withCycle(c);
    expect(codes(r)).toContain('V-01');
    expect(linesOf(r, 'ST-A')).toHaveLength(0);
  });

  it('V-02 配賦タイプで配賦勘定が未設定、またはカテゴリ42でない', () => {
    const c: AllocationCycle = { ...structuredClone(dist), type: 'OVERHEAD' };
    expect(codes(withCycle(c))).toContain('V-02');
    c.segments[0]!.allocAccount = '94900000';
    expect(codes(withCycle(c))).toContain('V-02');
    c.segments[0]!.allocAccount = '94100000';
    expect(codes(withCycle(c))).not.toContain('V-02');
  });

  it('V-03 統計WBSが受信者になっている', () => {
    const c = structuredClone(dist);
    c.segments[0]!.receiver = {
      objects: { type: 'WBS', mode: 'LIST', ids: ['S-300'] },
      factor: { kind: 'FIXED_PERCENT', weights: [{ obj: wbs('S-300'), pct: 100 }] },
    };
    const p = testProject({
      scenario: emptyScenario([step('ST-A', 'ALLOC_CYCLE', [c.id])], { cycles: [c] }),
      master: (m) => m.wbs.push({ id: 'S-300', name: '統計WBS', projectType: 'OVERHEAD', responsibleCctr: '1000', profitCenter: 'PC10', statistical: true }),
    });
    expect(codes(run(p))).toContain('V-03');
  });

  it('P-10 統計WBSへの一次仕訳は、責任原価センタの実績として扱う', () => {
    const p = testProject({
      scenario: emptyScenario([]),
      postings: [{ id: 'PX', account: '63000000', obj: wbs('S-300'), amount: 1000 }],
      master: (m) => m.wbs.push({ id: 'S-300', name: '統計WBS', projectType: 'OVERHEAD', responsibleCctr: '1000', profitCenter: 'PC10', statistical: true }),
    });
    const r = run(p);
    expect(r.ledger[0]!.obj).toEqual(cc('1000'));
    expect(codes(r)).toContain('X-STAT-WBS');
  });

  const settle = (rules: SettlementRule['rules'], sender = wbs('P-100')): SettlementRule => ({ id: 'SR-X', sender, rules });

  it('V-04 決済の受信者が、決済プロファイルで許されていない', () => {
    const p = testProject({
      scenario: emptyScenario([step('ST-S', 'SETTLEMENT', ['SR-X'])], {
        settlementRules: [settle([{ receiver: seg(SEG.ALL_PG1), basis: 'PCT', value: 100, settlementType: 'FUL', validFrom: 202604 }])],
      }),
      master: (m) => (m.settlementProfiles[0]!.allowed = ['CCTR']),
    });
    const r = run(p);
    expect(codes(r)).toContain('V-04');
    expect(linesOf(r, 'ST-S')).toHaveLength(0);
  });

  it('V-05 分配規則の%合計が100を超える', () => {
    const r = run(
      testProject({
        scenario: emptyScenario([step('ST-S', 'SETTLEMENT', ['SR-X'])], {
          settlementRules: [
            settle([
              { receiver: cc('1000'), basis: 'PCT', value: 60, settlementType: 'FUL', validFrom: 202604 },
              { receiver: cc('1100'), basis: 'PCT', value: 50, settlementType: 'FUL', validFrom: 202604 },
            ]),
          ],
        }),
      }),
    );
    expect(codes(r)).toContain('V-05');
    expect(linesOf(r, 'ST-S')).toHaveLength(0);
  });

  it('V-08 同じWBSを2つのステップで決済している（オフのステップは数えない）', () => {
    const rules = [settle([{ receiver: cc('1100'), basis: 'PCT', value: 100, settlementType: 'FUL', validFrom: 202604 }])];
    const on = run(testProject({ scenario: emptyScenario([step('S1', 'SETTLEMENT', ['SR-X']), step('S2', 'SETTLEMENT', ['SR-X'])], { settlementRules: rules }) }));
    expect(codes(on)).toContain('V-08');
    const off = run(testProject({ scenario: emptyScenario([step('S1', 'SETTLEMENT', ['SR-X']), step('S2', 'SETTLEMENT', ['SR-X'], false)], { settlementRules: rules }) }));
    expect(codes(off)).not.toContain('V-08');
  });

  it('V-13 配分基準の合計が0（受信側の統計KFがすべて0）', () => {
    const c = structuredClone(dist);
    const p = testProject({
      scenario: emptyScenario([step('ST-A', 'ALLOC_CYCLE', [c.id])], { cycles: [c] }),
      master: (m) => (m.skfs[0]!.values = m.skfs[0]!.values.map((v) => ({ ...v, value: 0 }))),
    });
    const r = run(p);
    expect(codes(r)).toContain('V-13');
    expect(linesOf(r, 'ST-A')).toHaveLength(0);
  });

  it('V-13 VARIABLE の受信側残高が0なら、実行時にエラー', () => {
    const c = structuredClone(dist);
    c.segments[0]!.receiver.factor = { kind: 'VARIABLE', accounts: [{ from: '41000000', to: '41999999' }] };
    const r = withCycle(c);
    expect(r.issues.find((i) => i.code === 'V-13')?.phase).toBe('RUN');
  });

  it('V-14 顧客プロジェクトのWBSに決済規則がある（警告）', () => {
    const r = run(
      testProject({
        scenario: emptyScenario([], {
          settlementRules: [settle([{ receiver: seg(SEG.A_SVC), basis: 'PCT', value: 100, settlementType: 'FUL', validFrom: 202604 }], wbs('C-200'))],
        }),
      }),
    );
    expect(r.issues.find((i) => i.code === 'V-14')?.severity).toBe('WARNING');
  });

  it('V-16 は顧客プロジェクトのWBSを未配分に数えない（属性セグメントに出ているため、P-08）', () => {
    const r = run(testProject({ scenario: emptyScenario([]) }));
    const v16 = r.issues.filter((i) => i.code === 'V-16').map((i) => i.obj?.id);
    expect(v16).toEqual(expect.arrayContaining(['1100', '3000', 'P-100']));
    expect(v16).not.toContain('C-200');
  });

  it('WBSをUniversal Allocationの送信側にする組み方は、要確認としてMVPでは実行しない', () => {
    const c = structuredClone(dist);
    c.segments[0]!.sender.objects = { type: 'WBS', mode: 'LIST', ids: ['P-100'] };
    const r = withCycle(c);
    expect(r.issues.find((i) => i.code === 'X-UNSUPPORTED')?.message).toContain('要確認');
    expect(linesOf(r, 'ST-A')).toHaveLength(0);
  });

  it('ステップが存在しないルールを指していれば X-REF', () => {
    const r = run(testProject({ scenario: emptyScenario([step('ST-A', 'ALLOC_CYCLE', ['NOPE'])]) }));
    expect(codes(r)).toContain('X-REF');
  });

  it('サンプルのセグメント識別子は特性値の連結と一致する。ずれていれば X-SEG-ID', () => {
    const p = testProject({ scenario: emptyScenario([]), master: (m) => (m.segments[0]!.id = 'SEG-A') });
    expect(codes(run(p))).toContain('X-SEG-ID');
  });
});

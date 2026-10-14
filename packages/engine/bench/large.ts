/**
 * 規模の確認用のデータ（3.10 非機能）：原価センタ300、WBS100、セグメント約100（オブジェクト約500件）、
 * 一次仕訳1万行、ステップ15件。乱数は固定の種で作るので、毎回同じデータになる。
 */
import { segmentKey } from '../src/model/keys.ts';
import type { AllocationCycle, ClosingStep, PrimaryPosting, Project } from '../src/model/types.ts';
import { sampleProject } from '../src/seed/sampleCompany.ts';
import { ACCOUNT_RANGES } from '../src/seed/ycoa.ts';

export function largeProject(): Project {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const p = sampleProject();
  const m = p.master;
  const pcs = Array.from({ length: 20 }, (_, i) => `PC${String(i + 100)}`);
  m.profitCenters.push(...pcs.map((id) => ({ id, name: id })));
  const support = Array.from({ length: 50 }, (_, i) => `S${String(i).padStart(3, '0')}`);
  const ops = Array.from({ length: 250 }, (_, i) => `O${String(i).padStart(3, '0')}`);
  for (const id of [...support, ...ops]) m.costCenters.push({ id, name: id, profitCenter: pick(pcs), kind: 'SERVICE' });
  const projects = Array.from({ length: 100 }, (_, i) => `W${String(i).padStart(3, '0')}`);
  for (const id of projects) {
    m.wbs.push({ id, name: id, projectType: 'OVERHEAD', responsibleCctr: pick(support), profitCenter: pick(pcs), statistical: false, settlementProfileId: 'SP-OH' });
  }
  const custSegs: string[] = [];
  for (let c = 0; c < 50; c++) {
    for (const pg of ['PG1', 'PG2']) {
      const chars = { customer: `K${c}`, productGroup: pg, profitCenter: pcs[c % 20]! };
      m.segments.push({ id: segmentKey(chars), chars, attributed: false });
      custSegs.push(segmentKey(chars));
    }
  }
  const coarse = ['PG1', 'PG2'].map((pg) => segmentKey({ productGroup: pg, profitCenter: 'PC100' }));
  m.skfs[0]!.values.push(...[...support, ...ops].map((id) => ({ obj: { type: 'CCTR' as const, id }, value: 1 + Math.floor(rnd() * 30) })));
  m.activityTypes[0]!.rates.push(...support.slice(0, 10).map((cctr) => ({ cctr, planRate: 5000 + Math.floor(rnd() * 5000) })));

  const costAccounts = ['61000000', '61200000', '63000000', '64000000', '65000000', '66000000', '67000000', '68000000'];
  const postings: PrimaryPosting[] = [];
  for (let i = 0; i < 10_000; i++) {
    const r = rnd();
    const id = `L${i}`;
    const amount = 1000 + Math.floor(rnd() * 1_000_000);
    if (r < 0.7) postings.push({ id, account: pick(costAccounts), obj: { type: 'CCTR', id: pick([...support, ...ops]) }, amount });
    else if (r < 0.85) postings.push({ id, account: pick(costAccounts), obj: { type: 'WBS', id: pick(projects) }, amount });
    else if (r < 0.97) postings.push({ id, account: '41000000', obj: { type: 'PSEG', id: pick(custSegs) }, amount: -amount * 3 });
    else postings.push({ id, account: '68000000', obj: { type: 'PSEG', id: pick(coarse) }, amount });
  }
  p.primaryPostings = postings;

  const cyc = (id: string, type: AllocationCycle['type'], iterative: boolean, senders: string[], receivers: string[], context: 'CCTR' | 'MA' = 'CCTR'): AllocationCycle => ({
    id,
    name: id,
    context,
    type,
    iterative,
    segments: [
      {
        id: `${id}-1`,
        name: id,
        sender: {
          objects: { type: 'CCTR', mode: 'LIST', ids: senders },
          accounts: [type === 'DISTRIBUTION' ? ACCOUNT_RANGES.primaryCosts : ACCOUNT_RANGES.allCosts],
          sharePct: 100,
        },
        receiver:
          context === 'MA'
            ? { objects: { type: 'PSEG', mode: 'LIST', ids: receivers }, factor: { kind: 'VARIABLE', accounts: [ACCOUNT_RANGES.revenue] } }
            : { objects: { type: 'CCTR', mode: 'LIST', ids: receivers }, factor: { kind: 'SKF', skfId: 'HC' } },
        ...(type === 'OVERHEAD' ? { allocAccount: '94100000' } : {}),
      },
    ],
  });
  const sc = p.scenarios[0]!;
  sc.activityAllocs = Array.from({ length: 50 }, (_, i) => ({
    id: `AA${i}`,
    senderCctr: support[i % 10]!,
    activityType: 'ENG',
    receiver: { type: 'WBS' as const, id: projects[i]! },
    quantity: 10 + Math.floor(rnd() * 100),
  }));
  sc.costingSheets = [
    { id: 'CS', rows: [{ base: [ACCOUNT_RANGES.primaryCosts], ratePct: 5, creditCctr: support[0]!, overheadAccount: '94200000' }], targets: projects.map((id) => ({ type: 'WBS' as const, id })) },
  ];
  sc.settlementRules = projects.map((id) => ({
    id: `SR-${id}`,
    sender: { type: 'WBS' as const, id },
    rules: [{ receiver: { type: 'CCTR' as const, id: pick(support) }, basis: 'PCT' as const, value: 100, settlementType: 'FUL' as const, validFrom: 202604 }],
  }));
  sc.cycles = [
    cyc('DIST', 'DISTRIBUTION', false, support.slice(0, 25), ops),
    { ...cyc('ITER', 'OVERHEAD', true, support, [...support, ...ops.slice(0, 50)]) },
    cyc('OPS1', 'OVERHEAD', false, ops.slice(0, 100), ops.slice(100)),
    cyc('OPS2', 'OVERHEAD', false, ops.slice(100, 175), ops.slice(175)),
    cyc('MA', 'OVERHEAD', false, ops.slice(175), custSegs, 'MA'),
  ];
  // ITER は送信者が受信者にも入る。送信者同士の配賦を含む反復
  sc.cycles[1]!.segments[0]!.receiver.objects = { type: 'CCTR', mode: 'LIST', ids: [...support, ...ops.slice(0, 50)] };
  sc.tddRules = [{ ...sc.tddRules[0]!, sender: { segments: { type: 'PSEG', mode: 'FILTER', chars: { profitCenter: 'PC100' } }, accounts: [ACCOUNT_RANGES.allCosts] } }];
  const s = (id: string, kind: ClosingStep['kind'], itemIds: string[]): ClosingStep => ({ id, name: id, kind, itemIds, enabled: true });
  sc.steps = [
    s('P01', 'ACTIVITY_ALLOC', sc.activityAllocs.map((a) => a.id)),
    s('P02', 'OVERHEAD_CALC', ['CS']),
    s('P03', 'SETTLEMENT', sc.settlementRules.map((r) => r.id)),
    s('P04', 'ALLOC_CYCLE', ['DIST']),
    s('P05', 'ALLOC_CYCLE', ['ITER']),
    s('P06', 'ACTUAL_RATE_REVAL', []),
    s('P07', 'ALLOC_CYCLE', ['OPS1']),
    s('P08', 'ALLOC_CYCLE', ['OPS2']),
    s('P09', 'ALLOC_CYCLE', ['MA']),
    s('P10', 'TDD', ['TDD-01']),
    s('P11', 'SETTLEMENT', []),
    s('P12', 'ALLOC_CYCLE', []),
    s('P13', 'ALLOC_CYCLE', []),
    s('P14', 'TDD', []),
    s('P15', 'ACTUAL_RATE_REVAL', []),
  ];
  p.scenarios = [sc];
  return p;
}

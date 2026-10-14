import { describe, expect, it } from 'vitest';
import { MasterIndex } from '../src/ledger/masterIndex.ts';
import { SimSession } from '../src/session.ts';
import { SEG, sampleProject } from '../src/seed/sampleCompany.ts';

const session = () => new SimSession(sampleProject(), 'S-DEFAULT');
const parts = (v: ReturnType<SimSession['composition']>, key: string) => Object.fromEntries(v.rows.find((r) => r.key === key)!.parts.map((p) => [p.key, p.amount]));

describe('配賦上の役割（D-045）', () => {
  it('原価センタはマスタの役割、未設定なら区分から。WBS と収益性セグメントは種類から決める', () => {
    const p = sampleProject();
    const mi = new MasterIndex(p.master);
    expect(mi.tierOf({ type: 'CCTR', id: '1000' })).toBe('CORPORATE');
    expect(mi.tierOf({ type: 'CCTR', id: '1100' })).toBe('SUPPORT');
    expect(mi.tierOf({ type: 'CCTR', id: '3000' })).toBe('OPERATING');
    expect(mi.tierOf({ type: 'WBS', id: 'P-100' })).toBe('PROJECT');
    expect(mi.tierOf({ type: 'WBS', id: 'C-200' })).toBe('GOAL');
    expect(mi.tierOf({ type: 'PSEG', id: SEG.A_PG1 })).toBe('GOAL');
    delete p.master.costCenters.find((c) => c.id === '3000')!.tier;
    expect(new MasterIndex(p.master).tierOf({ type: 'CCTR', id: '3000' })).toBe('SUPPORT'); // 区分 SERVICE から
  });

  it('時点の対象の一覧は役割の順（コーポ部門 → 間接部門 → 直接部門 → プロジェクト → ゴール）', () => {
    const tiers = session().stepView('ST-09').objects.map((o) => o.tier);
    expect([...new Set(tiers)]).toEqual(['CORPORATE', 'SUPPORT', 'OPERATING', 'PROJECT', 'GOAL']);
  });
});

describe('金額の構成（D-046）', () => {
  it('直前の送り手：1100 は決済①の時点で 直課 5,000,000 ＋ P-100 からの 3,000,000、配った額はまだない', () => {
    const v = session().composition('ST-03', 'SOURCE');
    expect(parts(v, 'CCTR:1100')).toEqual({ DIRECT: 5_000_000, 'WBS:P-100': 3_000_000 });
    const row = v.rows.find((r) => r.key === 'CCTR:1100')!;
    expect(row.parts.map((x) => x.kind)).toEqual(['DIRECT', 'PROJECT']);
    expect(row.parts[1]!.label).toBe('P-100 社内システム刷新');
  });

  it('直前の送り手：締め後の 1100 は、受け取った額と配った額が打ち消し合って0', () => {
    const v = session().composition('ST-09', 'SOURCE');
    const p = parts(v, 'CCTR:1100');
    expect(p.DIRECT).toBe(5_000_000);
    expect(p['CCTR:1000']).toBeGreaterThan(0);
    expect(Object.values(p).reduce((t, x) => t + x, 0)).toBe(0);
    expect(v.rows.find((r) => r.key === 'CCTR:1100')!.parts.at(-1)!.kind).toBe('SENT');
  });

  it('発生元：顧客A のセグメントは、自分の売上（直課）と、元の対象ごとの原価に分かれ、合計は残高に一致する', () => {
    const v = session().composition('ST-09', 'ORIGIN');
    const row = v.rows.find((r) => r.key === `PSEG:${SEG.A_PG1}`)!;
    const p = parts(v, row.key);
    expect(p.DIRECT).toBe(-6_000_000);
    expect(p['CCTR:1100']).toBeGreaterThan(0);
    expect(p['WBS:P-100']).toBeGreaterThan(0);
    expect(p[`PSEG:${SEG.ALL_PG1}`]).toBe(180_000); // 運賃（全社×PG1 の一次仕訳）の60%
    expect(row.parts.reduce((t, x) => t + x.amount, 0)).toBe(row.balance);
    expect(row.balance).toBe(new SimSession(sampleProject(), 'S-DEFAULT').stepView('ST-09').objects.find((o) => o.key === row.key)!.balance);
    // 流し終えて残高0の対象は出さない
    expect(v.rows.some((r) => r.key === 'CCTR:1100')).toBe(false);
  });
});

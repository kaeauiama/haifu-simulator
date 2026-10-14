import { describe, expect, it } from 'vitest';
import { MasterIndex } from '../src/ledger/masterIndex.ts';
import { ProjectSchema } from '../src/model/schema.ts';
import { runAll, type RunResult } from '../src/run.ts';
import { SimSession } from '../src/session.ts';
import { RAIL_SEG, RAIL_STATIONS, railwayProject } from '../src/seed/railway.ts';
import { SEG, sampleProject } from '../src/seed/sampleCompany.ts';
import { bal, codes, finalOf, seg } from './helpers.ts';

/** 一次仕訳の合計（収入はマイナス）。締め後は、これが駅のセグメントに分かれて残る＝営業利益 */
const PRIMARY_TOTAL = railwayProject().primaryPostings.reduce((t, p) => t + p.amount, 0);
const station = (code: string) => seg(RAIL_SEG[code]!);
/** 駅の収支（利益をプラスで） */
const profit = (r: RunResult, code: string) => -bal(r, station(code));

describe('みどり川電鉄（F2-03、D-052）', () => {
  it('F9-01 スキーマに合い、JSON を往復しても同じ', () => {
    const p = railwayProject();
    expect(ProjectSchema.parse(p)).toEqual(p);
    expect(ProjectSchema.parse(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });

  it('営業利益は約8千万円／月（収入の約14%）', () => {
    const revenue = -railwayProject()
      .primaryPostings.filter((p) => p.account.startsWith('41'))
      .reduce((t, p) => t + p.amount, 0);
    expect(-PRIMARY_TOTAL).toBe(79_710_500);
    expect(-PRIMARY_TOTAL / revenue).toBeCloseTo(0.14, 2);
  });

  for (const scenarioId of ['S-DEFAULT', 'S-PAX', 'S-HQREV']) {
    it(`T-10 ${scenarioId}：エラーなく締まり、ゼロサムが一致し、駅以外に残高が残らない（V-16 なし）`, () => {
      const r = runAll(railwayProject(), scenarioId);
      expect(r.issues.filter((i) => i.severity === 'ERROR')).toEqual([]);
      expect(finalOf(r).grandTotal()).toBe(PRIMARY_TOTAL);
      expect(codes(r)).not.toContain('V-16');
      expect(codes(r)).not.toContain('V-17');
      expect(RAIL_STATIONS.reduce((t, s) => t + bal(r, station(s.code)), 0)).toBe(PRIMARY_TOTAL);
      expect(bal(r, seg(RAIL_SEG.MAIN))).toBe(0);
      expect(bal(r, seg(RAIL_SEG.BRANCH))).toBe(0);
    });
  }

  it('TDD：Web・定期券センターの定期は、駅で売った定期の比で駅へ。駅の定期収入は「駅発売分÷0.7」に戻る', () => {
    const r = runAll(railwayProject(), 'S-DEFAULT');
    for (const s of RAIL_STATIONS) {
      expect(Math.abs(-bal(r, station(s.code), '41200000') - Math.round(s.commuter / 0.7))).toBeLessThanOrEqual(1);
    }
  });

  it('駅別収支（既定）：中央駅が最大の黒字、工業団地駅が最大の赤字。温泉駅は観光客の定期外運賃で黒字', () => {
    const r = runAll(railwayProject(), 'S-DEFAULT');
    const ranked = RAIL_STATIONS.map((s) => s.code).sort((a, b) => profit(r, b) - profit(r, a));
    expect(ranked[0]).toBe('S01');
    expect(ranked.at(-1)).toBe('S07');
    expect(profit(r, 'S11')).toBeGreaterThan(0);
  });

  it('S-PAX：線路・電路の保存費を乗車人員で配ると、中央駅の負担が増え、末端の駅の負担が減る。全体の利益は変わらない', () => {
    const a = runAll(railwayProject(), 'S-DEFAULT');
    const b = runAll(railwayProject(), 'S-PAX');
    expect(profit(b, 'S01')).toBeLessThan(profit(a, 'S01'));
    for (const code of ['S07', 'S09', 'S10', 'S11']) expect(profit(b, code)).toBeGreaterThan(profit(a, code));
    expect(finalOf(b).grandTotal()).toBe(finalOf(a).grandTotal());
  });

  it('S-HQREV：本社部門の配賦（ステップ5）はオフ。本社費はマージン分析で運賃収入の比で全駅へ（中央駅が最も多い）', () => {
    const r = runAll(railwayProject(), 'S-HQREV');
    expect(r.ledger.some((l) => l.stepId === 'ST-05')).toBe(false);
    const recv = r.ledger.filter((l) => l.origin.rowId === 'MA-00' && l.role === 'RECEIVER');
    const byStation = new Map<string, number>();
    for (const l of recv) byStation.set(l.obj.id, (byStation.get(l.obj.id) ?? 0) + l.amount);
    expect(byStation.size).toBe(RAIL_STATIONS.length);
    const top = [...byStation].sort((x, y) => y[1] - x[1])[0]![0];
    expect(top).toBe(RAIL_SEG.S01);
  });

  it('駅の損益には、営業費の区分ごとの二次勘定（駅務・運転・動力・車両・線路電路・輸送管理）が並ぶ', () => {
    const r = runAll(railwayProject(), 'S-DEFAULT');
    for (const account of ['94110000', '94120000', '94130000', '94140000', '94150000', '94160000']) {
      expect(bal(r, station('S05'), account)).toBeGreaterThan(0);
    }
  });
});

describe('サンキー図の向き（F7-02、D-052）', () => {
  it('TDD で配った売上は、線区全体（駅未設定）から駅への流れとして描く', () => {
    const d = new SimSession(railwayProject(), 'S-DEFAULT').sankey(['ST-09']);
    const main = `PSEG:${RAIL_SEG.MAIN}`;
    const out = d.links.filter((l) => l.source === main);
    expect(out.length).toBe(RAIL_STATIONS.filter((s) => s.pc === 'PC20').length);
    expect(d.links.some((l) => l.target === main)).toBe(false);
    expect(out.every((l) => l.method === 'TDD')).toBe(true);
  });
});

describe('セグメントの表示名（D-051）', () => {
  it('名前があれば名前、なければ特性値をつないだ名前', () => {
    const mi = new MasterIndex(railwayProject().master);
    expect(mi.segmentName(RAIL_SEG.S01!)).toBe('中央駅');
    expect(mi.label(station('S01'))).toBe('セグメント 中央駅');
    expect(new MasterIndex(sampleProject().master).segmentName(SEG.A_PG1)).toBe('顧客A×PG1×PC20');
  });

  it('集計・金額の構成も名前で出る', () => {
    const s = new SimSession(railwayProject(), 'S-DEFAULT');
    expect(s.stepView('ST-09').bySegment.find((x) => x.key === RAIL_SEG.S01)!.label).toBe('中央駅');
    expect(s.composition('ST-09', 'SOURCE').rows.find((x) => x.key === `PSEG:${RAIL_SEG.S01}`)!.label).toBe('中央駅');
  });
});

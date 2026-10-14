import { describe, expect, it } from 'vitest';
import { parseCsv } from '../src/io/csv.ts';
import { settingsTables } from '../src/io/settings.ts';
import { SimSession } from '../src/session.ts';
import { SEG, sampleProject } from '../src/seed/sampleCompany.ts';

const session = (id: string) => new SimSession(sampleProject(), id);

describe('サンキー図の材料（F7-02）', () => {
  it('相互の流れ（反復配賦）は差し引いて1本にし、循環のない流れにする', () => {
    const d = session('S-DEFAULT').sankey();
    const pair = d.links.filter((l) => [l.source, l.target].sort().join() === ['CCTR:1000', 'CCTR:1100'].sort().join());
    expect(pair).toHaveLength(1);
    expect(d.links.every((l) => l.value > 0)).toBe(true);
    // 循環がない（入次数0から順にたどれる）
    const indeg = new Map(d.nodes.map((n) => [n.key, 0]));
    for (const l of d.links) indeg.set(l.target, indeg.get(l.target)! + 1);
    const queue = [...indeg].filter(([, v]) => v === 0).map(([k]) => k);
    let seen = 0;
    while (queue.length) {
      const k = queue.shift()!;
      seen++;
      for (const l of d.links.filter((x) => x.source === k)) {
        indeg.set(l.target, indeg.get(l.target)! - 1);
        if (indeg.get(l.target) === 0) queue.push(l.target);
      }
    }
    expect(seen).toBe(d.nodes.length);
  });

  it('ステップで絞り込める。決済①だけなら P-100 → 1100 の 3,000,000 だけ', () => {
    const d = session('S-DEFAULT').sankey(['ST-03']);
    expect(d.links).toEqual([{ source: 'WBS:P-100', target: 'CCTR:1100', value: 3_000_000, method: 'SETTLEMENT' }]);
    expect(d.nodes.map((n) => n.label)).toEqual(['1100 IT部', 'P-100 社内システム刷新']);
  });

  it('TDD の流れはセグメントどうし、手法は線の色に使う', () => {
    const d = session('S-DEFAULT').sankey(['ST-09']);
    expect(d.links.find((l) => l.target === `PSEG:${SEG.A_PG1}`)).toMatchObject({ method: 'TDD' });
  });
});

describe('シナリオ比較（F8-02、F4-04）', () => {
  it('利益センタ別などの差に表示名を付け、ステップの並びと結果が変わったステップを示す', () => {
    const c = session('S-DEFAULT').compareWith(session('S-LATE'));
    expect(c.a).toEqual({ id: 'S-DEFAULT', name: '既定順（標準テンプレート）' });
    expect(c.byProfitCenter.find((r) => r.key === 'PC10')).toMatchObject({ label: 'PC10 本社', a: 0, b: 2_850_000, diff: 2_850_000 });
    expect(c.bySegment.find((r) => r.key === SEG.A_PG1)!.label).toBe('顧客A×PG1×PC20');
    expect(c.byAccount.find((r) => r.key === '94100000')!.label).toBe('94100000 配賦（間接費配賦）');
    const st = (id: string) => c.steps.find((x) => x.id === id)!;
    expect(st('ST-02')).toMatchObject({ indexA: 2, indexB: 4, changed: false });
    expect(st('ST-05')).toMatchObject({ indexA: 5, indexB: 3, changed: true });
  });
});

describe('出力（F9-03、F9-04）', () => {
  it('F9-04 仕訳 CSV：台帳の全行と見出し', () => {
    const s = session('S-DEFAULT');
    const rows = parseCsv(s.journalCsv());
    expect(rows[0]).toEqual(['行ID', 'ステップ', '伝票', 'ルール', 'ルールの行', '区分', '対象種類', '対象ID', '対象名', '相手', '勘定', '勘定名', '利益センタ', '金額']);
    expect(rows).toHaveLength(s.result.ledger.length + 1);
    expect(rows.slice(1).reduce((t, r) => t + Number(r[13]), 0)).toBe(3_500_000);
  });

  it('F9-03 設定一覧：締めステップ、サイクル（セグメントごと）、決済規則（分配規則ごと）ほか', () => {
    const t = settingsTables(sampleProject(), 'S-DEFAULT');
    expect(t.map((x) => x.name)).toEqual(['締めステップ', 'サイクル', '決済規則', '直接活動配分', '原価計算シート', 'TDD']);
    const cycles = t.find((x) => x.name === 'サイクル')!;
    expect(cycles.rows).toHaveLength(4);
    const dist = cycles.rows.find((r) => r[0] === 'CY-DIST')!;
    expect(dist.slice(2, 13)).toEqual(['原価センタ', '配布', 'しない', 'DS-01', 'IT部→事業部門（人数）', '原価センタ：1100', '65000000-65999999', 100, '原価センタ：グループ CCG-OPS', '統計KF', 'HC 人数']);
    expect(dist[14]).toBe('4. 原価センタ間の配布');
    const sr = t.find((x) => x.name === '決済規則')!.rows[0]!;
    expect(sr).toEqual(['SR-P100', 'P-100', '社内システム刷新', '間接費プロジェクト', 'SP-OH', '原価センタ', '1100', '%', 100, 'FUL', 202604, '', '3. 決済①：間接費プロジェクト→原価センタ']);
    const tdd = t.find((x) => x.name === 'TDD')!.rows[0]!;
    expect(tdd[2]).toBe('製品グループ=PG1');
  });
});

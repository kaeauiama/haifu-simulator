import { describe, expect, it } from 'vitest';
import { findReferences, renameReference } from '../src/edit/refs.ts';
import { postingsFromCsv, postingsToCsv } from '../src/io/csv.ts';
import { parseProjectJson, serializeProject } from '../src/io/project.ts';
import { segmentKey } from '../src/model/keys.ts';
import { SimSession } from '../src/session.ts';
import { SEG, sampleProject } from '../src/seed/sampleCompany.ts';
import { runAll } from '../src/run.ts';

describe('画面向けセッション（F5-02、F7-03、F7-04）', () => {
  const s = new SimSession(sampleProject(), 'S-DEFAULT');

  it('summary：先頭は一次仕訳の時点。ゼロサム検査の結果を持つ', () => {
    const sum = s.summary();
    expect(sum.steps[0]).toMatchObject({ id: 'PRIMARY', index: 0, lineCount: 10 });
    expect(sum.steps.map((x) => x.id).slice(1)).toEqual(sampleProject().scenarios[0]!.steps.map((x) => x.id));
    expect(sum.steps.find((x) => x.id === 'ST-03')).toMatchObject({ lineCount: 2, receivedTotal: 3_000_000 });
    expect(sum.zeroSumOk).toBe(true);
    expect(sum.primaryTotal).toBe(3_500_000);
  });

  it('F5-02 stepView：各時点の残高と、直前の時点からの増減を返す（巻き戻しは時点を選び直すだけ）', () => {
    const v3 = s.stepView('ST-03');
    const it1100 = v3.objects.find((o) => o.key === 'CCTR:1100')!;
    expect(it1100.balance).toBe(8_000_000);
    expect(it1100.delta).toBe(3_000_000);
    expect(it1100.residual).toBe(true);
    expect(v3.lines).toHaveLength(2);
    expect(v3.lines[0]).toMatchObject({ ruleId: 'SR-P100', rowId: '1', account: '94900000', accountName: '決済' });
    const v0 = s.stepView('PRIMARY');
    expect(v0.objects.find((o) => o.key === 'CCTR:1100')!.balance).toBe(5_000_000);
    // C-200 は顧客プロジェクトなので未配分として強調しない（P-08）
    expect(s.stepView('ST-09').objects.find((o) => o.key === 'WBS:C-200')!.residual).toBe(false);
  });

  it('F7-03 objectTable：勘定×時点の表。時点名を持つ', () => {
    const t = s.objectTable('CCTR:1100');
    expect(t.steps[0]).toEqual({ id: 'PRIMARY', name: '一次仕訳' });
    expect(t.accounts.map((a) => a.id)).toContain('94900000');
    expect(t.totals.at(-1)).toBe(0);
  });

  it('F7-04 lineage：ある時点の残高の来歴。合計は残高に一致する', () => {
    const v = s.lineage(`PSEG:${SEG.A_PG1}`, 'ST-09');
    const sum = v.rows.reduce((t, r) => t + r.amount, 0) + v.unattributed;
    expect(sum).toBeCloseTo(v.balance, 4);
    expect(v.rows[0]!.primaryId).toBe('PP-006');
    // ST-03 時点の 1100 は、自身の給与・減価償却と P-100 の外注費からなる
    const at3 = s.lineage('CCTR:1100', 'ST-03');
    expect(Object.fromEntries(at3.rows.map((r) => [r.primaryId, Math.round(r.amount)]))).toEqual({ 'PP-001': 4_000_000, 'PP-003': 3_000_000, 'PP-002': 1_000_000 });
  });
});

describe('入出力（F9-01、F2-02）', () => {
  it('F9-01 JSON を書き出して読み込むと同じプロジェクトに戻る', () => {
    const p = sampleProject();
    const r = parseProjectJson(serializeProject(p));
    expect(r.ok && r.value).toEqual(p);
  });

  it('F9-01 形式の誤り・未対応の schemaVersion は理由つきで読まない', () => {
    expect(parseProjectJson('{')).toMatchObject({ ok: false });
    expect(parseProjectJson('{"schemaVersion":2}')).toMatchObject({ ok: false, errors: [expect.stringContaining('schemaVersion')] });
    const broken = sampleProject() as unknown as { primaryPostings: { amount: unknown }[] };
    broken.primaryPostings[0]!.amount = 1.5;
    const r = parseProjectJson(JSON.stringify(broken));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toContain('primaryPostings.0.amount');
  });

  it('F2-02 一次仕訳を CSV に書き出して取り込むと同じになる（セグメントの | や引用符を含む）', () => {
    const p = sampleProject();
    p.primaryPostings[0]!.text = '給与, "10月"';
    const back = postingsFromCsv(postingsToCsv(p.primaryPostings));
    expect(back.errors).toEqual([]);
    expect(back.postings).toEqual(p.primaryPostings);
  });

  it('F2-02 CSV の誤りは行番号つきで返し、正しい行だけ取り込む。桁区切りと英語の見出しも読める', () => {
    const csv = ['id,account,objType,objId,amount,text', 'A1,61000000,CCTR,1000,"1,000",ok', 'A2,61000000,CCTR,1000,12.5,', 'A1,61000000,cctr,1000,5,dup', ',61000000,XXX,1000,5,'].join('\n');
    const r = postingsFromCsv(csv);
    expect(r.postings).toEqual([{ id: 'A1', account: '61000000', obj: { type: 'CCTR', id: '1000' }, amount: 1000, text: 'ok' }]);
    expect(r.errors.map((e) => e.row)).toEqual([3, 4, 5]);
  });

  it('F2-02 必須の列がなければ見出しの誤りとして返す', () => {
    expect(postingsFromCsv('勘定,金額\n61000000,5').errors[0]!.message).toContain('対象種類');
  });
});

describe('参照の付け替え（マスタの表編集）', () => {
  it('原価センタの識別子を付け替えると、一次仕訳・ルール・統計KF・グループの参照も付け替わり、結果は変わらない', () => {
    const p = sampleProject();
    const before = runAll(p, 'S-DEFAULT');
    renameReference(p, 'CCTR', '1100', '1150');
    expect(findReferences(p, 'CCTR', '1100')).toEqual([]);
    expect(findReferences(p, 'CCTR', '1150').length).toBeGreaterThan(5);
    const after = runAll(p, 'S-DEFAULT');
    expect(after.issues.filter((i) => i.severity === 'ERROR')).toEqual([]);
    expect(after.ledger.map((l) => l.amount)).toEqual(before.ledger.map((l) => l.amount));
  });

  it('利益センタを付け替えると、それを特性に持つセグメントの識別子も付け替わる', () => {
    const p = sampleProject();
    renameReference(p, 'PCTR', 'PC20', 'PC25');
    const newKey = segmentKey({ customer: 'A', productGroup: 'PG1', profitCenter: 'PC25' });
    expect(p.master.segments.map((s) => s.id)).toContain(newKey);
    expect(p.primaryPostings.find((x) => x.id === 'PP-006')!.obj.id).toBe(newKey);
    const r = runAll(p, 'S-DEFAULT');
    expect(r.issues.filter((i) => i.severity === 'ERROR')).toEqual([]);
  });

  it('使われている場所を返す（行を消す前の確認）', () => {
    expect(findReferences(sampleProject(), 'ACCOUNT', '94100000')).toEqual(expect.arrayContaining([expect.stringContaining('サイクル CY-ASSESS')]));
  });
});

import { sampleProject, settingsTables } from '@alloc-sim/engine';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { tablesToXlsx } from '../src/lib/xlsx';

describe('設定一覧の Excel（F9-03）', () => {
  it('表ごとにシートを作り、見出しを太字で固定し、値をそのまま入れる', async () => {
    const buf = await tablesToXlsx(settingsTables(sampleProject(), 'S-DEFAULT'));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['締めステップ', 'サイクル', '決済規則', '直接活動配分', '原価計算シート', 'TDD']);
    const ws = wb.getWorksheet('決済規則')!;
    expect(ws.getRow(1).font?.bold).toBe(true);
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(ws.getRow(2).values).toEqual([undefined, 'SR-P100', 'P-100', '社内システム刷新', '間接費プロジェクト', 'SP-OH', '原価センタ', '1100', '%', 100, 'FUL', 202604, '', '3. 決済①：間接費プロジェクト→原価センタ']);
    expect(wb.getWorksheet('サイクル')!.rowCount).toBe(5);
  });
});

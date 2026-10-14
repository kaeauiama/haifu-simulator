/**
 * 表を Excel ブック（xlsx）にする。ExcelJS は大きいので、呼ばれたときに読み込む。
 */
import type { SettingsTable } from '@alloc-sim/engine';

export async function tablesToXlsx(tables: readonly SettingsTable[]): Promise<ArrayBuffer> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  for (const t of tables) {
    const ws = wb.addWorksheet(t.name, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.addRow(t.header).font = { bold: true };
    for (const r of t.rows) ws.addRow(r);
    // 列の幅は、見出しと値の長さから決める（全角はおよそ2文字分）
    t.header.forEach((h, i) => {
      const len = Math.max(h.length * 2, ...t.rows.map((r) => String(r[i] ?? '').length * 1.6));
      ws.getColumn(i + 1).width = Math.min(60, Math.max(8, Math.ceil(len)));
    });
  }
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

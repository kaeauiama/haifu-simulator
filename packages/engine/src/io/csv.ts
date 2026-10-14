/**
 * 一次仕訳の CSV 取り込み・書き出し（F2-02）。
 * 列：仕訳ID, 勘定, 対象種類, 対象ID, 金額, テキスト（英語の見出し id, account, objType, objId, amount, text も読める）。
 * 金額は借方+、貸方−。桁区切りのカンマは読める。書き出しは Excel で開けるよう BOM 付き UTF-8・CRLF。
 */
import { PrimaryPostingSchema } from '../model/schema.ts';
import type { PrimaryPosting } from '../model/types.ts';

export const POSTING_CSV_HEADER = ['仕訳ID', '勘定', '対象種類', '対象ID', '金額', 'テキスト'] as const;

const ALIASES: Record<string, keyof PrimaryPosting | 'objType' | 'objId'> = {
  仕訳id: 'id',
  id: 'id',
  勘定: 'account',
  account: 'account',
  対象種類: 'objType',
  objtype: 'objType',
  対象id: 'objId',
  objid: 'objId',
  金額: 'amount',
  amount: 'amount',
  テキスト: 'text',
  text: 'text',
};

/** RFC 4180 相当の CSV を行×列に分ける（引用符、引用符内の改行・カンマ、"" のエスケープ） */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const escapeCell = (v: string): string => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function toCsv(rows: readonly (readonly string[])[]): string {
  return `﻿${rows.map((r) => r.map(escapeCell).join(',')).join('\r\n')}\r\n`;
}

export function postingsToCsv(postings: readonly PrimaryPosting[]): string {
  return toCsv([
    [...POSTING_CSV_HEADER],
    ...postings.map((p) => [p.id, p.account, p.obj.type, p.obj.id, String(p.amount), p.text ?? '']),
  ]);
}

export interface CsvError {
  /** 1始まりの行番号（見出し行を1行目とする） */
  row: number;
  message: string;
}

export function postingsFromCsv(text: string): { postings: PrimaryPosting[]; errors: CsvError[] } {
  const rows = parseCsv(text);
  const errors: CsvError[] = [];
  if (!rows.length) return { postings: [], errors: [{ row: 1, message: 'CSVが空です' }] };
  const header = rows[0]!.map((h) => ALIASES[h.trim().toLowerCase()]);
  const required = { account: '勘定', objType: '対象種類', objId: '対象ID', amount: '金額' } as const;
  for (const [key, label] of Object.entries(required)) {
    if (!header.includes(key as never)) errors.push({ row: 1, message: `見出しに「${label}」の列がありません` });
  }
  if (errors.length) return { postings: [], errors };

  const postings: PrimaryPosting[] = [];
  const seen = new Set<string>();
  rows.slice(1).forEach((cells, i) => {
    const rowNo = i + 2;
    const get = (k: string) => {
      const idx = header.indexOf(k as never);
      return idx >= 0 ? (cells[idx] ?? '').trim() : '';
    };
    const amountText = get('amount').replace(/[,\s]/g, '').replace(/^\((.*)\)$/, '-$1');
    const amount = Number(amountText);
    if (amountText === '' || !Number.isInteger(amount)) {
      errors.push({ row: rowNo, message: `金額「${get('amount')}」は円の整数ではありません` });
      return;
    }
    const candidate = {
      id: get('id') || `CSV-${String(rowNo - 1).padStart(5, '0')}`,
      account: get('account'),
      obj: { type: get('objType').toUpperCase(), id: get('objId') },
      amount,
      ...(get('text') ? { text: get('text') } : {}),
    };
    const r = PrimaryPostingSchema.safeParse(candidate);
    if (!r.success) {
      errors.push({ row: rowNo, message: r.error.issues.map((e) => `${e.path.join('.')}：${e.message}`).join('、') });
      return;
    }
    if (seen.has(r.data.id)) {
      errors.push({ row: rowNo, message: `仕訳ID「${r.data.id}」が重複しています` });
      return;
    }
    seen.add(r.data.id);
    postings.push(r.data);
  });
  return { postings, errors };
}

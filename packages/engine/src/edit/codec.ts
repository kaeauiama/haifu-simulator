/**
 * 表のセルで入れ子の値を編集するための、テキスト表記との相互変換。
 *   勘定範囲：   "41000000-49999999, 68000000"
 *   決済構造：   "41000000-49999999:KEEP; 50000000-99999999:94900000"
 *   ID の一覧：  "1000, 1100"
 */
import type { AccountSelector, SettlementProfile } from '../model/types.ts';

export type Decoded<T> = { ok: true; value: T } | { ok: false; error: string };

export function formatAccountRanges(sel: AccountSelector): string {
  return sel.map((r) => (r.from === r.to ? r.from : `${r.from}-${r.to}`)).join(', ');
}

export function parseAccountRanges(text: string): Decoded<AccountSelector> {
  const parts = text
    .split(/[,、\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: AccountSelector = [];
  for (const p of parts) {
    const m = /^([^\-~～]+)(?:\s*[-~～]\s*([^\-~～]+))?$/.exec(p);
    if (!m) return { ok: false, error: `勘定範囲「${p}」を読めません（例：41000000-49999999）` };
    out.push({ from: m[1]!, to: m[2] ?? m[1]! });
  }
  return { ok: true, value: out };
}

export function formatStructure(structure: SettlementProfile['structure']): string {
  return structure.map((r) => `${formatAccountRanges(r.accounts)}:${r.settleAccount}`).join('; ');
}

export function parseStructure(text: string): Decoded<SettlementProfile['structure']> {
  const rows = text
    .split(/[;；\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: SettlementProfile['structure'] = [];
  for (const row of rows) {
    const i = row.lastIndexOf(':') >= 0 ? row.lastIndexOf(':') : row.lastIndexOf('：');
    if (i < 0) return { ok: false, error: `決済構造「${row}」に「:決済先」がありません（例：50000000-99999999:94900000）` };
    const ranges = parseAccountRanges(row.slice(0, i));
    if (!ranges.ok) return ranges;
    const settleAccount = row.slice(i + 1).trim();
    if (!settleAccount) return { ok: false, error: `決済構造「${row}」の決済先が空です` };
    out.push({ accounts: ranges.value, settleAccount: settleAccount.toUpperCase() === 'KEEP' ? 'KEEP' : settleAccount });
  }
  return { ok: true, value: out };
}

export const formatIdList = (ids: readonly string[]): string => ids.join(', ');

export const parseIdList = (text: string): string[] =>
  text
    .split(/[,、\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

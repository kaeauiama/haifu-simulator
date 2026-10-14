import { CHAR_KEYS } from './schema.ts';
import type { CharKey, ObjRef, ObjType, SegmentChars } from './types.ts';

// ---------- ObjRef ----------
export const objKey = (ref: ObjRef): string => `${ref.type}:${ref.id}`;

export function parseObjKey(key: string): ObjRef {
  const i = key.indexOf(':');
  return { type: key.slice(0, i) as ObjType, id: key.slice(i + 1) };
}

export const sameObj = (a: ObjRef, b: ObjRef): boolean => a.type === b.type && a.id === b.id;

/**
 * 識別子の比較。数字だけの識別子同士は数値として比べる（"900" < "1000"）。
 * 範囲選択と、端数の同順位を決める並び（5.4）の両方で使う。
 */
export function compareId(a: string, b: string): number {
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
    const x = a.replace(/^0+(?=\d)/, '');
    const y = b.replace(/^0+(?=\d)/, '');
    if (x.length !== y.length) return x.length - y.length;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

export const compareObj = (a: ObjRef, b: ObjRef): number =>
  a.type !== b.type ? (a.type < b.type ? -1 : 1) : compareId(a.id, b.id);

export const inRange = (id: string, from: string, to: string): boolean =>
  compareId(from, id) <= 0 && compareId(id, to) <= 0;

// ---------- 収益性セグメント ----------
/** 未設定の特性値 */
export const UNASSIGNED = '*';
export const SEGMENT_SEPARATOR = '|';

/** 特性値を CHAR_KEYS の順に連結した識別子（D-005）。未設定は '*' */
export const segmentKey = (chars: SegmentChars): string =>
  CHAR_KEYS.map((k) => chars[k] ?? UNASSIGNED).join(SEGMENT_SEPARATOR);

export function parseSegmentKey(id: string): SegmentChars {
  const parts = id.split(SEGMENT_SEPARATOR);
  const chars: SegmentChars = {};
  CHAR_KEYS.forEach((k, i) => {
    const v = parts[i];
    if (v !== undefined && v !== '' && v !== UNASSIGNED) chars[k] = v;
  });
  return chars;
}

export const isSegmentKey = (id: string): boolean => id.split(SEGMENT_SEPARATOR).length === CHAR_KEYS.length;

/** FILTER の判定。キー省略は何でもよい、'*' は未設定であること（D-006） */
export function matchesCharFilter(chars: SegmentChars, filter: Partial<Record<CharKey, string>>): boolean {
  for (const k of CHAR_KEYS) {
    const f = filter[k];
    if (f === undefined) continue;
    const v = chars[k];
    if (f === UNASSIGNED ? v !== undefined : v !== f) return false;
  }
  return true;
}

import { compareObj, inRange, matchesCharFilter, objKey, parseObjKey, parseSegmentKey } from '../model/keys.ts';
import type { AccountSelector, ObjRef, ObjSelector } from '../model/types.ts';
import type { ReadonlyBalanceIndex } from './balance.ts';
import type { MasterIndex } from './masterIndex.ts';

/** 勘定が選択条件に入るか。空の選択条件は何も選ばない */
export const matchAccount = (sel: AccountSelector, account: string): boolean =>
  sel.some((r) => inRange(account, r.from, r.to));

export const accountPred =
  (sel: AccountSelector) =>
  (account: string): boolean =>
    matchAccount(sel, account);

/** 種類ごとの候補。セグメントはマスタに加えて、台帳に残高がある組み合わせも候補にする */
function candidates(type: ObjRef['type'], mi: MasterIndex, balances?: ReadonlyBalanceIndex): string[] {
  switch (type) {
    case 'CCTR':
      return [...mi.costCenters.keys()];
    case 'WBS':
      return [...mi.wbs.keys()];
    case 'PCTR':
      return [...mi.profitCenters.keys()];
    case 'ORD':
      return [];
    case 'PSEG': {
      const ids = new Set(mi.segments.keys());
      if (balances) {
        for (const k of balances.objectKeys()) if (k.startsWith('PSEG:')) ids.add(parseObjKey(k).id);
      }
      return [...ids];
    }
  }
}

/** 選択条件を対象の一覧に展開する。結果は重複なしで、種類→識別子の昇順 */
export function selectObjects(sel: ObjSelector, mi: MasterIndex, balances?: ReadonlyBalanceIndex): ObjRef[] {
  let ids: string[];
  switch (sel.mode) {
    case 'LIST':
      ids = sel.ids;
      break;
    case 'RANGE':
      ids = candidates(sel.type, mi, balances).filter((id) => inRange(id, sel.from, sel.to));
      break;
    case 'GROUP':
      ids = mi.groups.get(sel.groupId)?.members ?? [];
      break;
    case 'FILTER':
      ids = candidates('PSEG', mi, balances).filter((id) => matchesCharFilter(parseSegmentKey(id), sel.chars));
      break;
  }
  const seen = new Map<string, ObjRef>();
  for (const id of ids) {
    const ref: ObjRef = { type: sel.type, id };
    seen.set(objKey(ref), ref);
  }
  return [...seen.values()].sort(compareObj);
}

/** 利益センタ → その利益センタに導出される対象のキー（利益センタ間の配布・配賦、P-23） */
export function profitCenterKeys(balances: ReadonlyBalanceIndex, mi: MasterIndex): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const k of balances.objectKeys()) {
    const pc = mi.derivePC(parseObjKey(k));
    if (!pc) continue;
    const list = out.get(pc);
    if (list) list.push(k);
    else out.set(pc, [k]);
  }
  return out;
}

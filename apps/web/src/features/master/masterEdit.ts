/**
 * マスタの表編集の共通処理：識別子の付け替え（参照ごと）、参照を確かめてからの削除、選択肢。
 */
import { findReferences, renameReference, segmentLabel, type Project, type RefKind } from '@alloc-sim/engine';
import { confirmDialog } from '@/components/dialogs';
import type { Option } from '@/components/cells';
import { ja } from '@/i18n/ja';
import { useProjectStore } from '@/store/project';

export const project = (): Project => useProjectStore.getState().project;
export const edit = (recipe: (p: Project) => void): void => useProjectStore.getState().edit(recipe);

/** 識別子の付け替え。空・重複は誤りとして返す */
export function renameCommit(kind: RefKind, ids: () => string[], current: string) {
  return (next: string): string | void => {
    if (!next) return ja.table.emptyId;
    if (next === current) return;
    if (ids().includes(next)) return ja.table.duplicateId(next);
    edit((p) => renameReference(p, kind, current, next));
  };
}

/** 使われていれば確認してから削除する */
export async function deleteChecked(kind: RefKind, id: string, remove: (p: Project) => void): Promise<void> {
  const refs = findReferences(project(), kind, id);
  if (refs.length && !(await confirmDialog(ja.table.confirmDeleteUsed(refs.length), refs.slice(0, 15)))) return;
  edit(remove);
}

/** 数字だけの識別子なら最大＋1、そうでなければ prefix＋連番 */
export function newId(existing: string[], prefix: string): string {
  const nums = existing.filter((x) => /^\d+$/.test(x));
  if (nums.length && nums.length === existing.length) {
    const max = nums.reduce((m, x) => (BigInt(x) > m ? BigInt(x) : m), 0n);
    return (max + 1n).toString().padStart(nums[0]!.length, '0');
  }
  const used = new Set(existing);
  for (let n = 1; ; n++) {
    const id = `${prefix}${n}`;
    if (!used.has(id)) return id;
  }
}

export const opts = {
  profitCenters: (p: Project): Option[] => p.master.profitCenters.map((x) => ({ value: x.id, label: `${x.id} ${x.name}` })),
  costCenters: (p: Project): Option[] => p.master.costCenters.map((x) => ({ value: x.id, label: `${x.id} ${x.name}` })),
  wbs: (p: Project): Option[] => p.master.wbs.map((x) => ({ value: x.id, label: `${x.id} ${x.name}` })),
  segments: (p: Project): Option[] => p.master.segments.map((x) => ({ value: x.id, label: x.name || segmentLabel(x.id) })),
  accounts: (p: Project, categories?: string[]): Option[] =>
    p.master.accounts.filter((a) => !categories || categories.includes(a.category)).map((a) => ({ value: a.id, label: `${a.id} ${a.name}` })),
  groups: (p: Project, type: string): Option[] => p.master.groups.filter((g) => g.type === type).map((g) => ({ value: g.id, label: `${g.id} ${g.name}` })),
  profiles: (p: Project): Option[] => p.master.settlementProfiles.map((x) => ({ value: x.id, label: x.id })),
  skfs: (p: Project): Option[] => p.master.skfs.map((x) => ({ value: x.id, label: `${x.id} ${x.name}` })),
  activityTypes: (p: Project): Option[] => p.master.activityTypes.map((x) => ({ value: x.id, label: `${x.id} ${x.name}` })),
  /** 種類ごとの対象 */
  objects: (p: Project, type: string): Option[] =>
    type === 'CCTR' ? opts.costCenters(p) : type === 'WBS' ? opts.wbs(p) : type === 'PSEG' ? opts.segments(p) : type === 'PCTR' ? opts.profitCenters(p) : [],
  enumOf: <K extends string>(labels: Record<K, string>): Option[] => Object.entries(labels).map(([value, label]) => ({ value, label: label as string })),
};

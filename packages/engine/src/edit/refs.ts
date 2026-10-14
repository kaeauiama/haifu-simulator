/**
 * マスタの識別子の参照を辿る。表で識別子を書き換えたときに参照ごと付け替え（rename）、
 * 行を消す前に使われている場所を示す（findReferences）。
 * 関数は渡されたプロジェクトをその場で書き換える（画面の Immer の下書きに対して呼ぶ）。
 */
import { segmentKey } from '../model/keys.ts';
import type { ObjRef, ObjSelector, Project } from '../model/types.ts';

/** 参照される対象の種類。勘定も含める */
export type RefKind = ObjRef['type'] | 'ACCOUNT' | 'GROUP' | 'SKF' | 'ACTIVITY' | 'PROFILE';

interface RefSlot {
  kind: RefKind;
  id: string;
  /** 参照している場所（画面に出す） */
  where: string;
  set(id: string): void;
}

function* objSlot(o: ObjRef, where: string): Generator<RefSlot> {
  yield { kind: o.type, id: o.id, where, set: (id) => (o.id = id) };
}

function* selectorSlots(sel: ObjSelector, where: string): Generator<RefSlot> {
  if (sel.mode === 'LIST') {
    for (let i = 0; i < sel.ids.length; i++) yield { kind: sel.type, id: sel.ids[i]!, where, set: (id) => (sel.ids[i] = id) };
  } else if (sel.mode === 'GROUP') {
    yield { kind: 'GROUP', id: sel.groupId, where, set: (id) => (sel.groupId = id) };
  }
}

/** プロジェクト内の参照をすべて列挙する（マスタの主キーそのものは含めない） */
export function* referenceSlots(p: Project): Generator<RefSlot> {
  const m = p.master;
  for (const c of m.costCenters) {
    yield { kind: 'PCTR', id: c.profitCenter, where: `原価センタ ${c.id}`, set: (id) => (c.profitCenter = id) };
    if (c.groupId) yield { kind: 'GROUP', id: c.groupId, where: `原価センタ ${c.id}`, set: (id) => (c.groupId = id) };
  }
  for (const pc of m.profitCenters) if (pc.groupId) yield { kind: 'GROUP', id: pc.groupId, where: `利益センタ ${pc.id}`, set: (id) => (pc.groupId = id) };
  for (const w of m.wbs) {
    const where = `WBS ${w.id}`;
    yield { kind: 'CCTR', id: w.responsibleCctr, where, set: (id) => (w.responsibleCctr = id) };
    yield { kind: 'PCTR', id: w.profitCenter, where, set: (id) => (w.profitCenter = id) };
    if (w.attributedSegment) yield { kind: 'PSEG', id: w.attributedSegment, where, set: (id) => (w.attributedSegment = id) };
    if (w.settlementProfileId) yield { kind: 'PROFILE', id: w.settlementProfileId, where, set: (id) => (w.settlementProfileId = id) };
  }
  for (const a of m.activityTypes) {
    const where = `活動タイプ ${a.id}`;
    yield { kind: 'ACCOUNT', id: a.allocAccount, where, set: (id) => (a.allocAccount = id) };
    for (const r of a.rates) yield { kind: 'CCTR', id: r.cctr, where, set: (id) => (r.cctr = id) };
  }
  for (const s of m.skfs) for (const v of s.values) yield* objSlot(v.obj, `統計KF ${s.id}`);
  for (const pr of m.settlementProfiles) {
    for (const row of pr.structure) {
      if (row.settleAccount !== 'KEEP') yield { kind: 'ACCOUNT', id: row.settleAccount, where: `決済プロファイル ${pr.id}`, set: (id) => (row.settleAccount = id) };
    }
  }
  for (const g of m.groups) {
    for (let i = 0; i < g.members.length; i++) yield { kind: g.type, id: g.members[i]!, where: `グループ ${g.id}`, set: (id) => (g.members[i] = id) };
  }
  for (const pp of p.primaryPostings) {
    const where = `一次仕訳 ${pp.id}`;
    yield { kind: 'ACCOUNT', id: pp.account, where, set: (id) => (pp.account = id) };
    yield* objSlot(pp.obj, where);
  }
  for (const sc of p.scenarios) {
    const at = (s: string) => `シナリオ「${sc.name}」の${s}`;
    for (const c of sc.cycles) {
      for (const seg of c.segments) {
        const where = at(`サイクル ${c.id}／${seg.id}`);
        yield* selectorSlots(seg.sender.objects, where);
        yield* selectorSlots(seg.receiver.objects, where);
        const f = seg.receiver.factor;
        if (f.kind === 'FIXED_PERCENT' || f.kind === 'FIXED_PORTION') for (const w of f.weights) yield* objSlot(w.obj, where);
        if (f.kind === 'SKF') yield { kind: 'SKF', id: f.skfId, where, set: (id) => (f.skfId = id) };
        if (seg.allocAccount) yield { kind: 'ACCOUNT', id: seg.allocAccount, where, set: (id) => (seg.allocAccount = id) };
      }
    }
    for (const r of sc.tddRules) yield* selectorSlots(r.sender.segments, at(`TDDルール ${r.id}`));
    for (const r of sc.settlementRules) {
      const where = at(`決済規則 ${r.id}`);
      yield* objSlot(r.sender, where);
      for (const d of r.rules) yield* objSlot(d.receiver, where);
    }
    for (const a of sc.activityAllocs) {
      const where = at(`活動配分 ${a.id}`);
      yield { kind: 'CCTR', id: a.senderCctr, where, set: (id) => (a.senderCctr = id) };
      yield { kind: 'ACTIVITY', id: a.activityType, where, set: (id) => (a.activityType = id) };
      yield* objSlot(a.receiver, where);
    }
    for (const cs of sc.costingSheets) {
      const where = at(`原価計算シート ${cs.id}`);
      for (const t of cs.targets) yield* objSlot(t, where);
      for (const row of cs.rows) {
        yield { kind: 'CCTR', id: row.creditCctr, where, set: (id) => (row.creditCctr = id) };
        yield { kind: 'ACCOUNT', id: row.overheadAccount, where, set: (id) => (row.overheadAccount = id) };
      }
    }
  }
}

/** 対象が使われている場所の一覧（重複なし） */
export function findReferences(p: Project, kind: RefKind, id: string): string[] {
  const out = new Set<string>();
  for (const s of referenceSlots(p)) if (s.kind === kind && s.id === id) out.add(s.where);
  return [...out];
}

/**
 * 識別子を付け替え、参照もすべて書き換える。主キーの書き換えも行う。
 * 利益センタを付け替えると、その利益センタを特性に持つセグメントの識別子も付け替える（D-005）。
 */
export function renameReference(p: Project, kind: RefKind, from: string, to: string): void {
  if (from === to) return;
  const m = p.master;
  const keyTables: Partial<Record<RefKind, { id: string }[]>> = {
    CCTR: m.costCenters,
    WBS: m.wbs,
    PCTR: m.profitCenters,
    PSEG: m.segments,
    ACCOUNT: m.accounts,
    GROUP: m.groups,
    SKF: m.skfs,
    ACTIVITY: m.activityTypes,
    PROFILE: m.settlementProfiles,
  };
  for (const row of keyTables[kind] ?? []) if (row.id === from) row.id = to;
  for (const s of [...referenceSlots(p)]) if (s.kind === kind && s.id === from) s.set(to);

  if (kind === 'PCTR') {
    for (const seg of m.segments) {
      if (seg.chars.profitCenter !== from) continue;
      seg.chars.profitCenter = to;
      const oldId = seg.id;
      const newId = segmentKey(seg.chars);
      if (oldId !== newId) renameReference(p, 'PSEG', oldId, newId);
    }
  }
}

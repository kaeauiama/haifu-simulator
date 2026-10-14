/**
 * 実行前の検証（F6-01）。マスタとシナリオの定義だけを見て判定できる規則。
 * ERROR になったルールは、実行時に仕訳を作らない（blockedRuleIds）。
 */
import type { MasterIndex } from '../ledger/masterIndex.ts';
import { selectObjects } from '../ledger/select.ts';
import { matchAccount } from '../ledger/select.ts';
import { compareObj, objKey, segmentKey } from '../model/keys.ts';
import type { AccountSelector, Issue, ObjRef, ObjSelector, ObjType, Project, Scenario, StepKind } from '../model/types.ts';
import { mkIssue, type IssueCode, type IssueContext } from './issues.ts';

const CCTR_CONTEXT_RECEIVERS: ObjType[] = ['CCTR', 'PCTR', 'WBS'];

export function validateStatic(project: Project, scenario: Scenario, mi: MasterIndex): Issue[] {
  const issues: Issue[] = [];
  const add = (code: IssueCode, detail: string, ctx: IssueContext = {}) => issues.push(mkIssue(code, 'PRE', detail, ctx));

  const checkRef = (obj: ObjRef, ctx: IssueContext) => {
    if (obj.type === 'ORD') add('X-UNSUPPORTED', `指図 ${obj.id}（MVPではWBSで代用）`, ctx);
    else if (!mi.exists(obj)) add('X-REF', `${obj.type} ${obj.id}`, ctx);
  };
  const checkAccount = (id: string, ctx: IssueContext) => {
    if (!mi.accounts.has(id)) add('X-REF', `勘定 ${id}`, ctx);
  };
  const checkAccountSel = (sel: AccountSelector, where: string, ctx: IssueContext) => {
    if (!sel.length) add('X-EMPTY-ACCOUNTS', where, ctx);
  };
  const checkSelectorRefs = (sel: ObjSelector, ctx: IssueContext) => {
    if (sel.mode === 'LIST') for (const id of sel.ids) checkRef({ type: sel.type, id }, ctx);
    if (sel.mode === 'GROUP' && !mi.groups.has(sel.groupId)) add('X-REF', `グループ ${sel.groupId}`, ctx);
  };
  const checkStatistical = (objs: ObjRef[], role: string, ctx: IssueContext) => {
    for (const o of objs) if (mi.isStatisticalWbs(o)) add('V-03', `${mi.label(o)}（${role}）`, { ...ctx, obj: o });
  };

  // ---------- マスタ・実績 ----------
  for (const s of mi.master.segments) {
    if (s.id !== segmentKey(s.chars)) add('X-SEG-ID', `${s.id}（特性値からは ${segmentKey(s.chars)}）`);
  }
  for (const w of mi.master.wbs) {
    if (w.projectType === 'CUSTOMER' && w.attributedSegment === undefined) add('X-REF', `${mi.label({ type: 'WBS', id: w.id })} の属性セグメント`);
  }
  dupIds(project.primaryPostings, '一次仕訳', add);
  for (const p of project.primaryPostings) {
    checkAccount(p.account, { ruleId: p.id });
    checkRef(p.obj, { ruleId: p.id });
  }

  // ---------- Universal Allocation ----------
  dupIds(scenario.cycles, 'サイクル', add);
  for (const c of scenario.cycles) {
    const ctx = { ruleId: c.id };
    const senderKeys = new Set<string>();
    for (const seg of c.segments) {
      const where = `${c.name}／${seg.name}`;
      checkAccountSel(seg.sender.accounts, `${where} の送信勘定`, ctx);
      checkSelectorRefs(seg.sender.objects, ctx);
      checkSelectorRefs(seg.receiver.objects, ctx);
      if (c.type === 'DISTRIBUTION') {
        const sec = mi.master.accounts.filter((a) => a.category.startsWith('SEC') && matchAccount(seg.sender.accounts, a.id));
        if (sec.length) add('V-01', `${where}（${sec.map((a) => a.id).join('、')}）`, ctx);
      } else {
        const cat = seg.allocAccount ? mi.category(seg.allocAccount) : undefined;
        if (cat !== 'SEC42') add('V-02', `${where}（${seg.allocAccount ?? '未設定'}）`, ctx);
      }
      // 送信側は原価センタ（利益センタのコンテキストでは利益センタ）。WBS を送信側にできるかは要確認で、MVPでは不可
      const senderType = c.context === 'PCTR' ? 'PCTR' : 'CCTR';
      if (seg.sender.objects.type === 'WBS') add('X-UNSUPPORTED', `${where}（WBSを配賦の送信側にする：要確認、MVPでは不可）`, ctx);
      else if (seg.sender.objects.type !== senderType) add('X-RECEIVER-TYPE', `${where} の送信側（${seg.sender.objects.type}）`, ctx);

      const allowed = c.context === 'MA' ? ['PSEG'] : c.context === 'PCTR' ? ['PCTR'] : CCTR_CONTEXT_RECEIVERS;
      const f = seg.receiver.factor;
      const receiverTypes =
        f.kind === 'FIXED_PERCENT' || f.kind === 'FIXED_PORTION' ? f.weights.map((w) => w.obj.type) : [seg.receiver.objects.type];
      for (const t of new Set(receiverTypes)) {
        if (!allowed.includes(t)) add('X-RECEIVER-TYPE', `${where} の受信側（${t}）`, ctx);
      }

      const senders = selectObjects(seg.sender.objects, mi);
      checkStatistical(senders, '送信者', ctx);
      let receivers: ObjRef[];
      if (f.kind === 'FIXED_PERCENT' || f.kind === 'FIXED_PORTION') {
        receivers = f.weights.map((w) => w.obj);
        for (const r of receivers) checkRef(r, ctx);
      } else receivers = selectObjects(seg.receiver.objects, mi);
      checkStatistical(receivers, '受信者', ctx);

      if (f.kind === 'FIXED_PERCENT') {
        const sum = f.weights.reduce((s, w) => s + w.pct, 0);
        if (sum > 100 + 1e-9) add('X-PCT-OVER', `${where}（合計 ${sum}%）`, ctx);
        else if (sum < 100 - 1e-9) add('X-PCT-UNDER', `${where}（合計 ${sum}%）`, ctx);
      }
      if (f.kind === 'FIXED_PORTION' && !f.weights.some((w) => w.portion !== 0)) add('V-13', where, ctx);
      if (f.kind === 'SKF') {
        const skf = mi.skfs.get(f.skfId);
        if (!skf) add('X-REF', `統計KF ${f.skfId}`, ctx);
        else {
          const keys = new Set(receivers.map(objKey));
          const sum = skf.values.filter((v) => keys.has(objKey(v.obj))).reduce((s, v) => s + v.value, 0);
          if (sum === 0) add('V-13', `${where}（統計KF ${skf.name} の受信側の値がすべて0）`, ctx);
        }
      }
      if (f.kind === 'VARIABLE') checkAccountSel(f.accounts, `${where} の配分基準の勘定`, ctx);
      if (c.type === 'OVERHEAD' && seg.allocAccount) checkAccount(seg.allocAccount, ctx);

      if (c.iterative) {
        for (const s of senders) {
          const k = objKey(s);
          if (senderKeys.has(k)) add('X-ITER-DUP', `${c.name}：${mi.label(s)}`, { ...ctx, obj: s });
          senderKeys.add(k);
        }
      }
    }
  }

  // ---------- TDD ----------
  dupIds(scenario.tddRules, 'TDDルール', add);
  for (const r of scenario.tddRules) {
    const ctx = { ruleId: r.id };
    checkAccountSel(r.sender.accounts, `${r.name} の送信勘定`, ctx);
    checkAccountSel(r.reference.accounts, `${r.name} の参照勘定`, ctx);
    if (r.sender.segments.type !== 'PSEG') add('X-RECEIVER-TYPE', `${r.name} の送信側（${r.sender.segments.type}）`, ctx);
    for (const s of selectObjects(r.sender.segments, mi)) {
      if (mi.attributedSegments.has(s.id)) add('V-09', `${r.name}：${mi.label(s)}`, { ...ctx, obj: s });
    }
  }

  // ---------- 決済 ----------
  dupIds(scenario.settlementRules, '決済規則', add);
  const period = mi.master.period;
  for (const r of scenario.settlementRules) {
    const ctx = { ruleId: r.id, obj: r.sender };
    if (r.sender.type !== 'WBS') {
      add('X-UNSUPPORTED', `${mi.label(r.sender)}（MVPの決済の送信者はWBSだけ）`, ctx);
      continue;
    }
    const wbs = mi.wbs.get(r.sender.id);
    if (!wbs) {
      add('X-REF', `WBS ${r.sender.id}`, ctx);
      continue;
    }
    if (wbs.statistical) add('V-03', `${mi.label(r.sender)}（決済の送信者）`, ctx);
    if (wbs.projectType === 'CUSTOMER') add('V-14', mi.label(r.sender), ctx);
    const profile = wbs.settlementProfileId ? mi.profiles.get(wbs.settlementProfileId) : undefined;
    if (!profile) add('X-NO-PROFILE', mi.label(r.sender), ctx);
    for (const d of r.rules) {
      checkRef(d.receiver, ctx);
      if (profile && !profile.allowed.includes(d.receiver.type)) {
        add('V-04', `${mi.label(r.sender)} → ${mi.label(d.receiver)}（決済プロファイル ${profile.id}）`, ctx);
      }
      if (mi.isStatisticalWbs(d.receiver)) add('V-03', `${mi.label(d.receiver)}（決済の受信者）`, ctx);
    }
    const active = r.rules.filter((d) => d.validFrom <= period && (d.validTo === undefined || period <= d.validTo));
    const pct = active.filter((d) => d.basis === 'PCT').reduce((s, d) => s + d.value, 0);
    if (pct > 100 + 1e-9) add('V-05', `${mi.label(r.sender)}（合計 ${pct}%）`, ctx);
    else if (active.length && pct < 100 - 1e-9 && !active.some((d) => d.basis === 'EQUIV')) {
      add('V-06', `${mi.label(r.sender)}（合計 ${pct}%）`, ctx);
    }
  }
  for (const k of settlementCycleMembers(scenario)) {
    const r = scenario.settlementRules.find((x) => objKey(x.sender) === k)!;
    add('V-07', mi.label(r.sender), { ruleId: r.id, obj: r.sender });
  }
  const settledIn = new Map<string, string[]>();
  for (const st of scenario.steps) {
    if (!st.enabled || st.kind !== 'SETTLEMENT') continue;
    const senders = new Set(st.itemIds.flatMap((id) => scenario.settlementRules.filter((r) => r.id === id).map((r) => objKey(r.sender))));
    for (const k of senders) settledIn.set(k, [...(settledIn.get(k) ?? []), st.name]);
  }
  for (const [k, steps] of settledIn) {
    if (steps.length < 2) continue;
    const r = scenario.settlementRules.find((x) => objKey(x.sender) === k)!;
    add('V-08', `${mi.label(r.sender)}（${steps.join('、')}）`, { ruleId: r.id, obj: r.sender });
  }

  // ---------- 活動配分・間接費 ----------
  dupIds(scenario.activityAllocs, '活動配分', add);
  for (const a of scenario.activityAllocs) {
    const ctx = { ruleId: a.id };
    checkRef({ type: 'CCTR', id: a.senderCctr }, ctx);
    checkRef(a.receiver, ctx);
    if (!['CCTR', 'WBS', 'ORD'].includes(a.receiver.type)) add('X-RECEIVER-TYPE', `活動配分 ${a.id} の受信側（${a.receiver.type}）`, ctx);
    checkStatistical([a.receiver], '活動配分の受信者', ctx);
    const at = mi.activityTypes.get(a.activityType);
    if (!at) add('X-REF', `活動タイプ ${a.activityType}`, ctx);
    else if (!at.rates.some((r) => r.cctr === a.senderCctr)) add('X-NO-RATE', `${at.id} × 原価センタ ${a.senderCctr}`, ctx);
  }
  dupIds(scenario.costingSheets, '原価計算シート', add);
  for (const cs of scenario.costingSheets) {
    const ctx = { ruleId: cs.id };
    for (const t of cs.targets) {
      checkRef(t, ctx);
      if (t.type !== 'WBS' && t.type !== 'ORD') add('X-RECEIVER-TYPE', `原価計算シート ${cs.id} の対象（${t.type}）`, ctx);
    }
    checkStatistical(cs.targets, '間接費計算の対象', ctx);
    cs.rows.forEach((row, i) => {
      checkRef({ type: 'CCTR', id: row.creditCctr }, ctx);
      checkAccount(row.overheadAccount, ctx);
      checkAccountSel(row.base, `原価計算シート ${cs.id} の${i + 1}行目のベース勘定`, ctx);
    });
  }

  // ルールの識別子は種類をまたいでも重ねない（仕訳の origin.ruleId からルールを引くため）
  const kinds = new Map<string, number>();
  for (const xs of [scenario.cycles, scenario.tddRules, scenario.settlementRules, scenario.activityAllocs, scenario.costingSheets]) {
    for (const id of new Set(xs.map((x) => x.id))) kinds.set(id, (kinds.get(id) ?? 0) + 1);
  }
  for (const [id, n] of kinds) if (n > 1) add('X-DUP-ID', `ルール ${id}（種類の違うルールで同じ識別子）`, { ruleId: id });

  // ---------- 締めステップ ----------
  dupIds(scenario.steps, '締めステップ', add);
  const collections: Record<StepKind, readonly { id: string }[] | null> = {
    ALLOC_CYCLE: scenario.cycles,
    TDD: scenario.tddRules,
    SETTLEMENT: scenario.settlementRules,
    ACTIVITY_ALLOC: scenario.activityAllocs,
    OVERHEAD_CALC: scenario.costingSheets,
    ACTUAL_RATE_REVAL: mi.master.activityTypes,
    MANUAL_REPOST: null,
  };
  for (const st of scenario.steps) {
    const coll = collections[st.kind];
    if (!coll) {
      if (st.enabled) add('X-UNSUPPORTED', `${st.name}（手動の振替はMVP外）`, { stepId: st.id });
      continue;
    }
    for (const id of st.itemIds) if (!coll.some((x) => x.id === id)) add('X-REF', `${st.name} の ${id}`, { stepId: st.id });
  }
  return issues;
}

/** 実行前検証で ERROR になったルール。実行時に仕訳を作らない */
export const blockedRuleIds = (issues: readonly Issue[]): Set<string> =>
  new Set(issues.filter((i) => i.severity === 'ERROR' && i.ruleId !== undefined).map((i) => i.ruleId!));

function dupIds(xs: readonly { id: string }[], what: string, add: (code: IssueCode, detail: string, ctx?: IssueContext) => void): void {
  const seen = new Set<string>();
  for (const x of xs) {
    if (seen.has(x.id)) add('X-DUP-ID', `${what} ${x.id}`, { ruleId: x.id });
    seen.add(x.id);
  }
}

/** WBS 間の決済の循環に入っている送信 WBS のキー（Tarjan の強連結成分） */
export function settlementCycleMembers(scenario: Scenario): string[] {
  const edges = new Map<string, Set<string>>();
  for (const r of scenario.settlementRules) {
    const k = objKey(r.sender);
    const out = edges.get(k) ?? new Set<string>();
    for (const d of r.rules) if (d.receiver.type === 'WBS' || d.receiver.type === 'ORD') out.add(objKey(d.receiver));
    edges.set(k, out);
  }
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const members: string[] = [];
  const visit = (v: string) => {
    idx.set(v, index);
    low.set(v, index++);
    stack.push(v);
    onStack.add(v);
    for (const w of edges.get(v) ?? []) {
      if (!edges.has(w)) continue;
      if (!idx.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, idx.get(w)!));
    }
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1 || edges.get(v)!.has(v)) members.push(...comp);
    }
  };
  for (const v of edges.keys()) if (!idx.has(v)) visit(v);
  return members.sort((a, b) => compareObj({ type: 'WBS', id: a.slice(4) }, { type: 'WBS', id: b.slice(4) }));
}

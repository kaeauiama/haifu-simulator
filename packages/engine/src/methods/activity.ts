/**
 * 直接活動配分（数量 × 計画レート）と、実績原価レートによる再評価（5.2、5.2「細かい決めごと」）。
 * どちらも送信原価センタと受信者を、活動タイプの活動配分勘定（43）で計上する。
 */
import { allocate, roundYen } from '../ledger/rounding.ts';
import { compareId, objKey } from '../model/keys.ts';
import type { ActivityAllocation, ClosingStep, ObjRef, StepKind } from '../model/types.ts';
import { fmtYen } from '../validate/issues.ts';
import type { Poster } from './context.ts';

/** 再評価の行の rowId */
export const REVAL_ROW = 'REVAL';

export function runActivityAlloc(a: ActivityAllocation, poster: Poster): void {
  const { mi, state, blocked } = poster.ctx;
  if (blocked.has(a.id)) return;
  const at = mi.activityTypes.get(a.activityType);
  if (!at) {
    poster.issue('X-REF', `活動タイプ ${a.activityType}`, { ruleId: a.id });
    return;
  }
  const rate = at.rates.find((r) => r.cctr === a.senderCctr);
  if (!rate) {
    poster.issue('X-NO-RATE', `${at.id} × 原価センタ ${a.senderCctr}`, { ruleId: a.id });
    return;
  }
  const sender: ObjRef = { type: 'CCTR', id: a.senderCctr };
  poster.pair(poster.newDoc(), {
    sender,
    receiver: a.receiver,
    account: at.allocAccount,
    amount: roundYen(a.quantity * rate.planRate),
    ruleId: a.id,
    sourceLineIds: state.sourceLineIds(objKey(sender)),
  });
}

/**
 * 実績原価レート計算と再評価（P-09）。
 * 原価プール＝ステップ開始時点の原価センタ残高から、活動配分・再評価の貸方を除いた額。
 * 活動タイプが複数あれば、計画額（数量×計画レート）の比でプールを分ける。
 * 差額＝プール − これまでの貸方 を、活動配分の実績数量の比で受信者へ配る。
 */
export function runRevaluation(step: ClosingStep, poster: Poster): void {
  const { scenario, executed, mi, stepStart, state, blocked } = poster.ctx;
  const typeFilter = step.itemIds.length ? new Set(step.itemIds) : null;
  const allocById = new Map(scenario.activityAllocs.map((a) => [a.id, a]));

  const done: ActivityAllocation[] = [];
  for (const s of executed) {
    if (s.kind !== 'ACTIVITY_ALLOC') continue;
    for (const id of s.itemIds) {
      const a = allocById.get(id);
      if (a && !blocked.has(a.id) && mi.activityTypes.get(a.activityType)?.rates.some((r) => r.cctr === a.senderCctr)) done.push(a);
    }
  }
  if (!done.length) return;

  // 活動配分・再評価で原価センタを貸方にした額（原価センタ → 活動タイプ → 額）
  const kindOf = new Map<string, StepKind>(scenario.steps.map((s) => [s.id, s.kind]));
  const credited = new Map<string, Map<string, number>>();
  for (const l of state.lines) {
    if (l.role !== 'SENDER' || l.obj.type !== 'CCTR') continue;
    const kind = kindOf.get(l.stepId);
    if (kind !== 'ACTIVITY_ALLOC' && kind !== 'ACTUAL_RATE_REVAL') continue;
    const a = allocById.get(l.origin.ruleId);
    if (!a) continue;
    const m = credited.get(l.obj.id) ?? new Map<string, number>();
    m.set(a.activityType, (m.get(a.activityType) ?? 0) - l.amount);
    credited.set(l.obj.id, m);
  }

  const byCctr = new Map<string, ActivityAllocation[]>();
  for (const a of done) byCctr.set(a.senderCctr, [...(byCctr.get(a.senderCctr) ?? []), a]);

  for (const cctr of [...byCctr.keys()].sort(compareId)) {
    const allocs = byCctr.get(cctr)!;
    const sender: ObjRef = { type: 'CCTR', id: cctr };
    const key = objKey(sender);
    const creditedByType = credited.get(cctr) ?? new Map<string, number>();
    let totalCredited = 0;
    for (const v of creditedByType.values()) totalCredited += v;
    const pool = stepStart.total(key) + totalCredited;

    const types = [...new Set(allocs.map((a) => a.activityType))].sort(compareId);
    const planValue = new Map<string, number>();
    const qtyByType = new Map<string, number>();
    for (const a of allocs) {
      const rate = mi.activityTypes.get(a.activityType)!.rates.find((r) => r.cctr === cctr)!.planRate;
      planValue.set(a.activityType, (planValue.get(a.activityType) ?? 0) + a.quantity * rate);
      qtyByType.set(a.activityType, (qtyByType.get(a.activityType) ?? 0) + a.quantity);
    }
    const totalPlan = [...planValue.values()].reduce((s, v) => s + v, 0);
    const sources = state.sourceLineIds(key);

    for (const t of types) {
      if (typeFilter && !typeFilter.has(t)) continue;
      const at = mi.activityTypes.get(t)!;
      const qty = qtyByType.get(t)!;
      if (qty === 0) continue;
      const poolT = types.length === 1 || totalPlan === 0 ? pool : (pool * planValue.get(t)!) / totalPlan;
      const planRate = at.rates.find((r) => r.cctr === cctr)!.planRate;
      const actualRate = poolT / qty;
      poster.issue(
        'X-RATE',
        `${mi.label(sender)} × ${at.id} ${at.name}：実績 ${fmtRate(actualRate)}円/${at.unit}（計画 ${fmtYen(planRate)}円）`,
        { obj: sender },
      );
      const diff = roundYen(poolT) - (creditedByType.get(t) ?? 0);
      if (diff === 0) continue;
      const mine = allocs.filter((a) => a.activityType === t && a.quantity !== 0);
      const parts = allocate(
        diff,
        mine.map((a) => ({ key: `${objKey(a.receiver)}#${a.id}`, weight: Math.abs(a.quantity) })),
      );
      const doc = poster.newDoc();
      mine.forEach((a, i) => {
        poster.pair(doc, {
          sender,
          receiver: a.receiver,
          account: at.allocAccount,
          amount: parts[i]! * Math.sign(a.quantity),
          ruleId: a.id,
          rowId: REVAL_ROW,
          sourceLineIds: sources,
        });
      });
    }
  }
}

const fmtRate = (r: number): string => {
  const rounded = Math.round(r * 100) / 100;
  const [i, f] = Math.abs(rounded).toFixed(2).split('.');
  const head = fmtYen(Number(i));
  const tail = f === '00' ? '' : `.${f!.replace(/0$/, '')}`;
  return `${rounded < 0 ? '-' : ''}${head}${tail}`;
};

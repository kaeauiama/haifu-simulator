/**
 * 配分基準（Tracing Factor）を受信側の重みに展開する。
 */
import type { ReadonlyBalanceIndex } from '../ledger/balance.ts';
import { normalizeWeights, type Share } from '../ledger/rounding.ts';
import { accountPred, selectObjects } from '../ledger/select.ts';
import { objKey } from '../model/keys.ts';
import type { AllocSegment, ObjRef } from '../model/types.ts';
import type { Poster } from './context.ts';

/** 固定%の合計が100未満のとき、残りを送信側に残すための仮の受信者（P-13）。同順位では最後に並ぶ */
export const RETAIN_KEY = '~RETAIN';

export interface ReceiverWeights {
  /** key は objKey。RETAIN_KEY を含むことがある（その分は計上しない） */
  shares: Share[];
  objs: Map<string, ObjRef>;
}

/** 配分基準を重みに展開する。合計が0なら V-13 を出して null */
export function resolveReceivers(seg: AllocSegment, ruleId: string, poster: Poster): ReceiverWeights | null {
  const { mi, stepStart, snapshots } = poster.ctx;
  const f = seg.receiver.factor;
  const objs = new Map<string, ObjRef>();
  const raw: Share[] = [];
  const index = new Map<string, Share>();
  const add = (obj: ObjRef, w: number) => {
    const k = objKey(obj);
    let s = index.get(k);
    if (!s) {
      objs.set(k, obj);
      index.set(k, (s = { key: k, weight: 0 }));
      raw.push(s);
    }
    s.weight += w;
  };

  switch (f.kind) {
    case 'FIXED_PERCENT': {
      // 受信者は重みの表に並べた対象（P-13）
      let sum = 0;
      for (const w of f.weights) {
        add(w.obj, w.pct);
        sum += w.pct;
      }
      if (sum > 100 + 1e-9) {
        poster.issue('X-PCT-OVER', `${seg.name}（合計 ${sum}%）`, { ruleId });
        return null;
      }
      if (sum < 100 - 1e-9) raw.push({ key: RETAIN_KEY, weight: 100 - sum });
      break;
    }
    case 'FIXED_PORTION':
      for (const w of f.weights) add(w.obj, w.portion);
      break;
    case 'SKF': {
      const skf = mi.skfs.get(f.skfId);
      if (!skf) {
        poster.issue('X-REF', `統計KF ${f.skfId}`, { ruleId });
        return null;
      }
      const values = new Map<string, number>();
      for (const v of skf.values) values.set(objKey(v.obj), (values.get(objKey(v.obj)) ?? 0) + v.value);
      for (const r of selectObjects(seg.receiver.objects, mi, stepStart)) add(r, values.get(objKey(r)) ?? 0);
      break;
    }
    case 'VARIABLE': {
      let base: ReadonlyBalanceIndex = stepStart;
      if (f.asOfStep !== undefined) {
        const snap = snapshots.get(f.asOfStep);
        if (!snap) {
          poster.issue('X-ASOF', `${seg.name}（${f.asOfStep}）`, { ruleId });
          return null;
        }
        base = snap;
      }
      const pred = accountPred(f.accounts);
      for (const r of selectObjects(seg.receiver.objects, mi, base)) add(r, base.total(objKey(r), pred));
      break;
    }
  }

  const norm = normalizeWeights(raw);
  if (!norm) {
    poster.issue('V-13', seg.name, { ruleId });
    return null;
  }
  if (norm.dropped.length) {
    poster.issue('X-NEG-WEIGHT', `${seg.name}（${norm.dropped.join('、')}）`, { ruleId });
  }
  return { shares: norm.shares, objs };
}

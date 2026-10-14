/**
 * マスタの索引と、利益センタの導出（4章「設計上の要点」）。
 * 原価センタと WBS は自身の割当から、セグメントは特性の利益センタから取る。
 */
import { CHAR_KEYS } from '../model/schema.ts';
import { isSegmentKey, parseSegmentKey } from '../model/keys.ts';
import type {
  AccountCategory,
  ActivityType,
  CharKey,
  CostCenter,
  GLAccount,
  Group,
  Master,
  ObjRef,
  ProfitCenter,
  ProfitabilitySegment,
  SettlementProfile,
  StatKeyFigure,
  WBSElement,
} from '../model/types.ts';

const byId = <T extends { id: string }>(xs: readonly T[]): Map<string, T> => new Map(xs.map((x) => [x.id, x]));

export class MasterIndex {
  readonly accounts: Map<string, GLAccount>;
  readonly profitCenters: Map<string, ProfitCenter>;
  readonly costCenters: Map<string, CostCenter>;
  readonly wbs: Map<string, WBSElement>;
  readonly activityTypes: Map<string, ActivityType>;
  readonly skfs: Map<string, StatKeyFigure>;
  readonly segments: Map<string, ProfitabilitySegment>;
  readonly profiles: Map<string, SettlementProfile>;
  readonly groups: Map<string, Group>;
  /** 属性として導出されるセグメント（セグメントの attributed と、WBS の attributedSegment の和） */
  readonly attributedSegments: Set<string>;

  constructor(readonly master: Master) {
    this.accounts = byId(master.accounts);
    this.profitCenters = byId(master.profitCenters);
    this.costCenters = byId(master.costCenters);
    this.wbs = byId(master.wbs);
    this.activityTypes = byId(master.activityTypes);
    this.skfs = byId(master.skfs);
    this.segments = byId(master.segments);
    this.profiles = byId(master.settlementProfiles);
    this.groups = byId(master.groups);
    this.attributedSegments = new Set([
      ...master.segments.filter((s) => s.attributed).map((s) => s.id),
      ...master.wbs.flatMap((w) => (w.attributedSegment ? [w.attributedSegment] : [])),
    ]);
  }

  category(account: string): AccountCategory | undefined {
    return this.accounts.get(account)?.category;
  }

  isSecondary(account: string): boolean {
    const c = this.category(account);
    return c !== undefined && c.startsWith('SEC');
  }

  /** 利益センタの導出。導出できないときは空文字（P-17） */
  derivePC(obj: ObjRef): string {
    switch (obj.type) {
      case 'CCTR':
        return this.costCenters.get(obj.id)?.profitCenter ?? '';
      case 'WBS':
        return this.wbs.get(obj.id)?.profitCenter ?? '';
      case 'PCTR':
        return obj.id;
      case 'PSEG':
        return parseSegmentKey(obj.id).profitCenter ?? '';
      case 'ORD':
        return '';
    }
  }

  exists(obj: ObjRef): boolean {
    switch (obj.type) {
      case 'CCTR':
        return this.costCenters.has(obj.id);
      case 'WBS':
        return this.wbs.has(obj.id);
      case 'PCTR':
        return this.profitCenters.has(obj.id);
      case 'PSEG':
        return isSegmentKey(obj.id);
      case 'ORD':
        return false;
    }
  }

  isStatisticalWbs(obj: ObjRef): boolean {
    return obj.type === 'WBS' && this.wbs.get(obj.id)?.statistical === true;
  }

  /** 顧客プロジェクトの WBS なら、その属性セグメントの id */
  attributedSegmentOf(obj: ObjRef): string | undefined {
    if (obj.type !== 'WBS') return undefined;
    const w = this.wbs.get(obj.id);
    return w?.projectType === 'CUSTOMER' ? w.attributedSegment : undefined;
  }

  name(obj: ObjRef): string {
    switch (obj.type) {
      case 'CCTR':
        return this.costCenters.get(obj.id)?.name ?? '';
      case 'WBS':
        return this.wbs.get(obj.id)?.name ?? '';
      case 'PCTR':
        return this.profitCenters.get(obj.id)?.name ?? '';
      case 'PSEG':
        return segmentLabel(obj.id);
      case 'ORD':
        return '';
    }
  }

  /** 画面・メッセージ用の表示名（例：原価センタ 1100 IT部） */
  label(obj: ObjRef): string {
    const n = this.name(obj);
    switch (obj.type) {
      case 'CCTR':
        return `原価センタ ${obj.id}${n ? ` ${n}` : ''}`;
      case 'WBS':
        return `WBS ${obj.id}${n ? ` ${n}` : ''}`;
      case 'PCTR':
        return `利益センタ ${obj.id}${n ? ` ${n}` : ''}`;
      case 'PSEG':
        return `セグメント ${n}`;
      case 'ORD':
        return `指図 ${obj.id}`;
    }
  }
}

const CHAR_PREFIX: Record<CharKey, string> = {
  customer: '顧客',
  customerGroup: '顧客G',
  product: '製品',
  productGroup: '',
  region: '地域',
  profitCenter: '',
};

/** セグメントの表示名。設定済みの特性値を「×」でつなぐ（例：顧客A×PG1×PC20）。全部未設定なら「全社」 */
export function segmentLabel(id: string): string {
  const chars = parseSegmentKey(id);
  const parts = CHAR_KEYS.flatMap((k) => (chars[k] ? [`${CHAR_PREFIX[k]}${chars[k]}`] : []));
  return parts.length ? parts.join('×') : '全社';
}

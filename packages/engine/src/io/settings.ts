/**
 * 設定検討へのインプット（F9-03）：サイクル定義、決済規則、活動配分、原価計算シート、TDD、締めステップの一覧。
 * 表は見出しと行だけを返し、Excel への書き出しは画面側で行う。
 */
import { formatAccountRanges } from '../edit/codec.ts';
import { stepsOfRule, type RuleKind } from '../graph/rules.ts';
import { MasterIndex, segmentLabel } from '../ledger/masterIndex.ts';
import { CHAR_KEYS } from '../model/schema.ts';
import type { CharKey, ObjRef, ObjSelector, Project, TracingFactor } from '../model/types.ts';

export interface SettingsTable {
  name: string;
  header: string[];
  rows: (string | number)[][];
}

const TYPE: Record<ObjRef['type'], string> = { CCTR: '原価センタ', PCTR: '利益センタ', WBS: 'WBS', ORD: '指図', PSEG: 'セグメント' };
const CHAR: Record<CharKey, string> = { customer: '顧客', customerGroup: '顧客グループ', product: '製品', productGroup: '製品グループ', region: '地域', profitCenter: '利益センタ' };

const objText = (o: ObjRef) => (o.type === 'PSEG' ? segmentLabel(o.id) : o.id);

export function selectorText(sel: ObjSelector): string {
  switch (sel.mode) {
    case 'LIST':
      return sel.ids.map((id) => objText({ type: sel.type, id })).join(', ');
    case 'RANGE':
      return `${sel.from}〜${sel.to}`;
    case 'GROUP':
      return `グループ ${sel.groupId}`;
    case 'FILTER':
      return CHAR_KEYS.filter((k) => sel.chars[k] !== undefined)
        .map((k) => `${CHAR[k]}=${sel.chars[k]}`)
        .join(', ');
  }
}

function factorText(f: TracingFactor, mi: MasterIndex): [string, string] {
  switch (f.kind) {
    case 'FIXED_PERCENT':
      return ['固定%', f.weights.map((w) => `${objText(w.obj)}:${w.pct}%`).join(', ')];
    case 'FIXED_PORTION':
      return ['固定比率', f.weights.map((w) => `${objText(w.obj)}:${w.portion}`).join(', ')];
    case 'SKF':
      return ['統計KF', `${f.skfId} ${mi.skfs.get(f.skfId)?.name ?? ''}`.trim()];
    case 'VARIABLE':
      return ['実績値', `${formatAccountRanges(f.accounts)}${f.asOfStep ? `（${f.asOfStep} 末）` : ''}`];
  }
}

export function settingsTables(p: Project, scenarioId: string): SettingsTable[] {
  const s = p.scenarios.find((x) => x.id === scenarioId);
  if (!s) throw new Error(`scenario not found: ${scenarioId}`);
  const mi = new MasterIndex(p.master);
  const steps = (kind: RuleKind, id: string) =>
    stepsOfRule(s, kind, id)
      .map((sid) => {
        const i = s.steps.findIndex((x) => x.id === sid);
        return `${i + 1}. ${s.steps[i]!.name}${s.steps[i]!.enabled ? '' : '（オフ）'}`;
      })
      .join('、');

  const cycles: SettingsTable = {
    name: 'サイクル',
    header: ['サイクル', '名前', 'コンテキスト', 'タイプ', '反復', 'セグメント', 'セグメント名', '送信側', '送信勘定', '送信割合（%）', '受信側', '配分基準', '基準の値', '配賦勘定', 'ステップ'],
    rows: s.cycles.flatMap((c) =>
      c.segments.map((seg) => {
        const [fk, fv] = factorText(seg.receiver.factor, mi);
        const fixed = seg.receiver.factor.kind === 'FIXED_PERCENT' || seg.receiver.factor.kind === 'FIXED_PORTION';
        return [
          c.id,
          c.name,
          { CCTR: '原価センタ', PCTR: '利益センタ', MA: 'マージン分析' }[c.context],
          c.type === 'DISTRIBUTION' ? '配布' : '配賦',
          c.iterative ? 'する' : 'しない',
          seg.id,
          seg.name,
          `${TYPE[seg.sender.objects.type]}：${selectorText(seg.sender.objects)}`,
          formatAccountRanges(seg.sender.accounts),
          seg.sender.sharePct,
          fixed ? `${TYPE[seg.receiver.objects.type]}：（基準の値のとおり）` : `${TYPE[seg.receiver.objects.type]}：${selectorText(seg.receiver.objects)}`,
          fk,
          fv,
          seg.allocAccount ?? '',
          steps('CYCLE', c.id),
        ];
      }),
    ),
  };

  const settlements: SettingsTable = {
    name: '決済規則',
    header: ['決済規則', '送信WBS', 'WBS名', 'プロジェクト区分', '決済プロファイル', '受信の種類', '受信者', '基準', '値', '決済タイプ', '有効開始', '有効終了', 'ステップ'],
    rows: s.settlementRules.flatMap((r) => {
      const w = mi.wbs.get(r.sender.id);
      return r.rules.map((d) => [
        r.id,
        r.sender.id,
        w?.name ?? '',
        w ? (w.projectType === 'CUSTOMER' ? '顧客プロジェクト' : '間接費プロジェクト') : '',
        w?.settlementProfileId ?? '',
        TYPE[d.receiver.type],
        objText(d.receiver),
        { PCT: '%', EQUIV: '等価係数', AMOUNT: '金額' }[d.basis],
        d.value,
        d.settlementType,
        d.validFrom,
        d.validTo ?? '',
        steps('SETTLEMENT', r.id),
      ]);
    }),
  };

  const activities: SettingsTable = {
    name: '直接活動配分',
    header: ['活動配分', '送信原価センタ', '活動タイプ', '計画レート（円）', '受信の種類', '受信者', '数量', 'ステップ'],
    rows: s.activityAllocs.map((a) => [
      a.id,
      a.senderCctr,
      a.activityType,
      mi.activityTypes.get(a.activityType)?.rates.find((r) => r.cctr === a.senderCctr)?.planRate ?? '',
      TYPE[a.receiver.type],
      objText(a.receiver),
      a.quantity,
      steps('ACTIVITY', a.id),
    ]),
  };

  const costing: SettingsTable = {
    name: '原価計算シート',
    header: ['原価計算シート', '行', 'ベース勘定', '率（%）', '貸方原価センタ', '間接費勘定', '対象', 'ステップ'],
    rows: s.costingSheets.flatMap((cs) =>
      cs.rows.map((row, i) => [cs.id, i + 1, formatAccountRanges(row.base), row.ratePct, row.creditCctr, row.overheadAccount, cs.targets.map(objText).join(', '), steps('COSTING', cs.id)]),
    ),
  };

  const tdd: SettingsTable = {
    name: 'TDD',
    header: ['TDDルール', '名前', '送信セグメント', '送信勘定', '細分化する特性', '参照勘定', 'ステップ'],
    rows: s.tddRules.map((r) => [
      r.id,
      r.name,
      selectorText(r.sender.segments),
      formatAccountRanges(r.sender.accounts),
      r.distributeChars.map((k) => CHAR[k]).join('、'),
      formatAccountRanges(r.reference.accounts),
      steps('TDD', r.id),
    ]),
  };

  const KIND: Record<string, string> = {
    ACTIVITY_ALLOC: '直接活動配分',
    OVERHEAD_CALC: '間接費計算',
    ALLOC_CYCLE: '配賦サイクル',
    ACTUAL_RATE_REVAL: '実績レート再評価',
    SETTLEMENT: '決済',
    TDD: 'TDD',
    MANUAL_REPOST: '手動の振替',
  };
  const stepTable: SettingsTable = {
    name: '締めステップ',
    header: ['順', 'ステップ', '種類', 'ジョブ', 'オン・オフ'],
    rows: s.steps.map((st, i) => [i + 1, st.name, KIND[st.kind] ?? st.kind, st.itemIds.join(', '), st.enabled ? 'オン' : 'オフ']),
  };

  return [stepTable, cycles, settlements, activities, costing, tdd];
}

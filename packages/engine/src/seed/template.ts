/**
 * 標準の締め順序（5.1 の既定順）。F4-03 のテンプレート。
 */
import type { ClosingStep, StepKind } from '../model/types.ts';

export const DEFAULT_STEP_TEMPLATE: readonly { id: string; name: string; kind: StepKind }[] = [
  { id: 'ST-01', name: '直接活動配分', kind: 'ACTIVITY_ALLOC' },
  { id: 'ST-02', name: '間接費計算', kind: 'OVERHEAD_CALC' },
  { id: 'ST-03', name: '決済①：間接費プロジェクト→原価センタ', kind: 'SETTLEMENT' },
  { id: 'ST-04', name: '原価センタ間の配布', kind: 'ALLOC_CYCLE' },
  { id: 'ST-05', name: '原価センタ間の配賦', kind: 'ALLOC_CYCLE' },
  { id: 'ST-06', name: '実績原価レートの計算と再評価', kind: 'ACTUAL_RATE_REVAL' },
  { id: 'ST-07', name: '決済②：WBS→収益性セグメント', kind: 'SETTLEMENT' },
  { id: 'ST-08', name: 'マージン分析への配賦・配布', kind: 'ALLOC_CYCLE' },
  { id: 'ST-09', name: 'TDD', kind: 'TDD' },
];

/** テンプレートからステップ列を作る。items でステップごとのジョブを指定する */
export function stepsFromTemplate(items: Partial<Record<string, string[]>> = {}): ClosingStep[] {
  return DEFAULT_STEP_TEMPLATE.map((t) => ({ ...t, itemIds: [...(items[t.id] ?? [])], enabled: true }));
}

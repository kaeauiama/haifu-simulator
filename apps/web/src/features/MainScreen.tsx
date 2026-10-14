/**
 * メイン画面（締め検討）。締めステップ、対象と残高、残高表・仕訳・来歴、集計と検証を1画面に並べる（6章）。
 * フロー図（対象どうしの線、ドラッグでルールを作る）は M4 で中央に入れる。
 */
import { ja } from '@/i18n/ja';
import { useRunStore } from '@/store/run';
import { DetailTabs } from './balances/DetailTabs';
import { ObjectBoard } from './balances/ObjectBoard';
import { SummaryPanel } from './balances/SummaryPanel';
import { StepPanel } from './steps/StepPanel';

export function MainScreen() {
  const summary = useRunStore((s) => s.summary);
  const error = useRunStore((s) => s.error);
  return (
    <div className="grid h-full min-h-0 gap-3 p-3 xl:grid-cols-[minmax(16rem,22%)_minmax(0,1fr)_minmax(16rem,22%)]">
      <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border bg-background p-3">
        <StepPanel />
      </div>
      <div className="grid min-h-0 min-w-0 grid-rows-[minmax(0,3fr)_minmax(0,2fr)] gap-3">
        <div className="flex min-h-0 min-w-0 flex-col rounded-lg border bg-background p-3">
          {error ? <p className="text-sm text-destructive">{`${ja.run.error}：${error}`}</p> : summary ? <ObjectBoard /> : <p className="text-sm">{ja.app.loading}</p>}
        </div>
        <div className="flex min-h-0 min-w-0 flex-col rounded-lg border bg-background p-3">
          <DetailTabs />
        </div>
      </div>
      <div className="flex min-h-0 min-w-0 flex-col rounded-lg border bg-background p-3">
        <SummaryPanel />
      </div>
    </div>
  );
}

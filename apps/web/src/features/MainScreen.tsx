/**
 * メイン画面（締め検討）。締めステップ、フロー図、残高表・仕訳・来歴、ルール・検証・集計を1画面に並べる（6章）。
 */
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ja } from '@/i18n/ja';
import { useRunStore } from '@/store/run';
import { useUiStore, type SideTab } from '@/store/ui';
import { DetailTabs } from './balances/DetailTabs';
import { IssuesPanel, TotalsPanel } from './balances/SummaryPanel';
import { FlowView } from './flow/FlowView';
import { RuleDialog } from './rules/RuleDialog';
import { RulesPanel } from './rules/RulesPanel';
import { StepPanel } from './steps/StepPanel';

const SIDE_TABS: SideTab[] = ['rules', 'issues', 'totals'];

export function MainScreen() {
  const summary = useRunStore((s) => s.summary);
  const error = useRunStore((s) => s.error);
  const sideTab = useUiStore((s) => s.sideTab);
  const setUi = useUiStore((s) => s.set);
  const issueCount = summary?.issues.filter((i) => i.severity !== 'INFO').length ?? 0;
  return (
    <div className="grid h-full min-h-0 gap-3 p-3 xl:grid-cols-[minmax(15rem,18%)_minmax(0,1fr)_minmax(16rem,20%)]">
      <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border bg-background p-3">
        <StepPanel />
      </div>
      <div className="grid min-h-0 min-w-0 grid-rows-[minmax(0,3fr)_minmax(0,2fr)] gap-3">
        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border bg-background">
          {error ? <p className="p-3 text-sm text-destructive">{`${ja.run.error}：${error}`}</p> : summary ? <FlowView /> : <p className="p-3 text-sm">{ja.app.loading}</p>}
        </div>
        <div className="flex min-h-0 min-w-0 flex-col rounded-lg border bg-background p-3">
          <DetailTabs />
        </div>
      </div>
      <div className="flex min-h-0 min-w-0 flex-col rounded-lg border bg-background p-3">
        <Tabs value={sideTab} onValueChange={(v) => setUi({ sideTab: v as SideTab })} className="flex min-h-0 flex-1 flex-col">
          <TabsList className="w-full">
            {SIDE_TABS.map((t) => (
              <TabsTrigger key={t} value={t} className="flex-1">
                {t === 'issues' && issueCount > 0 ? `${ja.sideTab[t]}（${issueCount}）` : ja.sideTab[t]}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="min-h-0 flex-1 overflow-auto pt-2">
            <TabsContent value="rules">
              <RulesPanel />
            </TabsContent>
            <TabsContent value="issues">
              <IssuesPanel />
            </TabsContent>
            <TabsContent value="totals">
              <TotalsPanel />
            </TabsContent>
          </div>
        </Tabs>
      </div>
      <RuleDialog />
    </div>
  );
}

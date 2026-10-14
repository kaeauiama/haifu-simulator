/**
 * ルールの一覧。種類ごとに並べ、選ぶとフロー図で強調し、編集フォームを開く。
 */
import { RULE_KINDS, createBlankRule, describeRules, type Issue, type RuleKind } from '@alloc-sim/engine';
import { cn } from 'cn';
import { Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ja } from '@/i18n/ja';
import { useProjectStore, useScenario } from '@/store/project';
import { useRunStore } from '@/store/run';
import { useUiStore } from '@/store/ui';
import { METHOD_COLOR } from '../flow/style';

const NO_ISSUES: readonly Issue[] = [];

export function RulesPanel() {
  const scenario = useScenario();
  const summary = useRunStore((s) => s.summary);
  const issues = summary?.issues ?? NO_ISSUES;
  const selectedRule = useUiStore((s) => s.selectedRule);
  const setUi = useUiStore((s) => s.set);
  const rules = describeRules(scenario);
  const stepName = (id: string) => {
    const i = scenario.steps.findIndex((s) => s.id === id);
    return `${i + 1}. ${scenario.steps[i]!.name}`;
  };
  const counts = (id: string) => ({
    errors: issues.filter((i) => i.ruleId === id && i.severity === 'ERROR').length,
    warnings: issues.filter((i) => i.ruleId === id && i.severity === 'WARNING').length,
  });
  const add = (kind: RuleKind) => {
    let id = '';
    const sid = useProjectStore.getState().scenarioId;
    useProjectStore.getState().edit((p) => {
      id = createBlankRule(p, sid, kind, ja.rules.newName(ja.ruleKind[kind])).id;
    });
    setUi({ selectedRule: id, editingRule: { kind, id } });
  };

  return (
    <div className="space-y-3">
      {RULE_KINDS.map((kind) => {
        const list = rules.filter((r) => r.kind === kind);
        return (
          <section key={kind} className="space-y-1">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">{ja.ruleKind[kind]}</h3>
              <Button size="icon-xs" variant="ghost" title={ja.rules.add(ja.ruleKind[kind])} aria-label={ja.rules.add(ja.ruleKind[kind])} onClick={() => add(kind)}>
                <Plus />
              </Button>
            </div>
            {list.length === 0 && <p className="text-xs text-muted-foreground">{ja.rules.empty}</p>}
            <ul className="space-y-1">
              {list.map((r) => {
                const c = counts(r.id);
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setUi({ selectedRule: r.id, editingRule: { kind: r.kind, id: r.id } })}
                      className={cn('w-full rounded-md border px-2 py-1 text-left text-sm hover:bg-muted', selectedRule === r.id && 'border-primary bg-primary/5')}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="size-2.5 shrink-0 rounded-sm" style={{ background: METHOD_COLOR[r.method] }} />
                        <span className="font-mono text-xs text-muted-foreground">{r.id}</span>
                        <span className="min-w-0 flex-1 truncate">{r.name}</span>
                        {c.errors > 0 && <Badge variant="destructive">{c.errors}</Badge>}
                        {c.errors === 0 && c.warnings > 0 && <Badge className="bg-amber-100 text-amber-900">{c.warnings}</Badge>}
                      </div>
                      <div className="truncate pl-4 text-xs text-muted-foreground">{r.stepIds.length ? r.stepIds.map(stepName).join('、') : ja.rules.noStep}</div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

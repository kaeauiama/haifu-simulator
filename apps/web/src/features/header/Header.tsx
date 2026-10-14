import { cn } from 'cn';
import { Copy, Presentation, Redo2, Trash2, Undo2 } from 'lucide-react';
import { useStore } from 'zustand';
import { confirmDialog } from '@/components/dialogs';
import { Button } from '@/components/ui/button';
import { ja } from '@/i18n/ja';
import { redo, undo, useProjectStore } from '@/store/project';
import { useSaveStore } from '@/store/persist';
import { useRunStore } from '@/store/run';
import { duplicateScenario } from '@/store/scenarioOps';
import { useUiStore, type Screen } from '@/store/ui';

const SCREENS: Screen[] = ['main', 'master', 'postings', 'compare', 'io'];

export function Header() {
  const screen = useUiStore((s) => s.screen);
  const presentation = useUiStore((s) => s.presentation);
  const setUi = useUiStore((s) => s.set);
  const project = useProjectStore((s) => s.project);
  const scenarioId = useProjectStore((s) => s.scenarioId);
  const { selectScenario, edit } = useProjectStore.getState();
  const canUndo = useStore(useProjectStore.temporal, (s) => s.pastStates.length > 0);
  const canRedo = useStore(useProjectStore.temporal, (s) => s.futureStates.length > 0);
  const savedAt = useSaveStore((s) => s.savedAt);
  const running = useRunStore((s) => s.running);
  const elapsedMs = useRunStore((s) => s.elapsedMs);
  const runError = useRunStore((s) => s.error);
  const scenario = project.scenarios.find((s) => s.id === scenarioId);

  const togglePresentation = () => {
    const next = !presentation;
    setUi({ presentation: next });
    document.documentElement.dataset.presentation = next ? 'on' : 'off';
  };

  const duplicate = () => {
    let id = '';
    edit((p) => {
      id = duplicateScenario(p, scenarioId, ja.header.copySuffix);
    });
    selectScenario(id);
  };

  const removeScenario = async () => {
    if (!scenario || project.scenarios.length < 2) return;
    if (!(await confirmDialog(ja.header.confirmDeleteScenario(scenario.name)))) return;
    const next = project.scenarios.find((s) => s.id !== scenarioId)!.id;
    selectScenario(next);
    edit((p) => {
      p.scenarios = p.scenarios.filter((s) => s.id !== scenario.id);
    });
  };

  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-background px-4 py-2">
      <h1 className="text-lg font-bold">{ja.app.title}</h1>
      <nav className="flex gap-1">
        {SCREENS.map((s) => (
          <Button key={s} size="sm" variant={screen === s ? 'default' : 'ghost'} onClick={() => setUi({ screen: s })}>
            {ja.nav[s]}
          </Button>
        ))}
      </nav>
      <div className="flex items-center gap-1">
        <label className="text-xs text-muted-foreground" htmlFor="scenario-select">
          {ja.header.scenario}
        </label>
        <select
          id="scenario-select"
          className="h-7 rounded-md border bg-background px-2 text-sm"
          value={scenarioId}
          onChange={(e) => {
            selectScenario(e.target.value);
            setUi({ selectedStepId: null });
          }}
        >
          {project.scenarios.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <Button size="icon-sm" variant="ghost" title={ja.header.duplicate} aria-label={ja.header.duplicate} onClick={duplicate}>
          <Copy />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          title={ja.header.deleteScenario}
          aria-label={ja.header.deleteScenario}
          disabled={project.scenarios.length < 2}
          onClick={removeScenario}
        >
          <Trash2 />
        </Button>
      </div>
      <div className="flex items-center gap-1">
        <Button size="icon-sm" variant="ghost" title={ja.header.undo} aria-label={ja.header.undo} disabled={!canUndo} onClick={undo}>
          <Undo2 />
        </Button>
        <Button size="icon-sm" variant="ghost" title={ja.header.redo} aria-label={ja.header.redo} disabled={!canRedo} onClick={redo}>
          <Redo2 />
        </Button>
      </div>
      <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
        <span className={cn(runError && 'text-destructive')}>
          {runError ? ja.run.error : running ? ja.run.running : elapsedMs !== null ? ja.run.elapsed(elapsedMs) : ''}
        </span>
        <span>{savedAt ? ja.header.savedAt(new Date(savedAt).toLocaleTimeString('ja-JP')) : ja.header.notSaved}</span>
        <Button size="sm" variant={presentation ? 'default' : 'outline'} onClick={togglePresentation}>
          <Presentation />
          {presentation ? ja.header.presentationOn : ja.header.presentationOff}
        </Button>
      </div>
    </header>
  );
}

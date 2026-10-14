/**
 * 入出力（6章「出力」）。プロジェクト JSON（F9-01）、設定一覧の Excel（F9-03）、仕訳の CSV（F9-04）。
 * ファイルはブラウザの中で作って手元に保存する。外には送らない。
 */
import { parseProjectJson, sampleProject, serializeProject, settingsTables } from '@alloc-sim/engine';
import { Download, FileDown, FolderOpen, RotateCcw } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { alertDialog, confirmDialog } from '@/components/dialogs';
import { Button } from '@/components/ui/button';
import { ja } from '@/i18n/ja';
import { downloadBlob, downloadText, pickTextFile, stamp } from '@/lib/files';
import { tablesToXlsx } from '@/lib/xlsx';
import { useProjectStore } from '@/store/project';
import { useRunStore } from '@/store/run';
import { useUiStore } from '@/store/ui';
import { engine } from '@/worker/client';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2 rounded-lg border bg-background p-4">
      <h2 className="font-semibold">{title}</h2>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </section>
  );
}

/** 設定一覧を Excel にする */
async function settingsWorkbook(scenarioId: string): Promise<Blob> {
  const buf = await tablesToXlsx(settingsTables(useProjectStore.getState().project, scenarioId));
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function IoScreen() {
  const project = useProjectStore((s) => s.project);
  const current = useProjectStore((s) => s.scenarioId);
  const replace = useProjectStore((s) => s.replace);
  const version = useRunStore((s) => s.version);
  const setUi = useUiStore((s) => s.set);
  const [scenarioId, setScenarioId] = useState(current);
  const sid = project.scenarios.some((s) => s.id === scenarioId) ? scenarioId : current;

  const loadJson = async () => {
    const f = await pickTextFile('.json,application/json');
    if (!f) return;
    const r = parseProjectJson(f.text);
    if (!r.ok) {
      await alertDialog(ja.header.loadError, r.errors);
      return;
    }
    replace(r.value);
    setUi({ cursor: null, selectedObj: null, selectedStepId: null });
  };

  const resetSample = async () => {
    if (!(await confirmDialog(ja.header.confirmReset))) return;
    replace(sampleProject());
    setUi({ cursor: null, selectedObj: null, selectedStepId: null });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-4">
      <Section title={ja.io.project}>
        <Button variant="outline" onClick={() => downloadText(`alloc-sim-${stamp()}.json`, serializeProject(project), 'application/json')}>
          <Download />
          {ja.header.saveJson}
        </Button>
        <Button variant="outline" onClick={loadJson}>
          <FolderOpen />
          {ja.header.loadJson}
        </Button>
        <Button variant="ghost" onClick={resetSample}>
          <RotateCcw />
          {ja.header.resetSample}
        </Button>
      </Section>
      <Section title={ja.io.settings}>
        <label className="text-sm text-muted-foreground" htmlFor="io-scenario">
          {ja.io.scenario}
        </label>
        <select id="io-scenario" className="h-8 rounded-md border bg-background px-2 text-sm" value={sid} onChange={(e) => setScenarioId(e.target.value)}>
          {project.scenarios.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <Button variant="outline" onClick={async () => downloadBlob(`settings-${sid}-${stamp()}.xlsx`, await settingsWorkbook(sid))}>
          <FileDown />
          {ja.io.exportSettings}
        </Button>
      </Section>
      <Section title={ja.io.journal}>
        <Button
          variant="outline"
          disabled={version < 0}
          onClick={async () => {
            const csv = await engine.journalCsv(version);
            if (csv) downloadText(`journal-${current}-${stamp()}.csv`, csv, 'text/csv');
          }}
        >
          <FileDown />
          {ja.io.exportJournal}
        </Button>
      </Section>
    </div>
  );
}

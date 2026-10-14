/**
 * 作業中のデータをブラウザ内（IndexedDB）に自動保存する（F9-02）。外には送らない。
 */
import { parseProject, type Project } from '@alloc-sim/engine';
import Dexie, { type EntityTable } from 'dexie';
import { create } from 'zustand';
import { useProjectStore } from './project';

interface WorkspaceRow {
  key: string;
  project: Project;
  scenarioId: string;
  savedAt: number;
}

const db = new Dexie('alloc-sim') as Dexie & { workspace: EntityTable<WorkspaceRow, 'key'> };
db.version(1).stores({ workspace: 'key' });

const KEY = 'current';
/** 編集が止まってから保存するまでの待ち時間 */
const AUTOSAVE_DEBOUNCE_MS = 800;

export const useSaveStore = create<{ savedAt: number | null; error: string | null }>(() => ({ savedAt: null, error: null }));

/** 保存してあるデータを読む。形式が合わなければ null（サンプルで始める） */
export async function loadWorkspace(): Promise<{ project: Project; scenarioId: string } | null> {
  try {
    const row = await db.workspace.get(KEY);
    if (!row) return null;
    const r = parseProject(row.project);
    if (!r.ok) return null;
    useSaveStore.setState({ savedAt: row.savedAt });
    return { project: r.value, scenarioId: row.scenarioId };
  } catch {
    return null;
  }
}

export function startAutosave(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unsub = useProjectStore.subscribe((st, prev) => {
    if (st.project === prev.project && st.scenarioId === prev.scenarioId) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const savedAt = Date.now();
      try {
        await db.workspace.put({ key: KEY, project: st.project, scenarioId: st.scenarioId, savedAt });
        useSaveStore.setState({ savedAt, error: null });
      } catch (e) {
        useSaveStore.setState({ error: e instanceof Error ? e.message : String(e) });
      }
    }, AUTOSAVE_DEBOUNCE_MS);
  });
  return () => {
    unsub();
    clearTimeout(timer);
  };
}

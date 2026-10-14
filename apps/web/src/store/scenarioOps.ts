/**
 * シナリオとステップの編集。Immer の下書きに対して呼ぶ純粋な操作（金額は扱わない）。
 */
import { DEFAULT_STEP_TEMPLATE, type ClosingStep, type Project, type Scenario, type StepKind } from '@alloc-sim/engine';
import { current, isDraft } from 'immer';

/** 既存の識別子と重ならない「prefix + 連番」 */
export function nextId(prefix: string, existing: Iterable<string>): string {
  const used = new Set(existing);
  for (let n = 1; ; n++) {
    const id = `${prefix}${String(n).padStart(2, '0')}`;
    if (!used.has(id)) return id;
  }
}

export function moveStep(s: Scenario, from: number, to: number): void {
  if (from === to || from < 0 || to < 0 || from >= s.steps.length || to >= s.steps.length) return;
  const [moved] = s.steps.splice(from, 1);
  s.steps.splice(to, 0, moved!);
}

export function addStep(s: Scenario, kind: StepKind, name: string): string {
  const id = nextId('ST-', s.steps.map((x) => x.id));
  s.steps.push({ id, name, kind, itemIds: [], enabled: true });
  return id;
}

export function removeStep(s: Scenario, id: string): void {
  s.steps = s.steps.filter((x) => x.id !== id);
}

export function toggleStep(s: Scenario, id: string): void {
  const st = s.steps.find((x) => x.id === id);
  if (st) st.enabled = !st.enabled;
}

/**
 * 標準の並び（5.1）に置き換える。ジョブは種類ごとに、いまのステップから順に引き継ぐ。
 * 同じ種類が複数あるとき（決済①②、配布・配賦・マージン分析）は、いまの並びの n 番目を n 番目へ。
 */
export function applyTemplate(s: Scenario): void {
  const byKind = new Map<StepKind, ClosingStep[]>();
  for (const st of s.steps) byKind.set(st.kind, [...(byKind.get(st.kind) ?? []), st]);
  s.steps = DEFAULT_STEP_TEMPLATE.map((t) => {
    const prev = byKind.get(t.kind)?.shift();
    return { id: t.id, name: t.name, kind: t.kind, itemIds: prev ? [...prev.itemIds] : [], enabled: prev?.enabled ?? true };
  });
}

/** シナリオを複製する（F8-01）。ルールとステップを丸ごと写し、識別子と名前を新しくする */
export function duplicateScenario(p: Project, sourceId: string, suffix: string): string {
  const src = p.scenarios.find((s) => s.id === sourceId);
  if (!src) throw new Error(`scenario not found: ${sourceId}`);
  const id = nextId('S-', p.scenarios.map((s) => s.id));
  const names = new Set(p.scenarios.map((s) => s.name));
  let name = `${src.name}${suffix}`;
  for (let n = 2; names.has(name); n++) name = `${src.name}${suffix}${n}`;
  // Immer の下書き（Proxy）は structuredClone できないので、いまの値の写しにしてから複製する
  p.scenarios.push({ ...structuredClone(isDraft(src) ? current(src) : src), id, name });
  return id;
}

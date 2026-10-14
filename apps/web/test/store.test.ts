import { describe, expect, it } from 'vitest';
import { useProjectStore, undo, redo } from '../src/store/project';
import { moveStep } from '../src/store/scenarioOps';

const order = () => useProjectStore.getState().project.scenarios[0]!.steps.map((s) => s.id);

describe('取り消し・やり直し（zundo）', () => {
  it('ステップの並べ替えを元に戻せる', () => {
    useProjectStore.temporal.getState().clear();
    const before = order();
    useProjectStore.getState().editScenario((s) => moveStep(s, 1, 4));
    expect(order()).not.toEqual(before);
    expect(useProjectStore.temporal.getState().pastStates.length).toBe(1);
    undo();
    expect(order()).toEqual(before);
    redo();
    expect(order()).not.toEqual(before);
  });
});

describe('シナリオの複製（F8-01）', () => {
  it('ストアの下書きの上で複製でき、名前と識別子が新しくなる', async () => {
    const { duplicateScenario } = await import('../src/store/scenarioOps');
    let id = '';
    useProjectStore.getState().edit((p) => {
      id = duplicateScenario(p, 'S-DEFAULT', 'のコピー');
    });
    const p = useProjectStore.getState().project;
    const copy = p.scenarios.find((s) => s.id === id)!;
    expect(copy.name).toBe('既定順（標準テンプレート）のコピー');
    expect(copy.steps).toEqual(p.scenarios.find((s) => s.id === 'S-DEFAULT')!.steps);
    expect(copy.steps).not.toBe(p.scenarios.find((s) => s.id === 'S-DEFAULT')!.steps);
  });
});

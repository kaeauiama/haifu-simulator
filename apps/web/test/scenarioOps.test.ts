import { sampleProject } from '@alloc-sim/engine';
import { describe, expect, it } from 'vitest';
import { addStep, applyTemplate, moveStep, nextId, removeStep, toggleStep } from '../src/store/scenarioOps';

const scenario = () => sampleProject().scenarios[0]!;
const ids = (s: ReturnType<typeof scenario>) => s.steps.map((x) => x.id);

describe('締めステップの編集（F4-01〜F4-03）', () => {
  it('F4-02 並べ替え：間接費計算（2番目）を配賦（5番目）の後へ', () => {
    const s = scenario();
    moveStep(s, 1, 4);
    expect(ids(s)).toEqual(['ST-01', 'ST-03', 'ST-04', 'ST-05', 'ST-02', 'ST-06', 'ST-07', 'ST-08', 'ST-09']);
    moveStep(s, 0, 99);
    expect(ids(s)[0]).toBe('ST-01');
  });

  it('F4-02 オン・オフの切り替え、追加と削除', () => {
    const s = scenario();
    toggleStep(s, 'ST-03');
    expect(s.steps.find((x) => x.id === 'ST-03')!.enabled).toBe(false);
    const id = addStep(s, 'SETTLEMENT', '決済③');
    expect(id).toBe('ST-10');
    removeStep(s, id);
    expect(s.steps).toHaveLength(9);
  });

  it('F4-03 標準の並びに戻すと、ジョブとオン・オフは種類ごとに引き継ぐ', () => {
    const s = scenario();
    const before = structuredClone(s.steps);
    moveStep(s, 1, 4);
    toggleStep(s, 'ST-03');
    applyTemplate(s);
    expect(s.steps.map((x) => [x.id, x.itemIds])).toEqual(before.map((x) => [x.id, x.itemIds]));
    expect(s.steps.find((x) => x.id === 'ST-03')!.enabled).toBe(false);
  });

  it('識別子の採番は既存と重ならない', () => {
    expect(nextId('S-', ['S-01', 'S-02'])).toBe('S-03');
  });
});

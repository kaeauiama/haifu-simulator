/**
 * 締め検討のサンキー図（F7-02）。選んだ時点までに実行したステップの流れを描く（1つ進むたびに流れが増える）。
 * 時点を動かすと、直前の表示から動かし、そのステップで増えた流れを強調する（D-049）
 */
import { PRIMARY_STEP_ID, type SankeyData } from '@alloc-sim/engine';
import { useEffect, useState } from 'react';
import { useScenario } from '@/store/project';
import { useCursorStepId, useRunStore } from '@/store/run';
import { engine } from '@/worker/client';
import { Sankey } from './Sankey';

export function SankeyView() {
  const version = useRunStore((s) => s.version);
  const scenario = useScenario();
  const cursor = useCursorStepId();
  const [data, setData] = useState<SankeyData | null>(null);
  const upTo = cursor === PRIMARY_STEP_ID ? 0 : scenario.steps.findIndex((s) => s.id === cursor) + 1;
  const stepKey = scenario.steps
    .slice(0, upTo)
    .filter((s) => s.enabled)
    .map((s) => s.id)
    .join(',');

  useEffect(() => {
    if (version < 0) return;
    let cancelled = false;
    void engine.sankey(version, scenario.id, stepKey ? stepKey.split(',') : []).then((d) => {
      if (!cancelled && d) setData(d);
    });
    return () => {
      cancelled = true;
    };
  }, [version, scenario.id, stepKey]);

  return <div className="h-full overflow-auto p-3">{data && <Sankey data={data} animate />}</div>;
}

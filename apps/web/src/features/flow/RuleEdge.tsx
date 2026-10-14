import { fmtYen, type FlowEdge } from '@alloc-sim/engine';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from '@xyflow/react';
import { cn } from 'cn';
import { memo } from 'react';
import { EDGE_STATE_STYLE, METHOD_COLOR } from './style';

export type RuleEdgeData = FlowEdge & { parallelIndex: number; highlighted: boolean; dimmed: boolean } & Record<string, unknown>;
export type RuleFlowEdge = Edge<RuleEdgeData, 'rule'>;

/** ルールの線。色は手法、破線はオフのステップ、薄いのは未実行。金額は選んだ時点までの累計 */
export const RuleEdge = memo(function RuleEdge(props: EdgeProps<RuleFlowEdge>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd } = props;
  if (!data) return null;
  const backward = targetX < sourceX;
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    curvature: (backward ? 0.6 : 0.25) + data.parallelIndex * 0.2,
  });
  const st = EDGE_STATE_STYLE[data.state];
  const color = METHOD_COLOR[data.method];
  const opacity = data.dimmed ? 0.12 : st.opacity;
  const showAmount = data.state === 'done' && data.amount !== 0;
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        interactionWidth={14}
        style={{ stroke: color, strokeWidth: data.highlighted ? 3.5 : 2, strokeDasharray: st.dash, opacity }}
      />
      {(showAmount || data.severity) && !data.dimmed && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none absolute flex items-center gap-1 rounded bg-background/90 px-1 text-xs tabular-nums shadow-xs"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY + data.parallelIndex * 16}px)`, color, opacity }}
          >
            {data.severity && <span className={cn('size-2 rounded-full', data.severity === 'ERROR' ? 'bg-destructive' : 'bg-amber-500')} />}
            {showAmount && fmtYen(data.amount)}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});

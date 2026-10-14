import type { FlowNode } from '@alloc-sim/engine';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { cn } from 'cn';
import { memo } from 'react';
import { Delta, Money } from '@/components/cells';

export type ObjNodeData = FlowNode & { width: number; height: number; selected: boolean; dimmed: boolean } & Record<string, unknown>;
export type ObjFlowNode = Node<ObjNodeData, 'obj'>;

/** 対象のノード。選んだ時点の残高と増減を出し、残高が残る原価センタ・WBS は枠を強調する（V-16） */
export const ObjNode = memo(function ObjNode({ data }: NodeProps<ObjFlowNode>) {
  const d = data;
  return (
    <div
      style={{ width: d.width, height: d.height }}
      className={cn(
        'flex flex-col justify-center rounded-lg border bg-card px-2.5 text-sm shadow-xs transition-opacity',
        d.residual && 'border-2 border-amber-500',
        d.selected && 'ring-2 ring-primary',
        d.dimmed && 'opacity-40',
      )}
    >
      <Handle type="target" position={Position.Left} className="!size-2.5 !bg-muted-foreground" />
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-medium" title={d.label}>
          {d.type === 'PSEG' ? d.name : `${d.id} ${d.name}`}
        </span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          {d.errors > 0 && <span className="size-2 rounded-full bg-destructive" />}
          {d.errors === 0 && d.warnings > 0 && <span className="size-2 rounded-full bg-amber-500" />}
          {d.profitCenter}
        </span>
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <Money value={d.balance} className="font-semibold" />
        <span className="text-xs">
          <Delta value={d.delta} />
        </span>
      </div>
      <Handle type="source" position={Position.Right} className="!size-2.5 !bg-muted-foreground" />
    </div>
  );
});

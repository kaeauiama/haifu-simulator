/**
 * 手法ごとの関係ビュー。送信側（左）と受信側（右）の2列に対象を並べ、ルールの定義を線で描く。
 * 左のノードから右のノードへ線を引くと関係を足し、線をクリックすると値を直したり外したりできる。
 */
import {
  applyDrag,
  connectInCycle,
  createBlankRule,
  dragOptions,
  fmtYen,
  parseObjKey,
  removeRelation,
  setRelationValue,
  type Method,
  type MethodView as MethodViewData,
  type MethodViewEdge,
  type MethodViewNode,
  type ViewMethod,
} from '@alloc-sim/engine';
import {
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getBezierPath,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type EdgeTypes,
  type Node,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { cn } from 'cn';
import { Pencil, Plus, X } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { Money, NumberCell } from '@/components/cells';
import { alertDialog } from '@/components/dialogs';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ja } from '@/i18n/ja';
import { useProjectStore } from '@/store/project';
import { useRunStore } from '@/store/run';
import { useUiStore } from '@/store/ui';
import { ConnectDialog, type PendingConnection } from './ConnectDialog';
import { EDGE_STATE_STYLE, METHOD_COLOR } from './style';

const R = ja.relation;
/** セグメントごとの線の色（サイクルのビュー） */
const SEGMENT_COLORS = ['#2563eb', '#16a34a', '#c2410c', '#7c3aed', '#0891b2', '#be123c', '#a16207'];
const CYCLE_VIEWS: ViewMethod[] = ['CCTR_ALLOC', 'PCTR_ALLOC', 'MA'];
const VIEW_METHODS: Record<ViewMethod, Method[]> = {
  CCTR_ALLOC: ['DIST', 'ASSESS'],
  PCTR_ALLOC: ['DIST', 'ASSESS'],
  MA: ['MA'],
  SETTLEMENT: ['SETTLEMENT'],
  ACTIVITY: ['ACTIVITY'],
  OVERHEAD_CALC: ['OVERHEAD_CALC'],
  TDD: ['TDD'],
};
const CONTEXT_OF = { CCTR_ALLOC: 'CCTR', PCTR_ALLOC: 'PCTR', MA: 'MA' } as const;
/** 同じ対象が左右の両方に並ぶので、ノードの ID には列を付ける */
const leftId = (key: string) => `L|${key}`;
const rightId = (key: string) => `R|${key}`;
const keyOf = (nodeId: string) => nodeId.slice(2);

type MNodeData = { n: MethodViewNode; width: number; height: number; selected: boolean } & Record<string, unknown>;
type LabelData = { text: string } & Record<string, unknown>;
type MEdgeData = { e: MethodViewEdge; color: string; text: string; unit: string; rank: number; count: number; lineHeight: number } & Record<string, unknown>;

export function MethodView() {
  return (
    <ReactFlowProvider>
      <MethodCanvas />
    </ReactFlowProvider>
  );
}

const pct = (share: number | null) => (share === null ? '' : `（${Math.round(share * 1000) / 10}%）`);

/** 線の上に出す定義値（例：比率 1（33.3%）、300 時間、参照 -6,000,000（60%）） */
function relationText(e: MethodViewEdge, unit: string): string {
  switch (e.basis) {
    case 'PERCENT':
    case 'PCT':
    case 'RATE':
      return `${e.value}%`;
    case 'PORTION':
      return `${R.basis.PORTION} ${e.value}${pct(e.share)}`;
    case 'SKF':
      return `${R.basis.SKF} ${e.value}${pct(e.share)}`;
    case 'VARIABLE':
      return `${R.basis.VARIABLE} ${fmtYen(e.value)}${pct(e.share)}`;
    case 'EQUIV':
      return `${R.basis.EQUIV} ${e.value}`;
    case 'AMOUNT':
      return `${fmtYen(e.value)}円`;
    case 'QUANTITY':
      return `${e.value} ${unit}`;
    case 'REFERENCE':
      return `${R.basis.REFERENCE} ${fmtYen(e.value)}${pct(e.share)}`;
  }
}

function MethodCanvas() {
  const view = useRunStore((s) => s.methodView);
  const method = useUiStore((s) => s.flowView) as ViewMethod;
  const presentation = useUiStore((s) => s.presentation);
  const selectedObj = useUiStore((s) => s.selectedObj);
  const setUi = useUiStore((s) => s.set);
  const scenarioId = useProjectStore((s) => s.scenarioId);
  const { fitView } = useReactFlow();
  const [onlyRelated, setOnlyRelated] = useState(false);
  const [pending, setPending] = useState<PendingConnection | null>(null);
  const [popover, setPopover] = useState<{ id: string; x: number; y: number } | null>(null);

  const rem = presentation ? 22 : 16;
  const width = Math.round(11 * rem);
  const height = Math.round(3.1 * rem);
  const gap = Math.round(17 * rem);
  const current = view && view.method === method ? view : null;
  const isCycleView = CYCLE_VIEWS.includes(method);
  const setFocus = (id: string) => setUi({ methodFocus: { ...useUiStore.getState().methodFocus, [method]: id } });

  const segColor = useMemo(() => new Map((current?.segments ?? []).map((s, i) => [s.id, SEGMENT_COLORS[i % SEGMENT_COLORS.length]!])), [current]);

  const { nodes, edges, structure } = useMemo(() => {
    if (!current) return { nodes: [] as Node[], edges: [] as Edge[], structure: '' };
    const related = new Set(current.edges.flatMap((e) => [e.source, e.target]));
    // ラベルは受信ノードの手前に、入ってくる線の順に縦に積む（重ならない）
    const rankInTarget = new Map<string, number>();
    const countOf = new Map<string, number>();
    for (const e of current.edges) {
      const r = countOf.get(e.target) ?? 0;
      rankInTarget.set(e.id, r);
      countOf.set(e.target, r + 1);
    }
    const keep = (n: MethodViewNode) => !onlyRelated || related.has(n.key);
    const left = current.left.filter(keep);
    const right = current.right.filter(keep);
    const out: Node[] = [];
    const header = (id: string, text: string, x: number, y: number): Node<LabelData, 'label'> => ({ id, type: 'label', position: { x, y }, data: { text }, draggable: false, selectable: false });
    out.push(header('__L', R.sender, 0, 0), header('__R', R.receiver, width + gap, 0));
    let y = height * 0.9;
    for (const n of left) {
      out.push({ id: leftId(n.key), type: 'mnode', position: { x: 0, y }, data: { n, width, height, selected: selectedObj === n.key.split('#')[0] } satisfies MNodeData, draggable: false });
      y += height * 1.35;
    }
    y = height * 0.9;
    let prevType = '';
    for (const n of right) {
      if (n.type !== prevType && new Set(right.map((x) => x.type)).size > 1) {
        out.push(header(`__T${n.type}`, ja.objType[n.type], width + gap, y));
        y += height * 0.6;
      }
      prevType = n.type;
      out.push({ id: rightId(n.key), type: 'mnode', position: { x: width + gap, y }, data: { n, width, height, selected: selectedObj === n.key } satisfies MNodeData, draggable: false });
      y += height * Math.max(1.35, ((countOf.get(n.key) ?? 0) * rem * 2.1 + rem) / height);
    }
    const unitOf = new Map(current.left.map((n) => [n.key, n.unit ?? '']));
    const es: Edge[] = current.edges.map((e) => {
      const color = isCycleView ? (segColor.get(e.rowId ?? '') ?? METHOD_COLOR[e.method]) : METHOD_COLOR[e.method];
      return {
        id: e.id,
        source: leftId(e.source),
        target: rightId(e.target),
        type: 'relation',
        data: { e, color, text: relationText(e, unitOf.get(e.source) ?? ''), unit: unitOf.get(e.source) ?? '', rank: rankInTarget.get(e.id) ?? 0, count: countOf.get(e.target) ?? 1, lineHeight: Math.round(rem * 2.1) } satisfies MEdgeData,
      };
    });
    const structure = `${method}#${current.focusRuleId}#${onlyRelated}#${width}#${left.length}#${right.length}`;
    return { nodes: out, edges: es, structure };
  }, [current, onlyRelated, width, height, gap, selectedObj, segColor, isCycleView, method, rem]);

  useEffect(() => {
    if (structure) requestAnimationFrame(() => void fitView({ padding: 0.06 }));
  }, [structure, fitView]);

  const edit = useProjectStore.getState().edit;
  const run = async (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      await alertDialog(ja.flow.createError, [e instanceof Error ? e.message : String(e)]);
    }
  };

  const onConnect = (source: string, target: string) => {
    if (!current) return;
    const [objPart, activityType] = source.split('#');
    const sender = parseObjKey(objPart!);
    const receiver = parseObjKey(target);
    if (sender.type === receiver.type && sender.id === receiver.id) return;
    const label = (k: string) => [...current.left, ...current.right].find((n) => n.key === k)?.label ?? k;
    if (isCycleView && current.focusRuleId) {
      const focus = current.focusRuleId;
      void run(() => edit((p) => connectInCycle(p, scenarioId, focus, sender, receiver)));
      return;
    }
    const methods = VIEW_METHODS[method];
    const options = dragOptions(useProjectStore.getState().project, scenarioId, sender, receiver).filter((o) => methods.includes(o.method));
    const only = options.length === 1 ? options[0]! : null;
    if (only && !isCycleView) {
      const target = only.kind === 'NEW' && activityType ? { ...only, activityType } : only;
      void run(() =>
        edit((p) => {
          const created = applyDrag(p, scenarioId, sender, receiver, target, { stepName: (m) => ja.method[m] });
          // 活動配分は数量を入れてもらう
          if (created.kind === 'ACTIVITY') setUi({ editingRule: created, selectedRule: created.id });
        }),
      );
      return;
    }
    setPending({
      sender,
      receiver,
      senderLabel: label(source),
      receiverLabel: label(target),
      methods,
      ...(activityType ? { activityType } : {}),
      onCreated: (r) => r.kind === 'CYCLE' && setFocus(r.id),
    });
  };

  const popEdge = popover && current ? current.edges.find((e) => e.id === popover.id) : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-1.5 text-sm">
        {isCycleView && current && (
          <>
            <span className="text-xs text-muted-foreground">{R.cycle}</span>
            <select className="h-7 rounded-md border bg-background px-1" value={current.focusRuleId ?? ''} onChange={(e) => setFocus(e.target.value)}>
              {current.rules.length === 0 && <option value="">{ja.rules.empty}</option>}
              {current.rules.map((r) => (
                <option key={r.id} value={r.id}>
                  {`${r.id} ${r.name}`}
                </option>
              ))}
            </select>
            {current.focusRuleId && (
              <Button size="icon-xs" variant="ghost" title={R.openRule} aria-label={R.openRule} onClick={() => setUi({ editingRule: { kind: 'CYCLE', id: current.focusRuleId! }, selectedRule: current.focusRuleId })}>
                <Pencil />
              </Button>
            )}
            <Button
              size="icon-xs"
              variant="ghost"
              title={R.newCycle}
              aria-label={R.newCycle}
              onClick={() => {
                let id = '';
                edit((p) => {
                  id = createBlankRule(p, scenarioId, 'CYCLE', ja.rules.newName(ja.ruleKind.CYCLE), { context: CONTEXT_OF[method as keyof typeof CONTEXT_OF] }).id;
                });
                setFocus(id);
              }}
            >
              <Plus />
            </Button>
            {current.segments.map((s) => (
              <span key={s.id} className="flex items-center gap-1 text-xs">
                <span className="h-1 w-4 rounded" style={{ background: segColor.get(s.id) }} />
                {s.name || s.id}
              </span>
            ))}
          </>
        )}
        <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <Checkbox checked={onlyRelated} onCheckedChange={(c) => setOnlyRelated(c === true)} />
          {R.onlyRelated}
        </label>
      </div>
      <div className="relative min-h-0 flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onConnect={(c) => onConnect(keyOf(c.source), keyOf(c.target))}
          onNodeClick={(_, n) => n.type === 'mnode' && setUi({ selectedObj: keyOf(n.id).split('#')[0]! })}
          onEdgeClick={(ev, e) => {
            const box = (ev.currentTarget as Element).closest('.react-flow')!.getBoundingClientRect();
            setPopover({ id: e.id, x: ev.clientX - box.left, y: ev.clientY - box.top });
          }}
          onPaneClick={() => setPopover(null)}
          nodesConnectable
          connectionRadius={40}
          deleteKeyCode={null}
          minZoom={0.15}
          maxZoom={2}
        >
          <Controls showInteractive={false} />
        </ReactFlow>
        {popEdge && popover && <EdgePopover edge={popEdge} x={popover.x} y={popover.y} view={current!} onClose={() => setPopover(null)} />}
      </div>
      <ConnectDialog pending={pending} onClose={() => setPending(null)} />
    </div>
  );
}

function EdgePopover({ edge, x, y, view, onClose }: { edge: MethodViewEdge; x: number; y: number; view: MethodViewData; onClose: () => void }) {
  const scenarioId = useProjectStore((s) => s.scenarioId);
  const setUi = useUiStore((s) => s.set);
  const edit = useProjectStore.getState().edit;
  const name = (k: string) => [...view.left, ...view.right].find((n) => n.key === k)?.label ?? k;
  const segment = view.segments.find((s) => s.id === edge.rowId);
  const ref = { ruleKind: edge.ruleKind, ruleId: edge.ruleId, source: edge.source, target: edge.target, ...(edge.rowId !== undefined ? { rowId: edge.rowId } : {}) };
  return (
    <div className="absolute z-20 w-72 space-y-2 rounded-lg border bg-popover p-3 text-sm shadow-lg" style={{ left: Math.max(8, x - 144), top: y + 12 }}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium">{`${name(edge.source)} → ${name(edge.target)}`}</div>
          <div className="text-xs text-muted-foreground">{segment ? `${edge.ruleId}／${segment.name || segment.id}` : edge.ruleId}</div>
        </div>
        <button type="button" aria-label={ja.dialog.close} onClick={onClose}>
          <X className="size-4" />
        </button>
      </div>
      <div className="grid grid-cols-[6rem_1fr] items-center gap-x-2 gap-y-1">
        <span className="text-muted-foreground">{R.basis[edge.basis]}</span>
        {edge.editable ? (
          <NumberCell value={edge.value} commit={(v) => void edit((p) => setRelationValue(p, scenarioId, ref, v))} />
        ) : (
          <span className="text-right tabular-nums">{edge.basis === 'VARIABLE' || edge.basis === 'REFERENCE' ? fmtYen(edge.value) : edge.value}</span>
        )}
        {edge.share !== null && (
          <>
            <span className="text-muted-foreground">{R.share}</span>
            <span className="text-right tabular-nums">{`${Math.round(edge.share * 1000) / 10}%`}</span>
          </>
        )}
        <span className="text-muted-foreground">{R.amount}</span>
        <Money value={edge.amount} className="text-right" />
      </div>
      <div className="flex justify-between">
        <Button size="xs" variant="outline" onClick={() => setUi({ editingRule: { kind: edge.ruleKind, id: edge.ruleId }, selectedRule: edge.ruleId })}>
          <Pencil />
          {R.openRule}
        </Button>
        {edge.removable && (
          <Button
            size="xs"
            variant="destructive"
            onClick={() => {
              edit((p) => removeRelation(p, scenarioId, ref));
              onClose();
            }}
          >
            {R.remove}
          </Button>
        )}
      </div>
    </div>
  );
}

const MNode = memo(function MNode({ data }: NodeProps<Node<MNodeData, 'mnode'>>) {
  const { n, width, height, selected } = data;
  const title = n.type === 'PSEG' ? n.name : `${n.id} ${n.name}`;
  return (
    <div style={{ width, height }} className={cn('flex flex-col justify-center rounded-lg border bg-card px-2.5 text-sm shadow-xs', selected && 'ring-2 ring-primary')}>
      {n.side === 'R' && <Handle type="target" position={Position.Left} className="!size-2.5 !bg-muted-foreground" />}
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-medium" title={n.label}>
          {n.activityType ? `${title} × ${n.activityType}` : title}
        </span>
      </div>
      <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
        <span>{n.planRate !== undefined ? R.perUnit(fmtYen(n.planRate), n.unit ?? '') : ''}</span>
        <Money value={n.balance} />
      </div>
      {n.side === 'L' && <Handle type="source" position={Position.Right} className="!size-2.5 !bg-muted-foreground" />}
    </div>
  );
});

const LabelNode = memo(function LabelNode({ data }: NodeProps<Node<LabelData, 'label'>>) {
  return <div className="text-sm font-semibold text-muted-foreground">{data.text}</div>;
});

const RelationEdge = memo(function RelationEdge(props: EdgeProps<Edge<MEdgeData, 'relation'>>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data } = props;
  if (!data) return null;
  const { e, color, text, rank, count, lineHeight } = data;
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const labelX = targetX - 14;
  const labelY = targetY + (rank - (count - 1) / 2) * lineHeight;
  const st = EDGE_STATE_STYLE[e.state];
  const showAmount = e.state === 'done' && e.amount !== 0;
  return (
    <>
      <BaseEdge id={id} path={path} interactionWidth={14} style={{ stroke: color, strokeWidth: 2, strokeDasharray: st.dash, opacity: st.opacity }} />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan pointer-events-none absolute rounded bg-background/90 px-1 text-right text-xs leading-tight tabular-nums shadow-xs"
          style={{ transform: `translate(-100%, -50%) translate(${labelX}px, ${labelY}px)`, color, opacity: Math.max(st.opacity, 0.6) }}
        >
          <div className="flex items-center justify-end gap-1">
            {e.severity && <span className={cn('size-2 rounded-full', e.severity === 'ERROR' ? 'bg-destructive' : 'bg-amber-500')} />}
            {text}
          </div>
          {showAmount && <div className="text-foreground">{fmtYen(e.amount)}</div>}
        </div>
      </EdgeLabelRenderer>
    </>
  );
});

const nodeTypes: NodeTypes = { mnode: MNode, label: LabelNode };
const edgeTypes: EdgeTypes = { relation: RelationEdge };

/**
 * フロー図（F7-01、6章）。対象をノード、ルールを線として描き、ノード間に線を引くとルールを作る。
 * 金額・残高は選んだ時点のもの（エンジンが返す値をそのまま出す）。
 */
import { METHODS, methodsFor, parseObjKey, type FlowGraph } from '@alloc-sim/engine';
import {
  Background,
  Controls,
  MarkerType,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  ViewportPortal,
  type Connection,
  type Edge,
  type EdgeTypes,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ja } from '@/i18n/ja';
import { useRunStore } from '@/store/run';
import { useUiStore } from '@/store/ui';
import { ConnectDialog, type PendingConnection } from './ConnectDialog';
import { canAutoLayout, columnHeaders, columnLayout, layoutGraph } from './layout';
import { ObjNode, type ObjFlowNode } from './ObjNode';
import { RuleEdge, type RuleFlowEdge } from './RuleEdge';
import { EDGE_STATE_STYLE, METHOD_COLOR } from './style';

const nodeTypes: NodeTypes = { obj: ObjNode };
const edgeTypes: EdgeTypes = { rule: RuleEdge };

/** ノードの大きさ（rem）。発表モードでは文字に合わせて大きくなる */
const NODE_REM = { w: 10.5, h: 3.4 };

export function FlowView() {
  return (
    <ReactFlowProvider>
      <FlowCanvas />
    </ReactFlowProvider>
  );
}

function FlowCanvas() {
  const graph = useRunStore((s) => s.flowGraph);
  const selectedObj = useUiStore((s) => s.selectedObj);
  const selectedRule = useUiStore((s) => s.selectedRule);
  const presentation = useUiStore((s) => s.presentation);
  const setUi = useUiStore((s) => s.set);
  const { fitView } = useReactFlow();
  const [pending, setPending] = useState<PendingConnection | null>(null);

  const chosenLayout = useUiStore((s) => s.flowLayout);
  // 大きい図は自動配置に時間がかかるので、種類ごとの列に並べる
  const layoutMode = graph && !canAutoLayout(graph.nodes.length, graph.edges.length) ? 'columns' : chosenLayout;
  const rem = presentation ? 22 : 16;
  const size = { width: Math.round(NODE_REM.w * rem), height: Math.round(NODE_REM.h * rem) };

  // 配置は、ノードと線のつながりが変わったときだけ計算し直す（金額が変わっただけでは動かさない）
  const layoutKey = useMemo(() => (graph ? `${layoutMode}#${structureKey(graph, size.width)}` : ''), [graph, size.width, layoutMode]);
  const [layout, setLayout] = useState<{ key: string; pos: Map<string, { x: number; y: number }> } | null>(null);
  useEffect(() => {
    if (!graph) return;
    let cancelled = false;
    const input = { nodes: graph.nodes.map((n) => ({ id: n.key, type: n.type, tier: n.tier })), edges: uniquePairs(graph), ...size };
    if (layoutMode === 'columns') setLayout({ key: layoutKey, pos: columnLayout(input) });
    else
      void layoutGraph(input).then((pos) => {
        if (!cancelled) setLayout({ key: layoutKey, pos });
      });
    return () => {
      cancelled = true;
    };
  }, [layoutKey]);

  // 選んだルールに関わるノードだけを残して、ほかを薄くする
  const focus = useMemo(() => {
    if (!graph || !selectedRule) return null;
    const keys = new Set<string>();
    for (const e of graph.edges) if (e.ruleId === selectedRule) keys.add(e.source).add(e.target);
    // 消したルールなど、図にないルールを選んでいるときは薄くしない
    return keys.size ? keys : null;
  }, [graph, selectedRule]);

  const [nodes, setNodes, onNodesChange] = useNodesState<ObjFlowNode>([]);
  const appliedLayout = useRef('');
  useEffect(() => {
    if (!graph || !layout) return;
    const relayout = appliedLayout.current !== layout.key;
    appliedLayout.current = layout.key;
    setNodes((prev) => {
      const prevPos = new Map(prev.map((n) => [n.id, n.position]));
      return graph.nodes.map((n) => ({
        id: n.key,
        type: 'obj' as const,
        position: (!relayout && prevPos.get(n.key)) || layout.pos.get(n.key) || { x: 0, y: 0 },
        data: { ...n, ...size, selected: n.key === selectedObj, dimmed: focus !== null && !focus.has(n.key) },
      }));
    });
    if (relayout) requestAnimationFrame(() => void fitView({ padding: 0.15 }));
  }, [graph, layout, selectedObj, focus]);

  const edges = useMemo<RuleFlowEdge[]>(() => {
    if (!graph) return [];
    const seen = new Map<string, number>();
    return graph.edges.map((e) => {
      const pair = [e.source, e.target].sort().join('|');
      const parallelIndex = seen.get(pair) ?? 0;
      seen.set(pair, parallelIndex + 1);
      const color = METHOD_COLOR[e.method];
      return {
        id: e.id,
        type: 'rule' as const,
        source: e.source,
        target: e.target,
        data: { ...e, parallelIndex, highlighted: e.ruleId === selectedRule, dimmed: focus !== null && e.ruleId !== selectedRule },
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
      };
    });
  }, [graph, selectedRule, focus]);

  const isValidConnection = (c: Connection | Edge) => {
    if (!c.source || !c.target || c.source === c.target) return false;
    return methodsFor(parseObjKey(c.source).type, parseObjKey(c.target).type).length > 0;
  };

  const labelOf = (key: string) => graph?.nodes.find((n) => n.key === key)?.label ?? key;

  return (
    <div className="relative h-full min-h-0 w-full">
      <ReactFlow<ObjFlowNode, RuleFlowEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        isValidConnection={isValidConnection}
        onConnect={(c) =>
          setPending({ sender: parseObjKey(c.source), receiver: parseObjKey(c.target), senderLabel: labelOf(c.source), receiverLabel: labelOf(c.target) })
        }
        onNodeClick={(_, n) => setUi({ selectedObj: n.id })}
        onEdgeClick={(_, e) => e.data && setUi({ selectedRule: e.data.ruleId, editingRule: { kind: e.data.ruleKind, id: e.data.ruleId } })}
        onPaneClick={() => setUi({ selectedRule: null })}
        connectionRadius={36}
        deleteKeyCode={null}
        minZoom={0.15}
        maxZoom={2}
      >
        <Background gap={24} size={1} />
        {layoutMode === 'columns' && graph && layout && (
          <ViewportPortal>
            {columnHeaders(
              graph.nodes.map((n) => ({ id: n.key, type: n.type, tier: n.tier })),
              layout.pos,
              size.height,
            ).map((h) => (
              <div key={h.tier} className="absolute text-sm font-semibold text-muted-foreground" style={{ transform: `translate(${h.x}px, ${h.y}px)` }}>
                {ja.tier[h.tier]}
              </div>
            ))}
          </ViewportPortal>
        )}
        <Controls showInteractive={false} />
        <Panel position="top-left">
          <Legend />
          {graph && graph.totalEdges > graph.edges.length && <p className="mt-1 text-xs text-muted-foreground">{ja.flow.shown(graph.edges.length, graph.totalEdges)}</p>}
        </Panel>
      </ReactFlow>
      <ConnectDialog pending={pending} onClose={() => setPending(null)} />
    </div>
  );
}

function Legend() {
  const line = (dash: string | undefined, opacity: number, label: string) => (
    <span className="flex items-center gap-1">
      <svg width="22" height="6" aria-hidden>
        <line x1="0" y1="3" x2="22" y2="3" stroke="currentColor" strokeWidth="2" strokeDasharray={dash} opacity={opacity} />
      </svg>
      {label}
    </span>
  );
  return (
    <div className="flex max-w-[48rem] flex-wrap items-center gap-x-3 gap-y-1 rounded-md border bg-background/90 px-2 py-1 text-xs">
      {METHODS.map((m) => (
        <span key={m} className="flex items-center gap-1">
          <span className="h-1 w-4 rounded" style={{ background: METHOD_COLOR[m] }} />
          {ja.method[m]}
        </span>
      ))}
      <span className="text-muted-foreground">|</span>
      {line(undefined, EDGE_STATE_STYLE.pending.opacity, ja.flow.legendPending)}
      {line(EDGE_STATE_STYLE.disabled.dash, 1, ja.flow.legendDisabled)}
      {line(EDGE_STATE_STYLE.unassigned.dash, 1, ja.flow.legendUnassigned)}
    </div>
  );
}

function uniquePairs(g: FlowGraph): { source: string; target: string }[] {
  const seen = new Set<string>();
  const out: { source: string; target: string }[] = [];
  for (const e of g.edges) {
    const k = `${e.source}>${e.target}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push({ source: e.source, target: e.target });
    }
  }
  return out;
}

const structureKey = (g: FlowGraph, width: number) =>
  `${width}#${g.nodes.map((n) => n.key).join(',')}#${uniquePairs(g)
    .map((p) => `${p.source}>${p.target}`)
    .sort()
    .join(',')}`;

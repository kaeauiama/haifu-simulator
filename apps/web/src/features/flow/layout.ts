/**
 * フロー図の自動配置（elkjs）。対象の種類ごとに列（パーティション）を分け、値が左から右へ流れるように置く（6章）。
 * 同じ列の中でも、原価センタ間の配賦などで段が分かれる。
 */
import type { ObjType } from '@alloc-sim/engine';
import type { ELK as ElkInstance } from 'elkjs/lib/elk-api.js';

// elkjs は大きいので、最初に配置を計算するときに読み込む
let elkPromise: Promise<ElkInstance> | null = null;
const getElk = () => (elkPromise ??= import('elkjs/lib/elk.bundled.js').then((m) => new m.default()));

const PARTITION: Record<ObjType, number> = { PCTR: 0, CCTR: 1, WBS: 2, ORD: 2, PSEG: 3 };

export interface LayoutInput {
  nodes: { id: string; type: ObjType }[];
  edges: { source: string; target: string }[];
  width: number;
  height: number;
}

export async function layoutGraph({ nodes, edges, width, height }: LayoutInput): Promise<Map<string, { x: number; y: number }>> {
  const elk = await getElk();
  const res = await elk.layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.partitioning.activate': 'true',
      // つながりのない対象も、種類の列に置く
      'elk.separateConnectedComponents': 'false',
      'elk.layered.spacing.nodeNodeBetweenLayers': String(Math.round(width * 0.25)),
      'elk.spacing.nodeNode': String(Math.round(height * 0.3)),
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
    },
    children: nodes.map((n) => ({ id: n.id, width, height, layoutOptions: { 'elk.partitioning.partition': String(PARTITION[n.type]) } })),
    edges: edges.map((e, i) => ({ id: `e${i}`, sources: [e.source], targets: [e.target] })),
  });
  return new Map((res.children ?? []).map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]));
}

const COLUMN_ORDER: ObjType[] = ['PCTR', 'CCTR', 'WBS', 'ORD', 'PSEG'];

/** 種類ごとの列に並べる（列の中は渡された順）。自動配置の代わりに選べる */
export function columnLayout({ nodes, width, height }: LayoutInput): Map<string, { x: number; y: number }> {
  const cols = COLUMN_ORDER.filter((t) => nodes.some((n) => n.type === t));
  const out = new Map<string, { x: number; y: number }>();
  cols.forEach((t, c) => {
    nodes
      .filter((n) => n.type === t)
      .forEach((n, i) => out.set(n.id, { x: c * width * 1.9, y: i * height * 1.45 }));
  });
  return out;
}

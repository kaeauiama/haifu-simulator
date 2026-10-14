/**
 * フロー図の配置。自動配置は elkjs（layered）で、対象の種類ごとに列（パーティション）を分け、
 * 値が左から右へ流れるように置く（6章）。elkjs は専用の Web Worker で動かし、画面を止めない。
 * 大きい図は自動配置に時間がかかるので、種類ごとの列に並べる（AUTO_LAYOUT_LIMIT）。
 */
import type { ObjType } from '@alloc-sim/engine';
import ELK from 'elkjs/lib/elk-api.js';
import elkWorkerUrl from 'elkjs/lib/elk-worker.min.js?url';

/** これを超える図は自動配置しない（514ノード・1,500本で約9秒かかった） */
export const AUTO_LAYOUT_LIMIT = { nodes: 300, edges: 600 } as const;

export const canAutoLayout = (nodes: number, edges: number) => nodes <= AUTO_LAYOUT_LIMIT.nodes && edges <= AUTO_LAYOUT_LIMIT.edges;

const elk = new ELK({ workerUrl: elkWorkerUrl });

const PARTITION: Record<ObjType, number> = { PCTR: 0, CCTR: 1, WBS: 2, ORD: 2, PSEG: 3 };

export interface LayoutInput {
  nodes: { id: string; type: ObjType }[];
  edges: { source: string; target: string }[];
  width: number;
  height: number;
}

export async function layoutGraph({ nodes, edges, width, height }: LayoutInput): Promise<Map<string, { x: number; y: number }>> {
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
    },
    children: nodes.map((n) => ({ id: n.id, width, height, layoutOptions: { 'elk.partitioning.partition': String(PARTITION[n.type]) } })),
    edges: edges.map((e, i) => ({ id: `e${i}`, sources: [e.source], targets: [e.target] })),
  });
  return new Map((res.children ?? []).map((c) => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]));
}

const COLUMN_ORDER: ObjType[] = ['PCTR', 'CCTR', 'WBS', 'ORD', 'PSEG'];

/** 種類ごとの列に並べる（列の中は渡された順） */
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

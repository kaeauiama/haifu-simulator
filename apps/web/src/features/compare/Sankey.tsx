/**
 * サンキー図（F7-02）。流れの額はエンジンが返す値をそのまま使い、ここでは配置（d3-sankey）だけを行う。
 * highlight を渡すと、そのキー（送信>受信）の流れだけを強調し、ほかを薄くする（6章、比較画面）。
 */
import { fmtYen, type SankeyData, type SankeyLink as Link, type SankeyNode as Node } from '@alloc-sim/engine';
import { sankey, sankeyLinkHorizontal, type SankeyLink, type SankeyNode } from 'd3-sankey';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ja } from '@/i18n/ja';
import { METHOD_COLOR } from '../flow/style';

type N = SankeyNode<Node, Link>;
type L = SankeyLink<Node, Link>;

export const linkKey = (l: { source: string; target: string }) => `${l.source}>${l.target}`;

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

export function Sankey({ data, highlight }: { data: SankeyData; highlight?: ReadonlySet<string> }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const height = Math.max(240, data.nodes.length * 26);
  const layout = useMemo(() => {
    if (!width || !data.links.length) return null;
    const gen = sankey<Node, Link>()
      .nodeId((d) => d.key)
      .nodeWidth(10)
      .nodePadding(12)
      .extent([
        [1, 8],
        [width - 1, height - 8],
      ]);
    return gen({ nodes: data.nodes.map((n) => ({ ...n })), links: data.links.map((l) => ({ ...l })) });
  }, [data, width, height]);

  return (
    <div ref={ref} className="w-full">
      {!data.links.length && <p className="py-6 text-center text-sm text-muted-foreground">{ja.compare.noFlow}</p>}
      {layout && (
        <svg width={width} height={height} role="img" className="text-xs">
          <g fill="none">
            {(layout.links as L[]).map((l, i) => {
              const s = l.source as N;
              const t = l.target as N;
              const key = linkKey({ source: s.key, target: t.key });
              const on = !highlight || highlight.has(key);
              return (
                <path key={i} d={sankeyLinkHorizontal()(l) ?? ''} stroke={METHOD_COLOR[l.method]} strokeWidth={Math.max(1, l.width ?? 1)} strokeOpacity={on ? 0.55 : 0.12}>
                  <title>{`${s.label} → ${t.label}：${fmtYen(l.value)}`}</title>
                </path>
              );
            })}
          </g>
          <g>
            {(layout.nodes as N[]).map((n) => {
              const right = (n.x0 ?? 0) > width / 2;
              return (
                <g key={n.key}>
                  <rect x={n.x0} y={n.y0} width={(n.x1 ?? 0) - (n.x0 ?? 0)} height={Math.max(1, (n.y1 ?? 0) - (n.y0 ?? 0))} className="fill-foreground/60" />
                  <text
                    x={right ? (n.x0 ?? 0) - 6 : (n.x1 ?? 0) + 6}
                    y={((n.y0 ?? 0) + (n.y1 ?? 0)) / 2}
                    dy="0.35em"
                    textAnchor={right ? 'end' : 'start'}
                    className="fill-foreground"
                  >
                    {n.label}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      )}
      {data.omitted > 0 && <p className="text-xs text-muted-foreground">{ja.compare.omitted(data.omitted)}</p>}
    </div>
  );
}

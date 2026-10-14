/**
 * サンキー図（F7-02）。流れの額はエンジンが返す値をそのまま使い、ここでは配置（d3-sankey）だけを行う。
 * - 列の上に、その列の対象の役割と種類を出す。列の間の下に、その区間を通る流れの手法を出す（D-049）
 * - highlight を渡すと、そのキー（送信>受信）の流れだけを強調し、ほかを薄くする（6章、比較画面）
 * - animate なら、データが変わったときに直前の表示から動かし、新しく増えた流れと対象を強調する（D-049）
 */
import { TIER_ORDER, fmtYen, type Method, type ObjTier, type ObjType, type SankeyData, type SankeyLink as Link, type SankeyNode as Node } from '@alloc-sim/engine';
import { sankey, type SankeyLink, type SankeyNode } from 'd3-sankey';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ja } from '@/i18n/ja';
import { METHOD_COLOR, TIER_COLOR } from '../flow/style';

type N = SankeyNode<Node, Link>;
type L = SankeyLink<Node, Link>;

export const linkKey = (l: { source: string; target: string }) => `${l.source}>${l.target}`;

/** 列の見出しと、区間の手法を書く高さ */
const HEAD = 40;
const FOOT = 76;
const DURATION = 700;
const TYPE_ORDER: readonly ObjType[] = ['PCTR', 'CCTR', 'WBS', 'ORD', 'PSEG'];

interface NodeGeo {
  key: string;
  label: string;
  tier: ObjTier;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}
interface LinkGeo {
  key: string;
  title: string;
  method: Method;
  sx: number;
  tx: number;
  y0: number;
  y1: number;
  w: number;
}
interface Geo {
  nodes: Map<string, NodeGeo>;
  links: Map<string, LinkGeo>;
}
interface Drawn<T> {
  g: T;
  opacity: number;
}

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

const lerp = (a: number, b: number, e: number) => a + (b - a) * e;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const linkPath = (l: LinkGeo) => {
  const mx = (l.sx + l.tx) / 2;
  return `M${l.sx},${l.y0}C${mx},${l.y0} ${mx},${l.y1} ${l.tx},${l.y1}`;
};

/** 直前の表示（from）から今の配置（to）までの途中の形。増えたものは太さ0から、消えたものは細って消える */
function frameOf(from: Geo | null, to: Geo, e: number): { nodes: Drawn<NodeGeo>[]; links: Drawn<LinkGeo>[] } {
  if (!from || e >= 1) return { nodes: [...to.nodes.values()].map((g) => ({ g, opacity: 1 })), links: [...to.links.values()].map((g) => ({ g, opacity: 1 })) };
  const nodes: Drawn<NodeGeo>[] = [];
  const shrink = (g: NodeGeo, k: number): NodeGeo => {
    const mid = (g.y0 + g.y1) / 2;
    const h = ((g.y1 - g.y0) * k) / 2;
    return { ...g, y0: mid - h, y1: mid + h };
  };
  for (const b of to.nodes.values()) {
    const a = from.nodes.get(b.key);
    nodes.push(a ? { g: { ...b, x0: lerp(a.x0, b.x0, e), x1: lerp(a.x1, b.x1, e), y0: lerp(a.y0, b.y0, e), y1: lerp(a.y1, b.y1, e) }, opacity: 1 } : { g: shrink(b, e), opacity: e });
  }
  for (const a of from.nodes.values()) if (!to.nodes.has(a.key)) nodes.push({ g: shrink(a, 1 - e), opacity: 1 - e });
  const links: Drawn<LinkGeo>[] = [];
  for (const b of to.links.values()) {
    const a = from.links.get(b.key);
    links.push(
      a
        ? { g: { ...b, sx: lerp(a.sx, b.sx, e), tx: lerp(a.tx, b.tx, e), y0: lerp(a.y0, b.y0, e), y1: lerp(a.y1, b.y1, e), w: lerp(a.w, b.w, e) }, opacity: 1 }
        : { g: { ...b, w: b.w * e }, opacity: e },
    );
  }
  for (const a of from.links.values()) if (!to.links.has(a.key)) links.push({ g: { ...a, w: a.w * (1 - e) }, opacity: 1 - e });
  return { nodes, links };
}

export function Sankey({ data, highlight, animate }: { data: SankeyData; highlight?: ReadonlySet<string>; animate?: boolean }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const height = Math.max(240, data.nodes.length * 26) + HEAD + FOOT;

  const layout = useMemo(() => {
    if (!width || !data.links.length) return null;
    const gen = sankey<Node, Link>()
      .nodeId((d) => d.key)
      .nodeWidth(10)
      .nodePadding(12)
      .extent([
        [1, HEAD],
        [width - 1, height - FOOT],
      ]);
    const g = gen({ nodes: data.nodes.map((n) => ({ ...n })), links: data.links.map((l) => ({ ...l })) });
    const geo: Geo = { nodes: new Map(), links: new Map() };
    for (const n of g.nodes as N[]) geo.nodes.set(n.key, { key: n.key, label: n.label, tier: n.tier, x0: n.x0 ?? 0, x1: n.x1 ?? 0, y0: n.y0 ?? 0, y1: n.y1 ?? 0 });
    for (const l of g.links as L[]) {
      const s = l.source as N;
      const t = l.target as N;
      const key = linkKey({ source: s.key, target: t.key });
      geo.links.set(key, { key, title: `${s.label} → ${t.label}：${fmtYen(l.value)}`, method: l.method, sx: s.x1 ?? 0, tx: t.x0 ?? 0, y0: l.y0 ?? 0, y1: l.y1 ?? 0, w: Math.max(1, l.width ?? 1) });
    }
    // 列ごとの役割と種類（同じ x にある対象が1列）
    const byX = new Map<number, N[]>();
    for (const n of g.nodes as N[]) byX.set(Math.round(n.x0 ?? 0), [...(byX.get(Math.round(n.x0 ?? 0)) ?? []), n]);
    const columns = [...byX]
      .sort((a, b) => a[0] - b[0])
      .map(([, ns]) => ({
        x0: ns[0]!.x0 ?? 0,
        x1: ns[0]!.x1 ?? 0,
        tiers: TIER_ORDER.filter((t) => ns.some((n) => n.tier === t)),
        types: TYPE_ORDER.filter((t) => ns.some((n) => n.type === t)),
      }));
    // 列の間の区間ごとに、そこを通る流れの手法（額の大きい順）
    const spans = columns.slice(1).map((right, i) => {
      const left = columns[i]!;
      const sum = new Map<Method, number>();
      for (const l of g.links as L[]) {
        if (((l.source as N).x1 ?? 0) <= left.x1 + 0.5 && ((l.target as N).x0 ?? 0) >= right.x0 - 0.5) sum.set(l.method, (sum.get(l.method) ?? 0) + l.value);
      }
      return { x0: left.x1, x1: right.x0, methods: [...sum].sort((a, b) => b[1] - a[1]).map(([m]) => m) };
    });
    // 見出しは、隣の列との中間までを自分の場所にする（重ならない）
    const mids = columns.slice(1).map((c, i) => (c.x0 + columns[i]!.x1) / 2);
    const heads = columns.map((c, i) => ({ ...c, left: i === 0 ? 0 : mids[i - 1]!, right: i === columns.length - 1 ? width : mids[i]! }));
    return { geo, spans, heads };
  }, [data, width, height]);

  // 直前の表示との差：新しく出た流れ・額が増えた流れと、新しく出た対象（animate のときだけ）
  const prevData = useRef<SankeyData | null>(null);
  const [changed, setChanged] = useState<{ links: Set<string>; nodes: Set<string> } | null>(null);
  useEffect(() => {
    const prev = prevData.current;
    prevData.current = data;
    if (!animate || !prev || prev === data) return;
    const before = new Map(prev.links.map((l) => [linkKey(l), l.value]));
    const nodesBefore = new Set(prev.nodes.map((n) => n.key));
    setChanged({
      links: new Set(data.links.filter((l) => l.value > (before.get(linkKey(l)) ?? 0)).map(linkKey)),
      nodes: new Set(data.nodes.filter((n) => !nodesBefore.has(n.key)).map((n) => n.key)),
    });
  }, [data, animate]);

  // 動かす：from（直前に描いていた形）から to（今の配置）へ
  const fromRef = useRef<Geo | null>(null);
  const toRef = useRef<Geo | null>(null);
  const shownRef = useRef<Geo | null>(null);
  const [t, setT] = useState(1);
  useEffect(() => {
    if (!layout) return;
    const prev = toRef.current ? shownRef.current : null;
    toRef.current = layout.geo;
    if (!animate || !prev || reducedMotion()) {
      fromRef.current = null;
      setT(1);
      return;
    }
    fromRef.current = prev;
    setT(0);
    const start = performance.now();
    let raf = requestAnimationFrame(function tick(now) {
      const p = Math.min(1, (now - start) / DURATION);
      setT(p);
      if (p < 1) raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [layout, animate]);

  const to = toRef.current ?? layout?.geo ?? null;
  const frame = to ? frameOf(toRef.current ? fromRef.current : null, to, ease(t)) : null;
  useLayoutEffect(() => {
    // 途中で次の変化が来たら、いま描いている形から動かし直す
    if (frame) shownRef.current = { nodes: new Map(frame.nodes.filter((d) => d.opacity > 0).map((d) => [d.g.key, d.g])), links: new Map(frame.links.filter((d) => d.opacity > 0).map((d) => [d.g.key, d.g])) };
  });

  const linkOpacity = (key: string) => {
    if (highlight) return highlight.has(key) ? 0.55 : 0.12;
    if (changed?.links.size) return changed.links.has(key) ? 0.8 : 0.3;
    return 0.55;
  };

  return (
    <div ref={ref} className="relative w-full">
      {!data.links.length && <p className="py-6 text-center text-sm text-muted-foreground">{ja.compare.noFlow}</p>}
      {layout && frame && (
        <>
          <svg width={width} height={height} role="img" aria-label={ja.compare.sankeyLabel} className="text-xs">
            <g fill="none">
              {frame.links.map(({ g, opacity }) => (
                <path key={g.key} d={linkPath(g)} stroke={METHOD_COLOR[g.method]} strokeWidth={Math.max(opacity < 1 ? 0 : 1, g.w)} strokeOpacity={linkOpacity(g.key) * opacity}>
                  <title>{g.title}</title>
                </path>
              ))}
            </g>
            <g>
              {frame.nodes.map(({ g, opacity }) => {
                const right = g.x0 > width / 2;
                const isNew = changed?.nodes.has(g.key);
                return (
                  <g key={g.key} opacity={opacity}>
                    <rect
                      x={g.x0}
                      y={g.y0}
                      width={g.x1 - g.x0}
                      height={Math.max(1, g.y1 - g.y0)}
                      fill={TIER_COLOR[g.tier]}
                      className={isNew ? 'stroke-foreground' : undefined}
                      strokeWidth={isNew ? 1.5 : 0}
                    />
                    <text x={right ? g.x0 - 6 : g.x1 + 6} y={(g.y0 + g.y1) / 2} dy="0.35em" textAnchor={right ? 'end' : 'start'} className={isNew ? 'fill-foreground font-semibold' : 'fill-foreground'}>
                      {g.label}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>

          {/* 列の見出し：役割と種類 */}
          {layout.heads.map((c, i) => {
            const last = i === layout.heads.length - 1;
            const types = c.types.map((ty) => ja.objType[ty]).join('・');
            return (
              <div
                key={i}
                className={'absolute top-0 px-1 text-xs leading-tight ' + (i === 0 ? 'text-left' : last ? 'text-right' : 'text-center')}
                style={{ left: c.left, width: c.right - c.left }}
                title={`${c.tiers.map((tr) => ja.tier[tr]).join('・')}（${types}）`}
              >
                <div className="truncate font-semibold">
                  {c.tiers.map((tr, j) => (
                    <span key={tr} className="whitespace-nowrap">
                      {j > 0 && '・'}
                      <span className="mr-0.5 inline-block size-2 rounded-sm align-middle" style={{ background: TIER_COLOR[tr] }} />
                      {ja.tier[tr]}
                    </span>
                  ))}
                </div>
                <div className="truncate text-muted-foreground">{types}</div>
              </div>
            );
          })}

          {/* 区間の手法：この列からこの列までは何で流れたか */}
          {layout.spans.map((s, i) =>
            s.methods.length ? (
              <div key={i} className="pointer-events-none absolute text-xs leading-tight" style={{ left: s.x0 + 6, width: Math.max(0, s.x1 - s.x0 - 12), top: height - FOOT + 8 }}>
                <div className="h-1.5 border-x border-t border-muted-foreground/60" />
                <div className="mt-0.5 flex flex-wrap justify-center gap-x-2">
                  {s.methods.map((m) => (
                    <span key={m} className="flex items-center gap-1 whitespace-nowrap">
                      <span className="inline-block h-0.5 w-3" style={{ background: METHOD_COLOR[m] }} />
                      {ja.method[m]}
                    </span>
                  ))}
                </div>
              </div>
            ) : null,
          )}
        </>
      )}
      {data.total > data.links.length + data.omitted && <p className="text-xs text-muted-foreground">{ja.flow.shown(data.links.length, data.total)}</p>}
      {data.omitted > 0 && <p className="text-xs text-muted-foreground">{ja.compare.omitted(data.omitted)}</p>}
    </div>
  );
}

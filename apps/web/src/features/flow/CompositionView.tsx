/**
 * 金額の構成（D-046）。選んだ時点で各対象に溜まっている残高を、直課・どこ由来の額・配った分に分けて、
 * 横の積み上げ棒で見せる。ゼロを中心に、プラスは右、マイナス（配った分・売上など）は左へ積む。
 * 行は対象の役割（コーポ部門 → 間接部門 → 直接部門 → プロジェクト → ゴール）でまとめる。
 * 額はエンジンが返した値をそのまま使い、ここでは幅への換算だけを行う。
 */
import { PART_ORDER, PRIMARY_STEP_ID, TIER_ORDER, fmtYen, type CompositionPart, type CompositionRow, type CompositionView as Data, type PartKind } from '@alloc-sim/engine';
import { cn } from 'cn';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { ja } from '@/i18n/ja';
import { useCursorStepId, useRunStore } from '@/store/run';
import { useUiStore } from '@/store/ui';
import { engine } from '@/worker/client';
import { PART_COLOR } from './style';

const J = ja.composition;
const BAR = 16;
const GAP = 2;

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

/** 外側の端だけ角を丸めた棒（4px、ゼロ側は四角） */
function barPath(x: number, y: number, w: number, h: number, roundLeft: boolean, roundRight: boolean): string {
  const r = Math.min(4, w / 2, h / 2);
  const rl = roundLeft ? r : 0;
  const rr = roundRight ? r : 0;
  return [
    `M${x + rl},${y}`,
    `H${x + w - rr}`,
    rr ? `A${rr},${rr} 0 0 1 ${x + w},${y + rr}` : '',
    `V${y + h - rr}`,
    rr ? `A${rr},${rr} 0 0 1 ${x + w - rr},${y + h}` : '',
    `H${x + rl}`,
    rl ? `A${rl},${rl} 0 0 1 ${x},${y + h - rl}` : '',
    `V${y + rl}`,
    rl ? `A${rl},${rl} 0 0 1 ${x + rl},${y}` : '',
    'Z',
  ].join(' ');
}

const partLabel = (p: CompositionPart) => (p.label ? `${J.part[p.kind]}：${p.label}` : J.part[p.kind]);

interface Hover {
  row: CompositionRow;
  part: CompositionPart;
  x: number;
  y: number;
}

export function CompositionView() {
  const version = useRunStore((s) => s.version);
  const stepId = useCursorStepId();
  const mode = useUiStore((s) => s.compositionMode);
  const selected = useUiStore((s) => s.selectedObj);
  const presentation = useUiStore((s) => s.presentation);
  const setUi = useUiStore((s) => s.set);
  const summary = useRunStore((s) => s.summary);
  const [data, setData] = useState<Data | null>(null);
  const [asTable, setAsTable] = useState(false);
  const [hover, setHover] = useState<Hover | null>(null);
  const [ref, width] = useWidth<HTMLDivElement>();

  useEffect(() => {
    if (version < 0) return;
    let cancelled = false;
    void engine.composition(version, stepId, mode).then((d) => {
      if (!cancelled && d) setData(d);
    });
    return () => {
      cancelled = true;
    };
  }, [version, stepId, mode]);

  const rows = data?.rows ?? [];
  const kinds = useMemo(() => PART_ORDER.filter((k) => rows.some((r) => r.parts.some((p) => p.kind === k))), [rows]);

  // 全行で共通の目盛り。ゼロの位置は、左右に積む最大の額の比で決める
  const rem = presentation ? 22 : 16;
  const labelW = 13 * rem;
  const valueW = 7 * rem;
  const barW = Math.max(120, width - labelW - valueW - 2 * rem);
  const { k, x0 } = useMemo(() => {
    let pos = 0;
    let neg = 0;
    for (const r of rows) {
      pos = Math.max(pos, r.parts.reduce((t, p) => t + Math.max(0, p.amount), 0));
      neg = Math.max(neg, r.parts.reduce((t, p) => t + Math.max(0, -p.amount), 0));
    }
    const total = pos + neg || 1;
    return { k: barW / total, x0: (neg / total) * barW };
  }, [rows, barW]);

  const stepName = summary?.steps.find((s) => s.id === stepId)?.name ?? (stepId === PRIMARY_STEP_ID ? ja.steps.primary : stepId);
  const tiers = TIER_ORDER.filter((t) => rows.some((r) => r.tier === t));
  const seg = (active: boolean) => cn('rounded-md px-2 py-0.5 text-sm whitespace-nowrap', active ? 'bg-primary text-primary-foreground' : 'hover:bg-muted');

  return (
    <div ref={ref} className="relative flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-1.5">
        <div className="flex gap-1 rounded-md border p-0.5">
          {(['SOURCE', 'ORIGIN'] as const).map((m) => (
            <button key={m} type="button" className={seg(mode === m)} onClick={() => setUi({ compositionMode: m })}>
              {J.mode[m]}
            </button>
          ))}
        </div>
        <div className="flex gap-1 rounded-md border p-0.5">
          <button type="button" className={seg(!asTable)} onClick={() => setAsTable(false)}>
            {J.chart}
          </button>
          <button type="button" className={seg(asTable)} onClick={() => setAsTable(true)}>
            {J.table}
          </button>
        </div>
        <span className="text-xs text-muted-foreground">{ja.steps.cursor(stepName)}</span>
        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" aria-label="凡例">
          {kinds.map((kd) => (
            <span key={kd} className="flex items-center gap-1">
              <span className="size-2.5 rounded-sm" style={{ background: PART_COLOR[kd] }} />
              {J.part[kd]}
            </span>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-3 py-2" onMouseLeave={() => setHover(null)}>
        {!rows.length && <p className="py-6 text-center text-sm text-muted-foreground">{J.empty}</p>}
        {asTable ? (
          <CompositionTable rows={rows} onSelect={(key) => setUi({ selectedObj: key })} />
        ) : (
          tiers.map((t) => (
            <section key={t} className="mb-2">
              <h3 className="sticky top-0 z-10 bg-background py-0.5 text-xs font-semibold text-muted-foreground">{ja.tier[t]}</h3>
              {rows
                .filter((r) => r.tier === t)
                .map((r) => (
                  <Row key={r.key} row={r} k={k} x0={x0} barW={barW} labelW={labelW} valueW={valueW} selected={selected === r.key} onSelect={() => setUi({ selectedObj: r.key })} onHover={setHover} />
                ))}
            </section>
          ))
        )}
      </div>

      {hover && !asTable && (
        <div className="pointer-events-none absolute z-20 rounded-md border bg-popover px-2 py-1 text-xs shadow-md" style={{ left: hover.x + 12, top: hover.y + 12 }}>
          <div className="font-medium">{hover.row.label}</div>
          <div className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: PART_COLOR[hover.part.kind] }} />
            {partLabel(hover.part)}
          </div>
          <div className="tabular-nums">{`${fmtYen(hover.part.amount)} 円`}</div>
        </div>
      )}
    </div>
  );
}

function Row(props: {
  row: CompositionRow;
  k: number;
  x0: number;
  barW: number;
  labelW: number;
  valueW: number;
  selected: boolean;
  onSelect: () => void;
  onHover: (h: Hover | null) => void;
}) {
  const { row, k, x0, barW, labelW, valueW, selected, onSelect, onHover } = props;
  const h = BAR + 10;
  const shapes = useMemo(() => {
    const out: { part: CompositionPart; d: string }[] = [];
    for (const sign of [1, -1] as const) {
      const ps = row.parts.filter((p) => Math.sign(p.amount) === sign);
      let cursor = x0;
      ps.forEach((p, i) => {
        const w = Math.abs(p.amount) * k;
        const last = i === ps.length - 1;
        // 隣の部分との間に 2px の隙間をあける（外側の端には隙間を作らない）
        const drawW = Math.max(1, w - (last ? 0 : GAP));
        const x = sign > 0 ? cursor : cursor - drawW;
        out.push({ part: p, d: barPath(x, 5, drawW, BAR, sign < 0 && last, sign > 0 && last) });
        cursor += sign * w;
      });
    }
    return out;
  }, [row, k, x0]);

  const hoverAt = (part: CompositionPart) => (e: React.MouseEvent) => {
    const box = (e.currentTarget as Element).closest('.relative')!.getBoundingClientRect();
    onHover({ row, part, x: e.clientX - box.left, y: e.clientY - box.top });
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => e.key === 'Enter' && onSelect()}
      className={cn('flex cursor-pointer items-center gap-4 rounded-md hover:bg-muted/60', selected && 'bg-primary/5 ring-1 ring-primary')}
    >
      <span className="truncate px-1 text-sm" style={{ width: labelW }} title={row.label}>
        {row.label}
      </span>
      <svg width={barW} height={h} className="shrink-0" role="img" aria-label={`${row.label}：${row.parts.map((p) => `${partLabel(p)} ${fmtYen(p.amount)}`).join('、')}`}>
        <line x1={x0} x2={x0} y1={0} y2={h} stroke="#c3c2b7" strokeWidth={1} />
        {shapes.map((s, i) => (
          <path key={i} d={s.d} fill={PART_COLOR[s.part.kind]} onMouseMove={hoverAt(s.part)} onMouseLeave={() => onHover(null)} />
        ))}
      </svg>
      <span className="text-right text-sm tabular-nums" style={{ width: valueW }}>
        {fmtYen(row.balance)}
      </span>
    </div>
  );
}

function CompositionTable({ rows, onSelect }: { rows: CompositionRow[]; onSelect: (key: string) => void }) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead className="sticky top-0 bg-muted">
        <tr className="text-left">
          <th className="px-2 py-1 font-medium">{J.object}</th>
          <th className="px-2 py-1 font-medium">{J.breakdown}</th>
          <th className="px-2 py-1 text-right font-medium">{J.amount}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <Fragment key={r.key}>
            <tr className="cursor-pointer border-t bg-muted/30 font-medium hover:bg-muted" onClick={() => onSelect(r.key)}>
              <td className="px-2 py-1">{`${r.label}（${ja.tier[r.tier]}）`}</td>
              <td className="px-2 py-1">{J.balance}</td>
              <td className="px-2 py-1 text-right tabular-nums">{fmtYen(r.balance)}</td>
            </tr>
            {r.parts.map((p) => (
              <tr key={p.key}>
                <td />
                <td className="px-2 py-0.5">
                  <span className="mr-1.5 inline-block size-2.5 rounded-sm align-middle" style={{ background: PART_COLOR[p.kind as PartKind] }} />
                  {partLabel(p)}
                </td>
                <td className="px-2 py-0.5 text-right tabular-nums">{fmtYen(p.amount)}</td>
              </tr>
            ))}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

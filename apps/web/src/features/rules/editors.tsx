/**
 * ルールの編集フォームで使う入力部品（選択条件、勘定範囲、配分基準）。
 */
import {
  CHAR_KEYS,
  formatAccountRanges,
  parseAccountRanges,
  segmentLabel,
  type AccountSelector,
  type ObjSelector,
  type ObjType,
  type Project,
  type TracingFactor,
} from '@alloc-sim/engine';
import { Plus, Trash2, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { NumberCell, SelectCell, TextCell, type Option } from '@/components/cells';
import { Button } from '@/components/ui/button';
import { ja } from '@/i18n/ja';
import { opts } from '../master/masterEdit';

const F = ja.form;

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_minmax(0,1fr)] items-start gap-2 text-sm">
      <span className="pt-1 text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export const boxed = 'border-border bg-background';

const objectLabel = (p: Project, type: ObjType, id: string): string => {
  if (type === 'PSEG') return segmentLabel(id);
  const o = opts.objects(p, type).find((x) => x.value === id);
  return o?.label ?? id;
};

/** 対象を個別に選ぶ（チップと追加用の選択肢） */
export function ObjChips({ p, type, ids, onChange }: { p: Project; type: ObjType; ids: string[]; onChange: (ids: string[]) => void }) {
  const rest = opts.objects(p, type).filter((o) => !ids.includes(o.value));
  return (
    <div className="flex flex-wrap items-center gap-1">
      {ids.map((id) => (
        <span key={id} className="flex items-center gap-1 rounded-md border bg-muted px-1.5 py-0.5 text-xs">
          {objectLabel(p, type, id)}
          <button type="button" aria-label={ja.table.delete} onClick={() => onChange(ids.filter((x) => x !== id))}>
            <X className="size-3" />
          </button>
        </span>
      ))}
      {rest.length > 0 && (
        <select className="h-6 rounded-md border bg-background px-1 text-xs" value="" onChange={(e) => e.target.value && onChange([...ids, e.target.value])}>
          <option value="">{F.add}</option>
          {rest.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function emptySelector(type: ObjType, mode: ObjSelector['mode']): ObjSelector {
  switch (mode) {
    case 'LIST':
      return { type, mode, ids: [] };
    case 'RANGE':
      return { type, mode, from: '', to: '' };
    case 'GROUP':
      return { type, mode, groupId: '' };
    case 'FILTER':
      return { type: 'PSEG', mode, chars: {} };
  }
}

/** 選択条件（個別・範囲・グループ、セグメントは特性でも選べる） */
export function SelectorEditor({ p, value, types, onChange }: { p: Project; value: ObjSelector; types: ObjType[]; onChange: (v: ObjSelector) => void }) {
  const modes: ObjSelector['mode'][] = value.type === 'PSEG' ? ['LIST', 'RANGE', 'GROUP', 'FILTER'] : ['LIST', 'RANGE', 'GROUP'];
  const charLabel = ja.master.col;
  return (
    <div className="space-y-1.5">
      <div className="flex gap-1">
        {types.length > 1 && (
          <select className="h-7 rounded-md border bg-background px-1 text-sm" value={value.type} onChange={(e) => onChange(emptySelector(e.target.value as ObjType, 'LIST'))}>
            {types.map((t) => (
              <option key={t} value={t}>
                {ja.objType[t]}
              </option>
            ))}
          </select>
        )}
        <select className="h-7 rounded-md border bg-background px-1 text-sm" value={value.mode} onChange={(e) => onChange(emptySelector(value.type, e.target.value as ObjSelector['mode']))}>
          {modes.map((m) => (
            <option key={m} value={m}>
              {F.mode[m]}
            </option>
          ))}
        </select>
      </div>
      {value.mode === 'LIST' && <ObjChips p={p} type={value.type} ids={value.ids} onChange={(ids) => onChange({ ...value, ids })} />}
      {value.mode === 'RANGE' && (
        <div className="flex items-center gap-1">
          <TextCell mono className={boxed} placeholder={F.from} value={value.from} commit={(v) => onChange({ ...value, from: v })} />
          <span>〜</span>
          <TextCell mono className={boxed} placeholder={F.to} value={value.to} commit={(v) => onChange({ ...value, to: v })} />
        </div>
      )}
      {value.mode === 'GROUP' && <SelectCell value={value.groupId} options={opts.groups(p, value.type)} allowEmpty commit={(v) => onChange({ ...value, groupId: v })} />}
      {value.mode === 'FILTER' && (
        <div className="grid grid-cols-3 gap-1">
          {CHAR_KEYS.map((k) => (
            <label key={k} className="text-xs text-muted-foreground">
              {charLabel[k]}
              <TextCell
                className={boxed}
                placeholder={F.any}
                value={value.chars[k] ?? ''}
                commit={(v) => {
                  const chars = { ...value.chars };
                  if (v) chars[k] = v;
                  else delete chars[k];
                  onChange({ ...value, chars });
                }}
              />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export function AccountRanges({ value, onChange }: { value: AccountSelector; onChange: (v: AccountSelector) => void }) {
  return (
    <TextCell
      mono
      className={boxed}
      value={formatAccountRanges(value)}
      commit={(v) => {
        const r = parseAccountRanges(v);
        if (!r.ok) return r.error;
        onChange(r.value);
      }}
    />
  );
}

/** 配分基準（固定%・固定比率・統計KF・実績値） */
export function FactorEditor({
  p,
  value,
  receiverType,
  receiverIds,
  stepOptions,
  onChange,
}: {
  p: Project;
  value: TracingFactor;
  receiverType: ObjType;
  receiverIds: string[];
  stepOptions: Option[];
  onChange: (v: TracingFactor) => void;
}) {
  const switchKind = (kind: TracingFactor['kind']) => {
    const objs = receiverIds.map((id) => ({ type: receiverType, id }));
    if (kind === 'FIXED_PERCENT') onChange({ kind, weights: objs.map((obj) => ({ obj, pct: objs.length ? Math.round((100 / objs.length) * 100) / 100 : 0 })) });
    else if (kind === 'FIXED_PORTION') onChange({ kind, weights: objs.map((obj) => ({ obj, portion: 1 })) });
    else if (kind === 'SKF') onChange({ kind, skfId: p.master.skfs[0]?.id ?? '' });
    else onChange({ kind, accounts: [] });
  };
  return (
    <div className="space-y-1.5">
      <select className="h-7 rounded-md border bg-background px-1 text-sm" value={value.kind} onChange={(e) => switchKind(e.target.value as TracingFactor['kind'])}>
        {(Object.keys(F.factorLabel) as TracingFactor['kind'][]).map((k) => (
          <option key={k} value={k}>
            {F.factorLabel[k]}
          </option>
        ))}
      </select>
      {(value.kind === 'FIXED_PERCENT' || value.kind === 'FIXED_PORTION') && <WeightsEditor p={p} value={value} receiverType={receiverType} onChange={onChange} />}
      {value.kind === 'SKF' && <SelectCell value={value.skfId} options={opts.skfs(p)} commit={(v) => onChange({ ...value, skfId: v })} />}
      {value.kind === 'VARIABLE' && (
        <div className="space-y-1">
          <Field label={F.variableAccounts}>
            <AccountRanges value={value.accounts} onChange={(accounts) => onChange({ ...value, accounts })} />
          </Field>
          <Field label={F.asOfStep}>
            <SelectCell
              allowEmpty
              emptyLabel={F.asOfStart}
              value={value.asOfStep ?? ''}
              options={stepOptions}
              commit={(v) => {
                const { asOfStep: _, ...rest } = value;
                onChange(v ? { ...rest, asOfStep: v } : rest);
              }}
            />
          </Field>
        </div>
      )}
    </div>
  );
}

type FixedFactor = Extract<TracingFactor, { kind: 'FIXED_PERCENT' | 'FIXED_PORTION' }>;

function WeightsEditor({ p, value, receiverType, onChange }: { p: Project; value: FixedFactor; receiverType: ObjType; onChange: (v: TracingFactor) => void }) {
  const isPct = value.kind === 'FIXED_PERCENT';
  const rows = value.weights.map((w) => ({ obj: w.obj, n: 'pct' in w ? w.pct : w.portion }));
  const emit = (next: { obj: { type: ObjType; id: string }; n: number }[]) =>
    onChange(isPct ? { kind: 'FIXED_PERCENT', weights: next.map((r) => ({ obj: r.obj, pct: r.n })) } : { kind: 'FIXED_PORTION', weights: next.map((r) => ({ obj: r.obj, portion: r.n })) });
  const options = opts.objects(p, receiverType);
  return (
    <div className="space-y-1">
      {rows.map((r, i) => (
        <div key={`${r.obj.id}#${i}`} className="grid grid-cols-[minmax(0,1fr)_7rem_2rem] items-center gap-1">
          <SelectCell value={r.obj.id} options={options} commit={(v) => emit(rows.map((x, j) => (j === i ? { ...x, obj: { type: receiverType, id: v } } : x)))} />
          <NumberCell value={r.n} commit={(v) => emit(rows.map((x, j) => (j === i ? { ...x, n: v } : x)))} />
          <Button size="icon-xs" variant="ghost" aria-label={ja.table.delete} onClick={() => emit(rows.filter((_, j) => j !== i))}>
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button
        size="xs"
        variant="outline"
        disabled={!options.length}
        onClick={() => emit([...rows, { obj: { type: receiverType, id: options.find((o) => !rows.some((r) => r.obj.id === o.value))?.value ?? options[0]!.value }, n: isPct ? 0 : 1 }])}
      >
        <Plus />
        {F.addWeight}
      </Button>
    </div>
  );
}

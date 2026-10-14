/**
 * 表の中で値を編集するセル。入力中は手元に持ち、確定（Enter・フォーカスを外す）したときだけ commit する。
 * これで取り消し（zundo）の単位と再計算の回数を、1つの確定ごとにする。
 * commit が文字列を返したら誤りとして扱い、値を元に戻す。
 */
import { fmtYen } from '@alloc-sim/engine';
import { cn } from 'cn';
import { useEffect, useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { alertDialog } from './dialogs';
import { ja } from '@/i18n/ja';

type Commit<V> = (value: V) => string | void;

const inputClass =
  'w-full min-w-0 rounded-md border border-transparent bg-transparent px-1.5 py-0.5 outline-none hover:border-border focus:border-ring focus:bg-background';

async function report(err: string | void): Promise<boolean> {
  if (typeof err === 'string') {
    await alertDialog(ja.table.errorTitle, [err]);
    return false;
  }
  return true;
}

export function TextCell({ value, commit, placeholder, className, mono }: { value: string; commit: Commit<string>; placeholder?: string; className?: string; mono?: boolean }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const done = async () => {
    const v = draft.trim();
    if (v === value) return;
    if (!(await report(commit(v)))) setDraft(value);
  };
  return (
    <input
      className={cn(inputClass, mono && 'font-mono', className)}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={done}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setDraft(value);
      }}
    />
  );
}

/** 数値の入力。integer なら整数として読む。金額は桁区切りで表示し、期間などは plain で区切らない */
export function NumberCell({ value, commit, integer, plain }: { value: number; commit: Commit<number>; integer?: boolean; plain?: boolean }) {
  const show = (n: number) => (integer && !plain ? fmtYen(n) : String(n));
  const [draft, setDraft] = useState(show(value));
  useEffect(() => setDraft(show(value)), [value]);
  const done = async () => {
    const text = draft.replace(/[,\s]/g, '');
    const n = Number(text);
    if (text === '' || !Number.isFinite(n) || (integer && !Number.isInteger(n))) {
      await alertDialog(ja.table.errorTitle, [integer ? ja.table.notInteger : ja.table.notNumber]);
      setDraft(show(value));
      return;
    }
    if (n === value) {
      setDraft(show(value));
      return;
    }
    if (!(await report(commit(n)))) setDraft(show(value));
  };
  return (
    <input
      className={cn(inputClass, 'text-right tabular-nums')}
      inputMode="numeric"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setDraft(integer ? String(value) : draft)}
      onBlur={done}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setDraft(show(value));
      }}
    />
  );
}

export interface Option {
  value: string;
  label: string;
}

/** 選択肢。表の中に多く並ぶので、軽いネイティブの select を使う */
export function SelectCell({ value, options, commit, allowEmpty, emptyLabel }: { value: string; options: Option[]; commit: Commit<string>; allowEmpty?: boolean; emptyLabel?: string }) {
  const known = options.some((o) => o.value === value);
  return (
    <select
      className={cn(inputClass, 'cursor-pointer', !known && value !== '' && 'text-destructive')}
      value={value}
      onChange={async (e) => {
        if (!(await report(commit(e.target.value)))) e.target.value = value;
      }}
    >
      {allowEmpty && <option value="">{emptyLabel ?? ja.table.none}</option>}
      {!known && value !== '' && <option value={value}>{value}（不明）</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function CheckCell({ value, commit, label }: { value: boolean; commit: Commit<boolean>; label?: string }) {
  return <Checkbox aria-label={label} checked={value} onCheckedChange={(c) => void report(commit(c === true))} />;
}

export function Money({ value, className }: { value: number; className?: string }) {
  return <span className={cn('tabular-nums whitespace-nowrap', className)}>{fmtYen(value)}</span>;
}

export function Delta({ value }: { value: number }) {
  if (value === 0) return <span className="text-muted-foreground">±0</span>;
  return <span className={cn('tabular-nums', value > 0 ? 'text-sky-700' : 'text-rose-700')}>{value > 0 ? `+${fmtYen(value)}` : fmtYen(value)}</span>;
}

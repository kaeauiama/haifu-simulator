/**
 * 画面なしで結果を確かめる CLI（8.3「M2を終えた時点で、CLIから結果を確かめられる」）。
 *
 *   pnpm sim                                サンプル商事の全シナリオを実行して要約を出す
 *   pnpm sim -- --scenario S-LATE           シナリオを選ぶ
 *   pnpm sim -- --file project.json         プロジェクトJSONを読む（Zodで検査）
 *   pnpm sim -- --journal                   ステップごとの流れ（送信→受信）を出す
 *   pnpm sim -- --compare S-DEFAULT S-LATE  2案の差を出す
 *   pnpm sim -- --trace "CCTR:2000"         最終残高の来歴を出す
 *   pnpm sim -- --dump-sample out.json      サンプル商事をJSONに書き出す
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { compareRuns } from './compare/compare.ts';
import { MasterIndex, segmentLabel } from './ledger/masterIndex.ts';
import { LineageTracer } from './lineage/lineage.ts';
import { compareObj, parseObjKey } from './model/keys.ts';
import { ProjectSchema } from './model/schema.ts';
import type { Issue, Project } from './model/types.ts';
import { flows, totalsByObject, totalsByProfitCenter, totalsBySegment } from './report/totals.ts';
import { runAll, type RunResult } from './run.ts';
import { sampleProject } from './seed/sampleCompany.ts';
import { fmtYen } from './validate/issues.ts';

// ---------- 表示の部品 ----------
const width = (s: string): number => [...s].reduce((w, ch) => w + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1), 0);
const padR = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - width(s)));
const padL = (s: string, w: number) => ' '.repeat(Math.max(0, w - width(s))) + s;

function table(head: string[], rows: string[][], numeric: boolean[]): string {
  const ws = head.map((h, i) => Math.max(width(h), ...rows.map((r) => width(r[i] ?? ''))));
  const line = (r: string[]) => r.map((c, i) => (numeric[i] ? padL(c, ws[i]!) : padR(c, ws[i]!))).join('  ');
  return [line(head), ws.map((w) => '-'.repeat(w)).join('  '), ...rows.map(line)].join('\n');
}

const h1 = (s: string) => `\n■ ${s}\n`;
const SEV: Record<Issue['severity'], string> = { ERROR: 'エラー', WARNING: '警告', INFO: '情報' };

// ---------- 引数 ----------
const args = process.argv.slice(2).filter((a) => a !== '--');
const opt = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const flag = (name: string) => args.includes(name);

function loadProject(): Project {
  const file = opt('--file');
  if (!file) return sampleProject();
  const parsed = ProjectSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
  if (!parsed.success) {
    console.error(`プロジェクトJSONの形式が正しくありません：${file}`);
    for (const e of parsed.error.issues.slice(0, 20)) console.error(`  ${e.path.join('.')}: ${e.message}`);
    process.exit(1);
  }
  return parsed.data;
}

// ---------- 出力 ----------
function printRun(p: Project, r: RunResult, mi: MasterIndex): void {
  const sc = p.scenarios.find((s) => s.id === r.scenarioId)!;
  console.log(`\n======== ${sc.name}（${sc.id}）  期間 ${p.master.period} ========`);
  if (sc.memo) console.log(sc.memo);

  console.log(h1('締めステップ'));
  const rows = sc.steps.map((s, i) => {
    const lines = r.ledger.filter((l) => l.stepId === s.id);
    const moved = lines.filter((l) => l.role === 'RECEIVER').reduce((t, l) => t + l.amount, 0);
    return [String(i + 1), s.enabled ? s.name : `（オフ）${s.name}`, s.kind, s.itemIds.join(',') || '-', String(lines.length), fmtYen(moved)];
  });
  console.log(table(['#', 'ステップ', '種類', 'ジョブ', '行数', '受信額計'], rows, [true, false, false, false, true, true]));

  if (flag('--journal')) {
    for (const s of sc.steps) {
      const fs = flows(r.ledger, new Set([s.id]));
      if (!fs.length) continue;
      console.log(h1(`流れ：${s.name}`));
      console.log(
        table(
          ['ルール', '送信', '受信', '勘定', '金額'],
          fs.map((f) => [f.ruleId, mi.label(f.sender), mi.label(f.receiver), `${f.account} ${mi.accounts.get(f.account)?.name ?? ''}`, fmtYen(f.amount)]),
          [false, false, false, false, true],
        ),
      );
    }
  }

  const final = r.snapshots.get(r.stepOrder[r.stepOrder.length - 1]!)!;
  console.log(h1('最終残高：対象別（0以外）'));
  const objs = [...totalsByObject(final)].filter(([, v]) => v !== 0).map(([k, v]) => [parseObjKey(k), v] as const);
  objs.sort(([a], [b]) => compareObj(a, b));
  console.log(table(['対象', '利益センタ', '残高'], objs.map(([o, v]) => [mi.label(o), mi.derivePC(o) || '（未割当）', fmtYen(v)]), [false, false, true]));

  console.log(h1('最終残高：利益センタ別'));
  const pcs = [...totalsByProfitCenter(final, mi)].sort(([a], [b]) => (a < b ? -1 : 1));
  console.log(table(['利益センタ', '残高'], pcs.map(([k, v]) => [k ? `${k} ${mi.profitCenters.get(k)?.name ?? ''}` : '（未割当）', fmtYen(v)]), [false, true]));

  console.log(h1('最終残高：セグメント別（顧客プロジェクトは属性セグメントに含める）'));
  const segs = [...totalsBySegment(final, mi)].sort(([a], [b]) => (a < b ? -1 : 1));
  console.log(table(['セグメント', '残高'], segs.map(([k, v]) => [segmentLabel(k), fmtYen(v)]), [false, true]));

  const primary = p.primaryPostings.reduce((s, x) => s + x.amount, 0);
  console.log(`\nゼロサム検査：一次仕訳合計 ${fmtYen(primary)} ／ 最終残高合計 ${fmtYen(final.grandTotal())}`);

  console.log(h1('検証結果'));
  if (!r.issues.length) console.log('（なし）');
  for (const i of r.issues) console.log(`[${SEV[i.severity]}] ${i.code}${i.stepId ? `（${i.stepId}）` : ''} ${i.message}`);

  const trace = opt('--trace');
  if (trace) {
    const obj = parseObjKey(trace);
    const v = new LineageTracer(r.ledger).balance(obj);
    console.log(h1(`来歴：${mi.label(obj)}`));
    const texts = new Map(p.primaryPostings.map((x) => [x.id, x]));
    const rows = [...v].filter(([, x]) => Math.abs(x) >= 0.5).sort(([, a], [, b]) => Math.abs(b) - Math.abs(a));
    console.log(
      table(
        ['一次仕訳', '対象', '勘定', '内容', '寄与額'],
        rows.map(([id, x]) => {
          const pp = texts.get(id);
          return [id, pp ? mi.label(pp.obj) : '', pp?.account ?? '', pp?.text ?? '', fmtYen(x)];
        }),
        [false, false, false, false, true],
      ),
    );
  }
}

function main(): void {
  const out = opt('--dump-sample');
  if (out) {
    writeFileSync(out, `${JSON.stringify(sampleProject(), null, 2)}\n`, 'utf8');
    console.log(`サンプル商事を書き出しました：${out}`);
    return;
  }
  const p = loadProject();
  const mi = new MasterIndex(p.master);
  const cmpAt = args.indexOf('--compare');
  if (cmpAt >= 0) {
    const [a, b] = [args[cmpAt + 1], args[cmpAt + 2]];
    if (!a || !b) throw new Error('--compare には2つのシナリオIDを指定してください');
    const ra = runAll(p, a);
    const rb = runAll(p, b);
    const c = compareRuns(ra, rb, mi);
    const show = (title: string, rows: { key: string; a: number; b: number; diff: number }[], label: (k: string) => string) => {
      console.log(h1(title));
      console.log(table(['キー', a, b, '差（B−A）'], rows.map((r) => [label(r.key), fmtYen(r.a), fmtYen(r.b), fmtYen(r.diff)]), [false, true, true, true]));
    };
    show('利益センタ別', c.byProfitCenter, (k) => k || '（未割当）');
    show('セグメント別', c.bySegment, segmentLabel);
    show('勘定別（マージン分析上）', c.byAccount, (k) => `${k} ${mi.accounts.get(k)?.name ?? ''}`);
    show('対象別（差があるもの）', c.byObject.filter((r) => r.diff !== 0), (k) => mi.label(parseObjKey(k)));
    console.log(h1('結果が変わったステップ'));
    console.log(c.changedSteps.join('、') || '（なし）');
    return;
  }
  const only = opt('--scenario');
  for (const s of p.scenarios) if (!only || s.id === only) printRun(p, runAll(p, s.id), mi);
}

main();

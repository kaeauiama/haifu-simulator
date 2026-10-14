/**
 * Hard Constraint のガード（D-002）：顧客データを扱うため、データを外に送らない。
 * エンジンはネットワークにも画面にも依存しない純粋な関数であることを、ソースの走査で守る。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..', 'src');
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });

/** CLI だけはローカルのファイルを読み書きする（node:fs）。それ以外のエンジンは何にも触らない */
const CLI = join(SRC, 'cli.ts');

const FORBIDDEN: [RegExp, string][] = [
  [/\bfetch\s*\(/, 'fetch'],
  [/XMLHttpRequest/, 'XMLHttpRequest'],
  [/WebSocket/, 'WebSocket'],
  [/sendBeacon/, 'navigator.sendBeacon'],
  [/EventSource/, 'EventSource'],
  [/from\s+['"](node:)?(http|https|net|dgram|tls|child_process)['"]/, 'Node のネットワーク／プロセス API'],
  [/from\s+['"]react/, 'React（エンジンは UI 非依存）'],
  [/\b(window|document|localStorage|indexedDB)\./, 'ブラウザ API'],
];

describe('ガード：エンジンは外部と通信せず、UIにも依存しない', () => {
  for (const f of files(SRC)) {
    it(f.slice(SRC.length + 1), () => {
      const src = readFileSync(f, 'utf8');
      for (const [re, what] of FORBIDDEN) expect(re.test(src), `${what} を使っている`).toBe(false);
      if (f !== CLI) expect(/from\s+['"]node:/.test(src), 'node: モジュールを使っている').toBe(false);
    });
  }
});

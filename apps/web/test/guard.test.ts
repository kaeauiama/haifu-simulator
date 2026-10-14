/**
 * Hard Constraint のガード（D-002）：データを外に送らない。画面のソースは通信 API を使わない。
 * 本番ビルドでは、あわせて CSP で通信先を自分自身に限る（vite.config.ts）。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..', 'src');
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(p) ? [p] : [];
  });

const FORBIDDEN: [RegExp, string][] = [
  [/\bfetch\s*\(/, 'fetch'],
  [/XMLHttpRequest/, 'XMLHttpRequest'],
  [/WebSocket/, 'WebSocket'],
  [/sendBeacon/, 'navigator.sendBeacon'],
  [/EventSource/, 'EventSource'],
  [/https?:\/\/(?!localhost)/, '外部 URL'],
];

describe('ガード：画面は外部と通信しない', () => {
  for (const f of files(SRC)) {
    it(f.slice(SRC.length + 1), () => {
      const src = readFileSync(f, 'utf8');
      for (const [re, what] of FORBIDDEN) expect(re.test(src), `${what} を使っている`).toBe(false);
    });
  }

  it('本番ビルドの CSP は通信先を自分自身に限る', () => {
    const cfg = readFileSync(join(import.meta.dirname, '..', 'vite.config.ts'), 'utf8');
    expect(cfg).toContain(`"connect-src 'self'"`);
    expect(cfg).toContain(`"default-src 'self'"`);
  });
});

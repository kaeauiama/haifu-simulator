import { defineConfig } from '@playwright/test';

/**
 * 画面の主要な流れの E2E（7章「画面は主要な流れだけE2E」）。
 * 本番ビルドを CSP 付きで配信して確かめる。ブラウザは手元の Microsoft Edge を使い、テストごとに新しいプロファイルで動かす。
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4174',
    channel: 'msedge',
    viewport: { width: 1600, height: 1000 },
    locale: 'ja-JP',
  },
  webServer: {
    command: 'npx vite build && npx vite preview --port 4174 --strictPort',
    url: 'http://localhost:4174',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});

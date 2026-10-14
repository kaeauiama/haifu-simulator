# CLAUDE.md
- 仕様は docs/requirements.md。2章（Public Cloudの制約）と5章（計算規則）を変えるときは、実装前に必ず確認を求める
- 計算は packages/engine にだけ書く。apps/web で金額を計算しない
- 金額は円の整数。按分は最大剰余法、同順位はIDの昇順
- engine はテスト先行。テスト名に要件ID（F-xx）、検証ID（V-xx）、テストID（T-xx）を入れる
- 画面の文言は apps/web/src/i18n/ja.ts に集める
- 段階は 8.3 の M0→M6 の順。各段階の終わりに pnpm test を全件通す

## 追記（2026-10-14）
- requirements.md は軽く書いたもの。矛盾や実装との食い違いは積極的に解消して進め、Decision Log に残して requirements.md も直す（D-018）。ただし2章・5章の中身を変える決定は実装前に確認を求める
- 決定と解釈は docs/decisions.md に記録する。決定は D-xxx（新しいものを上に）、5章の隙間を埋める暫定解釈は P-xx、ユーザーが決める未決事項は U-xx。勝手に埋めず、暫定は「暫定」と書く
- P-xx を変えるときは、対応するテストと一緒に変える。確定したら D-xxx に移す
- Hard Constraint：データを外に送らない。engine は通信・ブラウザAPI・React に依存しない（packages/engine/test/guard.test.ts）。web の本番ビルドは CSP で通信先を自分自身に限る（apps/web/vite.config.ts）
- 検証コードの重さと既定文言の単一ソースは packages/engine/src/validate/issues.ts。反復計算の上限などの定数は packages/engine/src/iterative/solve.ts を正とし、文書に数値を直書きしない
- コマンド：`pnpm test` / `pnpm typecheck` / `pnpm sim`（CLI。オプションは packages/engine/src/cli.ts の冒頭）/ `pnpm dev`（画面）/ `pnpm e2e`（本番ビルドを CSP 付きで E2E）/ `pnpm bench`（大きい規模の計測）
- 図に描く線の上限は packages/engine/src/graph/limits.ts、自動配置の上限は apps/web/src/features/flow/layout.ts を正とする

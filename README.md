# 配賦・決済シミュレータ（S/4HANA Cloud Public Edition もどき）

設計ワークショップで、配賦・決済の組み方を描き、金額を流して、パターン同士を比べるブラウザツール。SAP には接続しない単独ツールで、結果は SAP の考え方に沿った「もどき」の仕訳で示す。データはブラウザの外に送らない。

- 仕様：[docs/requirements.md](docs/requirements.md)
- 決定・暫定解釈・未決事項：[docs/decisions.md](docs/decisions.md)

## 準備

Node.js 22 以上と pnpm 10 を使う。pnpm が入っていなければ、どちらかで入れる。

```bash
corepack enable
```

```bash
npm install -g pnpm@10
```

そのあと依存を入れる。

```bash
pnpm install
```

## コマンド

| コマンド | 内容 |
| --- | --- |
| `pnpm test` | 全パッケージのテスト（engine は 8.2 の T-01〜T-13 を含む） |
| `pnpm typecheck` | 型チェック |
| `pnpm sim` | CLI。サンプル商事の全シナリオを実行して要約を出す |
| `pnpm sim -- --scenario S-LATE --journal` | 1シナリオの流れ（送信→受信）を出す |
| `pnpm sim -- --compare S-DEFAULT S-LATE` | 2案の差（利益センタ別・セグメント別・勘定別・対象別、結果が変わったステップ） |
| `pnpm sim -- --trace "CCTR:2000"` | 最終残高の来歴（どの一次仕訳から来たか） |
| `pnpm sim -- --file project.json` | プロジェクト JSON を読んで実行する |
| `pnpm dev` | 画面（開発サーバ。http://localhost:5173） |
| `pnpm build` | 画面の本番ビルド（`apps/web/dist`。CSP 付きの静的ファイル） |

## 構成

```text
packages/engine   計算エンジン（純粋な TypeScript、UI 非依存）。型・Zodスキーマ、台帳、各手法、検証、来歴、比較、シード、CLI
apps/web          画面（React + Vite + Tailwind + shadcn/ui）。エンジンは Web Worker で動かし、画面は金額を計算せず結果を表示する
docs              要件書と Decision Log
```

## 進み具合（8.3）

- [x] M0 土台：リポジトリ、型と Zod スキーマ、YCOA もどきとサンプル会社のシード
- [x] M1 エンジン前半：台帳、利益センタ導出、端数処理、配布、配賦、決済、TDD（T-01〜T-09、T-12、T-13）
- [x] M2 エンジン後半：活動配分、再評価、間接費計算、反復サイクル、検証規則、来歴（T-10、T-11）
- [x] M3 画面の土台：マスタと実績の表編集、締めステップのリスト（ドラッグで並べ替え・オン/オフ）、1ステップずつの実行と巻き戻し、残高表・仕訳・来歴、自動保存、JSON・CSV の入出力
- [ ] M4 フロー図
- [ ] M5 比較と出力
- [ ] M6 仕上げ

# Repository Guidelines

## プロジェクト構成とモジュール

このリポジトリは TypeScript 製の WXT ベース Firefox 拡張です。
実行時の入口は `entrypoints/` にあります。`background.ts` はプロキシ、ストレージ、ブラウザイベントを扱い、`popup/` はポップアップ画面の HTML、TypeScript、CSS を含みます。
共有のプロキシ解析や設定ロジックは `utils/` に置き、現在は `utils/proxy-config.ts` が中心です。
拡張に同梱する静的ファイルは `public/`、アイコンは `public/icon/`、元画像や制作素材は `assets/` に置きます。
`.wxt/` と `.output/` は生成物なので手で編集しないでください。

## ビルド・テスト・開発コマンド

- `pnpm install`: 依存関係をインストールし、`wxt prepare` を実行します。
- `pnpm run dev:firefox`: Firefox MV2 向けに WXT 開発モードを起動します。
- `pnpm run build:firefox`: `.output/` に Firefox 拡張をビルドします。
- `pnpm run zip:firefox`: Firefox 向けビルドを zip 化します。
- `pnpm run compile`: `tsc --noEmit` で型チェックします。
- `pnpm run format`: oxfmt で整形します。
- `pnpm run format:check`: 整形差分がないか確認します。

この拡張は Firefox のコンテナとプロキシ API に依存するため、動作確認は Firefox 向けコマンドを使ってください。

## コーディング規約と命名

TypeScript の ES modules を使い、import は明示的に書きます。
整形は oxfmt を基準にし、80 桁幅、シングルクォート、JSX シングルクォートに従います。
変数と関数は説明的な `camelCase`、interface と type alias は `PascalCase`、モジュール定数は `UPPER_SNAKE_CASE` を使います。
純粋な共有ロジックは `utils/` に置き、entrypoint 側はブラウザ API と UI メッセージングの調整に集中させます。

## テスト方針

現時点では専用の自動テストはありません。
変更前後に `pnpm run compile`、`pnpm run format:check`、`pnpm run build:firefox` を実行してください。
挙動を変える場合は `pnpm run dev:firefox` で手動確認し、ポップアップの設定保存、無効なプロキシテンプレートの拒否、コンテナタブごとの session ID 分離を確認します。

## コミットと Pull Request

履歴では `feat: autosave toggle settings`、`fix: prevent enabling invalid proxy config`、`chore: add oxfmt` のような短い Conventional Commit 形式が使われています。
コミットは小さく保ち、`feat`、`fix`、`chore`、`docs` などの小文字 prefix を使ってください。
PR には概要、実行した検証コマンド、関連 issue、UI 変更時のスクリーンショットまたは録画を含めます。
プロキシ、privacy、権限に関わる変更は明示してください。

## セキュリティと設定

実際のプロキシ認証情報、customer ID、パスワード、生成済み session 値、ローカルのブラウザプロファイルはコミットしないでください。
ログやドキュメントではプロキシ URL を必ず伏せます。
権限や Gecko 固有の manifest 設定を変更する場合は `wxt.config.ts` を慎重に確認してください。

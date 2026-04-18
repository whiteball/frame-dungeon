# CLAUDE.md

このファイルは、このリポジトリでコードを扱う際にClaude Code (claude.ai/code) に対するガイダンスを提供します。

## 開発コマンド

| コマンド | 説明 |
| --------- | ------------- |
| `yarn install` | プロジェクトの依存関係をインストール |
| `yarn run dev` | localhost:8081で開発サーバーを起動 |
| `yarn run build` | dist/フォルダにプロダクションビルドを作成 |

**注意:**

- `lint` / `test` / `typecheck` スクリプトは未定義（ESLint は devDependencies に存在するが未統合）
- パッケージマネージャは `yarn` 前提（`package-lock.json` ではなく `yarn.lock`）

## アーキテクチャ概要

これはPhaser 3、Vue 3、TypeScriptで構築されたダンジョンクローラーゲームです。プロジェクトはVue-Phaserブリッジアーキテクチャを使用しており、VueがUIレイヤーを処理し、Phaserがゲームロジックとレンダリングを管理します。

### 主要コンポーネント

- **Vueレイヤー**: メインアプリケーションラッパー（`App.vue`）とPhaserブリッジコンポーネント（`PhaserGame.vue`）
- **Phaserゲーム**: シーン管理機能を持つコアゲームエンジン（Boot、Preloader、MainMenu、Game、GameOver）
- **EventBus**: VueとPhaser間の通信ブリッジ（`src/game/EventBus.ts`）
- **ゲームロジック**: `src/lib/`内の専門化されたモジュールに分離

### 主要モジュール概要

ゲームロジックは `src/lib/` 配下のモジュール群と `src/game/scenes/Game.ts` で構成されます。各モジュールの責務と関係性の詳細は [docs/architecture.md](docs/architecture.md) を参照のこと。

- **Vue-Phaser通信**: `EventBus.emit` / `EventBus.on` を介する（`src/game/EventBus.ts`）
- **マップ上のオブジェクト**: 階段・トラップ・敵などは全て `MapObject` を継承し、`DungeonMap._objects` で統一管理（`instanceof` で型別フィルタ）
- **データ駆動**: `public/data/*.yml` を対応する Loader クラス（`StatsLoader`、`ItemsLoader`、`EnemyLoader`）が読み込む
- **キー操作**: W=前進、A=左回転、S=後退（180°回転）、D=右回転、スペース=正面の敵を攻撃
- **メッセージログ**: `EventBus.emit('message-log', text)` で発行 → `PhaserGame.vue` の `<textarea>` に表示。戦闘・アイテム・フロア移動など全イベントをこのチャンネルに流すこと

### プロジェクト構造メモ

- `src/game/main.ts`のゲーム設定（1024x768解像度、黒背景）
- Phaserのフレームレートは `target: 20, limit: 20` に固定（アニメーション実装時は 20fps 前提で計算すること）
- `public/assets/`のアセット（Vite経由で読み込み）
- `public/data/`のゲームデータ（YAMLファイル）
- 複数ファイルに分割されたTypeScript設定
- Viteの設定は `vite/config.dev.mjs` と `vite/config.prod.mjs` に分離
- 開発サーバーはポート8081で実行
- UI要素に日本語フォントを使用

### 未実装機能

実装予定のタスクは [TODO.md](TODO.md) を参照のこと。

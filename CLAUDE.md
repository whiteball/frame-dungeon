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

- **Vueレイヤー**: メインアプリケーションラッパー（`App.vue`）、Phaserブリッジコンポーネント（`PhaserGame.vue`）、モーダル類（`src/components/dialogs/`）
- **Phaserゲーム**: シーン管理機能を持つコアゲームエンジン（Boot、Preloader、MainMenu、Game、GameOver、GameClear）
- **EventBus**: VueとPhaser間の通信ブリッジ（`src/game/EventBus.ts`）
- **ゲームロジック**: `src/lib/`内の専門化されたモジュールに分離

### 主要モジュール概要

ゲームロジックは `src/lib/` 配下のモジュール群と `src/game/scenes/Game.ts` で構成されます。各モジュールの責務と関係性の詳細は [docs/architecture.md](docs/architecture.md) を参照のこと。

- **Vue-Phaser通信**: `EventBus.emit` / `EventBus.on` を介する（`src/game/EventBus.ts`）
- **マップ上のオブジェクト**: 階段・トラップ・敵・落ちているアイテムなどは全て `MapObject` を継承し、`MapObjectStore`（`DungeonMap` 経由でアクセス）で統一管理（`instanceof` で型別フィルタ）。`around-0` は踏んだとき自動発火、`around-0-self` は「足下」ボタンで明示発火（`dispatchSelfEvent`）
- **モーダルモード**: `isModalMode`（`currentSceneActions !== defaultSceneActions`）が真のとき全キー入力をブロック。攻撃方向選択・階段確認・トラップ確認・アイテム使用一覧・装備変更などがこれを使用
- **データ駆動 (`base.yml` 中心)**: `public/data/*.yml` を対応する Loader クラス（`BaseLoader`、`StatsLoader`、`ItemsLoader`、`EnemyLoader`、`EffectsLoader`、`TrapsLoader`、`SkillsLoader`）が読み込む。**`base.yml` がゲーム全体の中核設定**で、ダメージ計算式・経験値必要量・レベルアップボーナス・フロア別構成（マップサイズ・敵プール・トラップ数）を formula 文字列として保持する（`expr-eval-fork` で評価）。ハードコードされた戦闘式やレベル式は存在しない
- **カスタムデータ**: ローカル ZIP から YAML 群を差し込む機構（`CustomDataStore` + `PhaserGame.vue` の ZIP UI）。タイトルから「カスタムデータで開始」を選んだ場合 `public/data/` の代わりにこのストアの内容を使用
- **キー操作**: W=前進、A=左回転またはカニ歩き左、S=後退（180°回転）またはカニ歩き後退、D=右回転またはカニ歩き右、Q=カニ歩き左または左回転、E=カニ歩き右または右回転、Shift+S=カニ歩き後退または180°回転（Q/EとA/Dの動作・SとShift+Sの動作はそれぞれ設定ダイアログで入れ替え可能）、スペース=正面の敵を攻撃、M=ミニマップ ズーム/全体 切り替え（ミニマップクリックでも同様にトグル）、C=ステータス表示、1〜0=画面下シーンアクションボタンのショートカット（左から順に割当）。デフォルトのシーンアクションは `[1:スキル, 2:アイテム使用, 3:装備変更, 4:ステータス, 5:足下, 6:セーブ]` の 6 個。回転はターン消費なし、カニ歩き移動はターン消費あり（スタン中不可）。設定は `localStorage('gameSettings')` の `swapQEandAD` / `swapSandShiftS` フラグで永続化
- **メッセージログ**: `EventBus.emit('message-log', text, turnCount?)` で発行 → `PhaserGame.vue` の `<textarea>` に最新50件を表示。戦闘・アイテム・フロア移動・状態異常など全イベントをこのチャンネルに流すこと
- **セーブ/ロード**: `SaveManager` が LocalStorage にスロット単位で保存（`SaveDialog` / `LoadDialog` 経由）。`yamlDigest` でデータ互換性を確認する
- **スキルシステム**: `skills.yml` で定義したスキルをレベルアップ抽選（mastery）またはアイテム使用（`learnSkill` 効果）で習得し、`src/lib/skills/SkillExecutor.ts` 経由でコスト評価・target 解決・action 実行（`attack` / `damage` / `heal` / `reveal_trap`）を行う。スタン中（`_action: skip`）は発動不可。詳細は [docs/architecture.md](docs/architecture.md) のスキルシステム節を参照
- **YAML 横断バリデーション**: `YamlCrossValidator.validate()` が起動直後に走り、`base.yml` の floor 定義と `enemies.yml` / `traps.yml` のクロスリファレンス、および `items.yml` の `learnSkill` 効果と `skills.yml` のクロスリファレンスを検証。エラーは `YamlErrorDialog` に表示

### プロジェクト構造メモ

- `src/game/main.ts`のゲーム設定（1024x768解像度、黒背景）
- Phaserのフレームレートは `target: 20, limit: 20` に固定（アニメーション実装時は 20fps 前提で計算すること）
- `public/assets/`のアセット（Vite経由で読み込み）
- `public/data/`のゲームデータ（YAMLファイル: `base.yml`, `stats.yml`, `items.yml`, `enemies.yml`, `effects.yml`, `traps.yml`, `skills.yml`）
- 複数ファイルに分割されたTypeScript設定
- Viteの設定は `vite/config.dev.mjs` と `vite/config.prod.mjs` に分離
- 開発サーバーはポート8081で実行
- UI要素に日本語フォントを使用
- デバッグ用に `window.applyStatusEffect(name)` / `window.findPath(...)` / `window.learnSkill(name)` / `window.forgetSkill(name)` / `window.listSkills()` / `window.addExp(n)` / `window.levelUpN(n?)` を `Game.create()` でグローバル公開（DevTools コンソールから利用）

### ドキュメント更新ルール

- `src/lib/*Loader.ts` / `src/game/scenes/*.ts` を変更したら、`docs/architecture.md` の該当セクションも同コミットで更新する
- `base.yml` のキーを追加/削除したら `docs/architecture.md` の「base.yml — ゲーム全体設定」表を更新する
- `EventBus` の新イベントを追加したら `docs/architecture.md` の該当イベント一覧表に行を追加する

### 未実装機能

実装予定のタスクは [TODO.md](TODO.md) を参照のこと。

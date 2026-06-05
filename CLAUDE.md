# CLAUDE.md

このファイルは、このリポジトリでコードを扱う際にClaude Code (claude.ai/code) に対するガイダンスを提供します。

## 開発コマンド

| コマンド | 説明 |
| --------- | ------------- |
| `yarn install` | プロジェクトの依存関係をインストール |
| `yarn run dev` | localhost:8081で開発サーバーを起動 |
| `yarn run build` | dist/フォルダにプロダクションビルドを作成 |
| `npx vue-tsc --noEmit -p tsconfig.app.json` | 型チェック（エラー時は終了コード非0・該当行を出力。クリーンなら出力なし・終了コード0） |

**注意:**

- `lint` / `test` / `typecheck` スクリプトは未定義（ESLint は devDependencies に存在するが未統合）
- **型チェックは `npx vue-tsc --noEmit -p tsconfig.app.json` で行う**。`yarn run build`（`vite build`）は esbuild で型を素通りさせるため型エラーを検出しない。また素の `tsc` は `.vue` を解決できず `App.vue` 等で誤った `TS2307` を出すので必ず `vue-tsc` を使う
- 自動テストは無し。動作確認はブラウザ実機（`vue-phaser-browser-verify` スキル）で行う。ただしブラウザに接続できない場合は開発者による手動確認
- パッケージマネージャは `yarn` 前提（`package-lock.json` ではなく `yarn.lock`）

## アーキテクチャ概要

これはPhaser 3、Vue 3、TypeScriptで構築されたダンジョンクローラーゲームです。プロジェクトはVue-Phaserブリッジアーキテクチャを使用しており、VueがUIレイヤーを処理し、Phaserがゲームロジックとレンダリングを管理します。

### 主要コンポーネント

- **Vueレイヤー**: メインアプリケーションラッパー（`App.vue`）、Phaserブリッジコンポーネント（`PhaserGame.vue`）、モーダル類（`src/components/dialogs/`）
- **Phaserゲーム**: シーン管理機能を持つコアゲームエンジン（Boot、Preloader、MainMenu、Game、GameOver、GameClear）
- **EventBus**: VueとPhaser間の通信ブリッジ（`src/game/EventBus.ts`）
- **ゲームロジック**: `src/lib/`内の専門化されたモジュールに分離

### 主要モジュール概要

ゲームロジックは `src/lib/` 配下のモジュール群と `src/game/scenes/Game.ts`（およびその責務別ヘルパー `src/game/scenes/game/` 配下のモジュール群：`SceneModeController` / `ItemListController` / `MapInteractionHandler` / `SaveLoadController` / `FloorPopulator` / `StatusReportBuilder` / `GameDebugCommands`）で構成されます。各モジュールの責務と関係性の詳細は [docs/architecture.md](docs/architecture.md) を起点に、トピック別に [docs/architecture/](docs/architecture/) 配下の各ファイル（`overview.md` / `data.md` / `combat.md` / `items.md` / `gameplay.md` / `skills.md` / `events.md`）を参照のこと。

- **Vue-Phaser通信**: `EventBus.emit` / `EventBus.on` を介する（`src/game/EventBus.ts`）
- **マップ上のオブジェクト**: 階段・トラップ・敵・落ちアイテム・宝箱（`TreasureObject`）・汎用イベント（`EventObject`）は全て `MapObject` 継承で `MapObjectStore`（`DungeonMap` 経由）が統一管理（`instanceof` で型別フィルタ）。`around-0`=踏むと自動発火 / `around-0-self`=「足下」ボタンで明示発火（`dispatchSelfEvent`）。宝箱・visible トラップ・施錠扉の挙動詳細は [combat.md](docs/architecture/combat.md) / [items.md](docs/architecture/items.md)
- **隠し部屋扉のバリアント**: `base.yml.floors[].secretRoomDoorVariants: { plain, locked, lockedDisguised }` の重み付き抽選。施錠扉は `events.yml` の `secret_room_key`（レバー表示）を調査して `unlock_door: self` action で解錠する。詳細は [data.md](docs/architecture/data.md)
- **汎用イベントオブジェクト**: `events.yml` 定義の `EventObject`。**調査専用**（C キー方向選択経由）で発火し `action` / `random_outcome` / `choices`（条件付き表示可）を実行。formula 内で `has_item` / `item_count` / `has_skill` が使える（`src/lib/events/eventFormula.ts`）。action 種別の全リスト・配置仕様は [events.md](docs/architecture/events.md)
- **モーダルモード**: `SceneModeController.isModalMode`（`currentSceneActions !== defaultSceneActions`）が真の間は全キー入力をブロック。攻撃/スキル方向選択・各種確認・調査方向選択・ミニマップ移動・ダイアログ表示中などが該当。詳細は [gameplay.md](docs/architecture/gameplay.md)
- **データ駆動 (`base.yml` 中心)**: `public/data/*.yml` を対応する Loader クラス（`BaseLoader`、`StatsLoader`、`ItemsLoader`、`EnemyLoader`、`EffectsLoader`、`TrapsLoader`、`SkillsLoader`、`ItemModifiersLoader`、`EventsLoader`）が読み込む。全 Loader の初期化は `GameDataLoader.loadAll()`（`src/lib/GameDataLoader.ts`）に集約しており、Game シーンの `create()` から一度だけ呼ぶ。Loader はいずれも Singleton (`getInstance()`) で公開され、`Player` 等のコンシューマは直接 `getInstance()` を参照する。**`base.yml` がゲーム全体の中核設定**で、ダメージ計算式・経験値必要量・レベルアップボーナス・フロア別構成（マップサイズ・敵プール・トラップ数）を formula 文字列として保持する（`expr-eval-fork` で評価）。ハードコードされた戦闘式やレベル式は存在しない
- **アイテム/敵の生成**: `ItemFactory.createItem(name, options?)`（`src/lib/ItemFactory.ts`）と `EnemyFactory.createEnemy(name, x, y)` / `createRandomEnemy(floor, x, y)`（`src/lib/EnemyFactory.ts`）が定義参照とインスタンス化を担当。床配置時の modifier 抽選は `ItemFactory` 内に閉じる
- **カスタムデータ**: ローカル ZIP から YAML 群を差し込む機構（`CustomDataStore` + `PhaserGame.vue` の ZIP UI）。タイトルから「カスタムデータで開始」を選んだ場合 `public/data/` の代わりにこのストアの内容を使用
- **キー操作**: 全操作の一覧は [MANUAL.md](MANUAL.md) を参照。開発上の要点のみ — 回転はターン非消費 / カニ歩き移動はターン消費（スタン中不可）。シーンアクションは数字キー `1〜0` に左から対応（既定 `[スキル, アイテム使用, 装備変更, ステータス, 足下, セーブ]` の 6 個）。設定は `localStorage('gameSettings')` の `swapQEandAD` / `swapSandShiftS` / `debugCommands` フラグで永続化
- **メッセージログ**: `EventBus.emit('message-log', text, turnCount?)` で発行 → `PhaserGame.vue` の `<textarea>` に最新50件を表示。戦闘・アイテム・フロア移動・状態異常など全イベントをこのチャンネルに流すこと
- **フロア長居警告/強制移動**: レベル稼ぎ抑制機構。`base.yml` の `longStay` / `longStayFactor`（既定 4）・floor 個別 `longStayTurns` で規定ターンを設定。50%/75% 超過で「確認」のみのモーダルモード、100% で `Game.ts` が `go-to-next-floor` を強制発火（最終フロアでは無効）
- **セーブ/ロード**: `SaveManager` が LocalStorage にスロット単位で保存（`SaveDialog` / `LoadDialog` 経由）。`yamlDigest` でデータ互換性を確認する
- **スキルシステム**: `skills.yml` 定義 → mastery 抽選 or アイテム使用（`learnSkill` 効果）で習得 → `src/lib/skills/SkillExecutor.ts` がコスト評価・target 解決・action 実行。スタン中は発動不可。パッシブの `toggle: yes` で有効/無効を切替（`Player.disabledSkills` で永続化）。仕様全般は [skills.md](docs/architecture/skills.md)
- **アイテム修飾状態 (modifier)**: `item_modifiers.yml` で定義する装備個体差。装備中のみ `add_stats` / `cannot_unequip` の effect が発動し、`Player.getEffectiveStat` が base → 装備raw → modifier → continuous → permanent の順で合算。詳細は [items.md](docs/architecture/items.md)
- **アイテム投擲**: 「投げる」アクションで装備外アイテムを直線投擲（`src/lib/map/ThrowResolver.ts`）。壁・扉・障害物で停止し床ドロップ、敵命中で消滅して効果発揮。効果優先順位は `throwEffect`（`items.yml`）＞ 武器の仮装備ダメージ（`Player.getThrownWeaponFormulaVars`）＞ 消費アイテムの `applyEffect`/`clearEffect`/数値stat 転用 ＞ 投げ損。射程は `base.yml` の `throwRange`（0=無制限）＋装備/パッシブの `throwRange` ボーナス。詳細は [combat.md](docs/architecture/combat.md) / [items.md](docs/architecture/items.md)
- **YAML 横断バリデーション**: `YamlCrossValidator.validate()` が起動直後に走り、`base.yml` の floor 定義と `enemies.yml` / `traps.yml` のクロスリファレンス、および `items.yml` の `learnSkill` 効果と `skills.yml` のクロスリファレンスを検証。エラーは `YamlErrorDialog` に表示

### プロジェクト構造メモ

- `src/game/main.ts`のゲーム設定（1024x768解像度、黒背景）
- Phaserのフレームレートは `target: 20, limit: 20` に固定（アニメーション実装時は 20fps 前提で計算すること）
- `public/assets/`のアセット（Vite経由で読み込み）
- `public/data/`のゲームデータ（YAMLファイル: `base.yml`, `stats.yml`, `items.yml`, `enemies.yml`, `effects.yml`, `traps.yml`, `skills.yml`, `item_modifiers.yml`, `events.yml`）
- 複数ファイルに分割されたTypeScript設定
- Viteの設定は `vite/config.dev.mjs` と `vite/config.prod.mjs` に分離
- 開発サーバーはポート8081で実行
- UI要素に日本語フォントを使用
- デバッグ用に `window.applyStatusEffect(name)` / `window.applyStatusEffectToEnemy(name, instanceId?)` / `window.findPath(...)` / `window.learnSkill(name)` / `window.forgetSkill(name)` / `window.listSkills()` / `window.addExp(n)` / `window.levelUpN(n?)` / `window.addItemModifier(slot, name, count?)` / `window.removeItemModifier(slot, name)` / `window.listMapItems()` / `window.addItem(name, count?)` / `window.addTestItems()` を `setupDebugCommands(game)`（`src/game/scenes/game/GameDebugCommands.ts`）でグローバル公開（DevTools コンソールから利用）。**設定ダイアログの「デバッグコマンド」がONのときのみ実行される**（`debugCommands` フラグ、初期値OFF）

### ドキュメント更新ルール

- `src/lib/*Loader.ts` を変更したら `docs/architecture/data.md` の該当セクションを、`src/game/scenes/*.ts` を変更したら `docs/architecture/overview.md` または該当トピックのファイル（`combat.md` / `items.md` / `gameplay.md` / `skills.md`）を同コミットで更新する
- `base.yml` のキーを追加/削除したら `docs/architecture/data.md` の「base.yml — ゲーム全体設定」表を更新する
- `EventBus` の新イベントを追加したら関連トピックのファイル（ダイアログ関連は `docs/architecture/overview.md`、アイテム/スキル関連は `docs/architecture/items.md`、その他は該当ファイル）のイベント一覧表に行を追加する

### 未実装機能

実装予定のタスクは [TODO.md](TODO.md) を参照のこと。

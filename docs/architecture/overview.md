# 概観・コアアーキテクチャ

[← 索引へ戻る](../architecture.md)

Vue-Phaser ブリッジ・シーン構成・ダイアログ・マップ系モジュールなど、ゲーム全体の骨格を扱います。

## コアゲームアーキテクチャ

メインゲームロジックは複数のモジュールに分割されています：

- **MapObject**（`src/lib/MapObject.ts`）: マップ上に配置される全オブジェクトの基底クラス。表示マーク定数（`MapMark`）やイベントハンドラの型定義も含む
- **MapGenerator**（`src/lib/MapGenerator.ts`）: `DungeonMap` クラスを公開。マップ状態（壁・フォグ・歩行済み・現在視界・プレイヤー位置）の保持と、視界 (FOV)・移動・回転・ランダム位置抽選など中核ロジックを担当。`clearFogWithinPlayer()` は `_mapFog` の更新に加え `_mapCurrentView` にも現フレームの視界マスを記録し、`mapIterator()` の `inView` フィールドで参照可能。隠し部屋扉の状態は `_disguisedDoors`（壁偽装中）と `_lockedDoors`（施錠中）の 2 つの `Set<string>` で管理し、`isDoorPassable` が両方をチェックして通行/攻撃/経路探索/視界判定を統一的に遮断する。生成・オブジェクト管理・戦闘・デバッグ出力は `src/lib/map/` 配下のヘルパーモジュールに委譲
- **マップ系ヘルパー**（`src/lib/map/`）: `DungeonMap` から責務分離されたモジュール群。詳細は後述「マップ系モジュール構成」を参照
- **MainView**（`src/lib/MainView.ts`）: 透視投影を使用したメインの3Dスタイルダンジョンビューをレンダリング。`render(dun, openDoors?)` の第2引数 `openDoors` に `"x,y,dir"` 形式の文字列セットを渡すと、該当セルの扉を描画しない（開放扉として表示）。`Game.getOpenDoors()` が敵の直接隣接時に生成する
- **MiniMapView**（`src/lib/MiniMapView.ts`）: 探索済みエリアを含む俯瞰ミニマップを表示。`render(dun, showAllEnemies)` の第2引数が `false`（デフォルト）の場合、敵は現在の視界内のみ描画し、探索済みだが視界外のマスには半透明の白マスクを重ねる。`true` の場合は従来通り全敵を描画しマスクも適用しない。`toggleMapMode()` でプレイヤー周囲のみ/マップ全体を切り替え（Mキーまたはミニマップ左クリックで発火）。現在の表示モードは LocalStorage キー `frame_dungeon_minimap_full` に保存され、次回起動時に復元される（未保存時はプレイヤー周囲のみ）。**ズーム移動モード**: `enterMoveMode(offsetX?, offsetY?)` / `exitMoveMode()` / `isMoveMode()` でモード切替。`scroll(dx, dy, dun)` でスクロールオフセットをタイル単位で変化させ（マップ外にクランプ）、`render()` 時に `mapIterator` の `centerOverride` としてプレイヤー位置＋オフセットを渡すことでビューを移動する。全体マップモードからの右クリック入りは `minimapMoveEnteredFromFullMap` フラグで記録し、離脱時に全体マップへ復元する
- **InfoView**（`src/lib/InfoView.ts`）: プレイヤーステータスとフロア情報のUIオーバーレイを管理
- **EquipmentView**（`src/lib/EquipmentView.ts`）: 装備中のスロット（武器・主防具・副防具1/2）をPhaserグラフィックスで描画
- **Player**（`src/lib/Player.ts`）: プレイヤーのステータス、インベントリ、装備、持続効果、状態異常を管理。`getEffectiveFormulaVars()` で base / 装備 / 持続効果 / `permanent` 状態異常を合算した変数辞書を返し、`BaseLoader` の formula 評価に渡される。`getEffectiveResists()` で装備 / 持続効果 / 付与中 status effect の `resist` を集約した「現在新規付与を阻止する effect 名」集合を返す
- **Enemy**（`src/lib/Enemy.ts`）: `MapObject`を継承した敵クラス。ステータス、戦闘ロジック、ターゲット記憶、状態異常 (`activeStatusEffects`) を保持。Player と対称に `applyStatusEffect` / `tickStatusEffects` / `notifyDamageTaken` / `getEffectiveStat` / `getEffectiveFormulaVars` / `getActionDirective` / `getEffectiveResists` を備え、ダメージ計算は基本値ではなく実効値を `BaseLoader` の formula に渡す
- **Item**（`src/lib/Item.ts`）: アイテムの効果と情報を管理
- **Inventory**（`src/lib/Inventory.ts`）: プレイヤーのアイテム所持を管理
- **BaseLoader**（`src/lib/BaseLoader.ts`）: `base.yml` の読み込みとゲーム全体設定（ダメージ式・経験値式・レベルアップボーナス・フロア構成・敵自動湧き判定）を集中管理。詳細は [data.md](./data.md) の「base.yml — ゲーム全体設定」節を参照
- **GameDataLoader**（`src/lib/GameDataLoader.ts`）: 各 Loader の Singleton (`getInstance()`) に対して `loadStats() / loadItems() / loadEnemies() / loadEffects() / loadTraps() / load() / loadSkills() / load()` をまとめて呼ぶ `loadAll()` を提供。Game シーンの `create()` で `YamlCrossValidator.validate()` の直前に一度だけ呼ぶ
- **ItemFactory**（`src/lib/ItemFactory.ts`）: `ItemsLoader` / `ItemModifiersLoader` / `BaseLoader` の Singleton を参照し、`createItem(name, options?)` で `Item` を生成。`options.rollModifiers` 指定時はフロア設定に従って modifier 抽選を行う
- **EnemyFactory**（`src/lib/EnemyFactory.ts`）: `EnemyLoader` の Singleton から `createEnemy(name, x, y)` / `createRandomEnemy(floor, x, y)` で `Enemy` を生成
- **SaveManager**（`src/lib/SaveManager.ts`）: LocalStorage ベースのセーブ/ロード。スロット毎に `meta`/`player`/`dungeon`/`floor` を JSON 化。`yamlDigest` で YAML 互換性を確認
- **CustomDataStore**（`src/lib/CustomDataStore.ts`）: ZIP からロードしたカスタム YAML テキストの一時ストア（モジュールスコープ）。タイトル画面で「カスタムデータで開始」した場合に各 Loader の `customText` 引数として注入される
- **YamlCrossValidator**（`src/lib/YamlCrossValidator.ts`）: 起動時に各 Loader 完了後に走る横断バリデータ。`errors` / `infos` を返し、エラー時は `YamlErrorDialog` でユーザ表示

## ゲームシーン構造

Phaser のシーン構成は `src/game/main.ts` で定義：`Boot` → `Preloader` → `MainMenu` → `Game` ⇄ `GameOver` / `GameClear`。

メインゲームシーン（`src/game/scenes/Game.ts`）は以下を調整します：

- 入力処理（WASD 移動・スペース攻撃・M ミニマップ切替・Shift+M ミニマップズーム移動モード切替・Escape ズーム移動モード離脱・C ステータス表示・1〜0 シーンアクションショートカット）
- 複数ビューのレンダリング（メインビュー、ミニマップ、情報パネル、装備パネル）
- フロア進行とプレイヤー状態管理（`BaseLoader.getFloorConfig(floor)` でサイズ・敵プール・トラップ数を取得）
- UIテキストの日本語フォントレンダリング

`Game.ts` 本体は薄いオーケストレータに留め、責務ごとの実装は `src/game/scenes/game/` 配下のヘルパーモジュールへ委譲します（後述「Game シーンのヘルパーモジュール構成」）。

**ゴール到達処理:** `enterStairMode()` で `this.floor >= BaseLoader.getGoalFloor()` のとき `GameClear` シーンへ遷移。それ以外は階段確認ダイアログ→`floor++`→マップ再生成。

## Game シーンのヘルパーモジュール構成

`src/game/scenes/game/` 配下に Game シーンの責務別ヘルパーを配置しています。`Game.ts` はこれらをフィールドとして保持し、入力ハンドラ・EventBus 受信・default シーンアクションのコールバックから呼び出します。

- **SceneModeController**（`SceneModeController.ts`）: モーダルモード状態機械。`defaultSceneActions` / `currentSceneActions` / `isModalMode` を内部で保持し、攻撃方向選択 / スキル方向選択 / 階段確認 / トラップ確認 / 長居警告 / ミニマップズーム移動 の各 enter/exit を一手に提供。`SceneAction` 型もここから export
- **ItemListController**（`ItemListController.ts`）: アイテム / 装備 / スキル / 設置（drop）一覧 UI の状態管理。`use-item` / `use-skill` / `equip-item` / `close-item-list-request` / `open-drop-list-for-pickup` / `drop-item` の各 EventBus ハンドラ登録と、`toggleList` / `onUnderfoot` / `closeList` の公開メソッドを提供
- **MapInteractionHandler**（`MapInteractionHandler.ts`）: マップ上の対話可能オブジェクトとの相互作用処理（`applyTrapEffects` / `trySearch` / `executeSearch` / `openTreasure`）。「祭壇」「スイッチ」「看板」等の将来の調査ギミックもここに集約する想定。`applyTrapEffects` は踏み発動・トラップ起動モード起動・宝箱トラップ・セーブデータ復元の各経路から呼ばれる
- **SaveLoadController**（`SaveLoadController.ts`）: セーブ / ロード周りの UI 制御。`save-to-slot` / `export-save` / `close-save-dialog` の EventBus ハンドラと、`openSaveDialog` / `buildSaveData` を提供
- **FloorPopulator**（`FloorPopulator.ts`）: `populateFloor({dungeon, floor, callbacks})` 関数として、フロア入室時の初期配置（リサイズ・ビルド・階段・宝箱・トラップ・床アイテム・敵の配置）を一括実行。`go-to-next-floor` イベントハンドラから呼ばれる
- **StatusReportBuilder**（`StatusReportBuilder.ts`）: 表示用 stat マップ構築（`buildDisplayParams`）とステータス画面・リザルト画面のテキスト組み立て（`buildStatusText` / `buildResultText`）を提供する関数群
- **GameDebugCommands**（`GameDebugCommands.ts`）: `setupDebugCommands(game)` で DevTools コンソール用デバッグ関数（`window.listMapItems` / `addItem` / `addEnemyAt(x,y,name?)` / `addTrapAt(x,y,name?)` / `applyStatusEffect` / `learnSkill` 等）を一括登録。設定ダイアログの「デバッグコマンド」フラグが ON のときのみ呼ばれる

`Game.ts` には以下が残置されています：

- Phaser Scene ライフサイクル（`init` / `create` / フィールド宣言）
- キー入力ハンドラ（WASD / Space / Q / E / M / C / Esc / 数字キー）
- ヘルパーのインスタンス生成と `register()` 呼び出し
- `render()` と `executeAction(action)`（攻撃 flash キュー処理）、`renderMinimap()`
- モード遷移の薄いラッパ（`enterStairMode` / `enterTrapConfirmMode` / `enterSkillTargetSelectMode` / `handlePlayerActionDirective` / `tryAttackOrShowDirections`）
- `buildDungeonRestoreCallbacks()`（`populateFloor` とセーブ復元の双方で使用するため Game.ts に集約）
- `pendingSaveData` の `init`→`create` フロー

**マップオブジェクト生成:** `src/lib/map/MapObjects.ts` が `StairsObject` / `TrapObject` / `ItemObject` の `MapObject` 派生クラスを定義し、`src/game/scenes/game/mapObjectFactory.ts` の `buildStairsObject` / `buildTrapObject` が `Game.ts` 側のコールバックと組み合わせてイベントハンドラを差し込む。`ItemObject` は `Enemy` と同様にインスタンス（`Item`）を保持する（`ItemDefinition` ではない）。床に落ちているアイテム自体が個別の状態（修飾状態 modifier 等）を持てるようにするため、生成時に `ItemFactory.createItem(name, options?)` 経由で `Item` を作って `new ItemObject(item)` に渡し、拾得時はその `Item` を再生成せず直接インベントリへ追加する。

## Vue-Phaser通信

通信にはEventBusパターンを使用します：

```typescript
// VueからPhaserへ
EventBus.emit('event-name', data);

// PhaserからVueへ
EventBus.on('event-name', callback);
```

## ダイアログコンポーネント

ゲーム中のモーダルダイアログは `src/components/dialogs/` 配下の Vue コンポーネントとして分離されています。`PhaserGame.vue` は EventBus リスナーで表示フラグ・初期データを管理し、各コンポーネントへ props で渡します。

```text
src/components/dialogs/
  ModalOverlay.vue       共通オーバーレイ外枠（全ダイアログが使用）
  SettingsDialog.vue     設定（視界範囲・フォグ・敵表示）
  StatusDialog.vue       キャラクターステータス表示
  SaveDialog.vue         セーブスロット選択・メモ入力
  LoadDialog.vue         ロードスロット選択・ダイジェスト確認
  YamlErrorDialog.vue    YAMLバリデーションエラー一覧
```

**`ModalOverlay.vue`** は `v-show` によるオーバーレイ背景とダイアログ枠を提供し、`slot` で内部コンテンツを受け取ります。`variant="error"` を指定すると背景・枠線をエラー配色（`#1a0a0a` / `#f55`）に切り替えます。

**各ダイアログの責務分担：**

| コンポーネント | 内部 state | PhaserGame.vue 側で管理する state |
| --- | --- | --- |
| `SettingsDialog` | `localViewRange/Fog/ShowAllEnemies`（`visible` watch でリセット） | `settingsVisible`, `settingsViewRange/Fog/ShowAllEnemies` |
| `StatusDialog` | なし | `statusVisible`, `statusText` |
| `SaveDialog` | `selectedSlot`, `memo`（`visible` watch でリセット） | `saveDialogVisible`, `saveSlotMetas` |
| `LoadDialog` | `digestMismatchVisible`, `digestMismatchSaveData`, `importPendingData`, `importErrorMessage`, `isDragOver` | `loadDialogVisible`, `loadSlotMetas` |
| `YamlErrorDialog` | なし | `yamlErrorVisible`, `yamlValidationErrors` |

**`LoadDialog` のダイジェスト確認フロー：** コンポーネント内で `SaveManager.loadFromSlot()` と `calculateDigest()` を実行し、バージョン不一致時は内部パネルを表示します。ロード確定時のみ `loadConfirmed` emit が発火し、`PhaserGame.vue` が `EventBus.emit('load-game', saveData)` を呼びます。

**`LoadDialog` のインポートフロー：** 「インポート」ボタンの隠し `<input type="file" accept=".sav">` またはダイアログへのドラッグ＆ドロップで `.sav` ファイルを受け取り、`SaveManager.parseImportedText()` で `SaveData` にパースした後、メタ情報（gameName / floor / savedAt / memo）を表示した確認パネルを出します。確認 OK で通常のロード経路（`proceedLoad()` → ダイジェスト検証 → `loadConfirmed` emit）に合流します。パース失敗時は赤枠のエラーパネルを表示します。

**`SaveDialog` のエクスポートフロー：** 「エクスポート」ボタン押下で `exportSave` emit → `PhaserGame.vue` が `EventBus.emit('export-save', { memo })` → `Game.buildSaveData(memo)` で **現在状態** から `SaveData` を構築し、`SaveManager.downloadSaveFile()` でローカル時刻ベースのファイル名 `frame_dungeon_YYYYMMDD_HHMMSS.sav` として `Blob` ダウンロードします。Firefox 互換のため `<a>` を DOM に append → click → remove する手順を踏みます。

**ダイアログ関連の EventBus イベント：**

| イベント名 | 方向 | payload | 用途 |
| --- | --- | --- | --- |
| `open-settings` | Phaser→Vue | `{ viewRange, enableFog, showAllEnemies }` | 設定ダイアログを開く |
| `settings-confirmed` | Vue→Phaser | `{ viewRange, enableFog, showAllEnemies }` | 設定を確定してゲームに反映（`Game.ts` 内部では `revealAll` フィールドに格納） |
| `open-status` | Phaser→Vue | `string` | ステータスダイアログを開く |
| `open-result` | Phaser→Vue | `string` | リザルトダイアログを開く（GameClear/GameOver シーンから発行） |
| `open-save-dialog` | Phaser→Vue | なし | セーブダイアログを開く |
| `save-to-slot` | Vue→Phaser | `{ slot: number, memo: string }` | セーブ実行 |
| `export-save` | Vue→Phaser | `{ memo: string }` | 現在状態を `.sav` ファイルとしてダウンロード |
| `close-save-dialog` | Phaser→Vue | なし | セーブダイアログを閉じる（セーブ完了時） |
| `open-load-dialog` | Phaser→Vue | なし | ロードダイアログを開く |
| `close-load-dialog` | Phaser→Vue | なし | ロードダイアログを閉じる |
| `load-game` | Vue→Phaser | `SaveData` | ロード実行 |
| `yaml-cross-validation-errors` | Phaser→Vue | `string[]` | YAMLエラーモーダルを開く |
| `set-mode-label` | Phaser→Vue | `string` | MainView 上のモードラベルを設定・クリア（空文字でクリア）。攻撃/調査の方向選択モード入退時に `Game.ts` が発行 |

## マップ系モジュール構成

`DungeonMap`（`src/lib/MapGenerator.ts`）は薄いファサードとして以下のモジュール群へ責務を委譲します：

- **MapBuilder**（`src/lib/map/MapBuilder.ts`）: 部屋・通路・壁・扉の生成アルゴリズム。`DungeonMap.build()` から呼ばれ、生成結果（`Rect[]` と `RoomWithCorridors[]`）を返す
- **MapObjectStore**（`src/lib/map/MapObjectStore.ts`）: マップ上のオブジェクト・敵を `Map<integer, MapObject>` で一元管理。プレイヤー位置を引数で受け取り `around-N` イベントをディスパッチ。`Player.tickContinuousEffects()` の呼び出しもここで行う
- **PlayerActions**（`src/lib/map/PlayerActions.ts`）: ターン消費アクションの純粋関数群（`canAttack` / `attackPlayer` / `useConsumableItem` / `changeEquipment`）。`EventBus` を介したメッセージログ通知を集約
- **Pathfinding**（`src/lib/map/Pathfinding.ts`）: A* 法による2点間経路探索（`findPath`）。ゾーン（部屋+通路）の所属判定ユーティリティ（`findContainingZone`、`isInZone`）も公開しており、`DungeonMap` の `isInSameZone` / `getDoorTargetsInZone` から利用される
- **MapDebug**（`src/lib/map/MapDebug.ts`）: `dumpDungeon()` によるコンソール用デバッグ出力（Box-drawing 文字でグリッド描画）
- **MapDirection**（`src/lib/map/MapDirection.ts`）: 方向定数 `MapDirection`（東=0/南=1/西=2/北=3）と `getRandomDirection` / `rotateDirection`
- **Rect**（`src/lib/map/Rect.ts`）: 部屋・通路の矩形プリミティブ。`isContact` で隣接判定
- **random ユーティリティ**（`src/lib/util/random.ts`）: `getRandomInt` と Fisher-Yates の `arrayShuffle`

## マップ生成

ダンジョンは部屋ベースの生成アルゴリズムを使用します（`MapBuilder`）：

- ランダムサイズの矩形の部屋を作成（`makeRoom`）
- 廊下で部屋を接続（`makeCorridor`）
- 壁・扉ビットを設定し、ランダムに部屋を進入禁止化（`setWall`）。進入禁止化後に BFS で非進入禁止部屋の連結性を検証し、孤立したコンポーネントが存在する場合はメインコンポーネントへの最短経路上の進入禁止部屋を解除して全室到達可能を保証する
- 部屋内部に 1x1 の進入禁止セル（障害物）をランダム配置（`placeObstacles`）。基準数 `base = floor(width * height / 50)` に、`[-base, base]` 範囲の三角分布オフセット（重み = `base + 1 - |k|`、`base=2` で `[-2,-1,-1,0,0,0,1,1,2]`、`base=3` で `[-3,-2,-2,-1,-1,-1,0,0,0,0,1,1,1,2,2,3]`）を加算。通路には配置せず、扉の周囲 1 セル (Chebyshev 距離 1) は除外。条件を満たす候補が無い場合はスキップ
- 階段を配置し、フロア遷移を管理
- ミニマップ表示用に探索済みエリアを追跡

# アーキテクチャ詳細

このドキュメントは、Frame Dungeon のゲームシステムの詳細な構成を解説します。概観は [CLAUDE.md](../CLAUDE.md) を参照してください。

## コアゲームアーキテクチャ

メインゲームロジックは複数のモジュールに分割されています：

- **MapObject**（`src/lib/MapObject.ts`）: マップ上に配置される全オブジェクトの基底クラス。表示マーク定数（`MapMark`）やイベントハンドラの型定義も含む
- **MapGenerator**（`src/lib/MapGenerator.ts`）: `DungeonMap` クラスを公開。マップ状態（壁・フォグ・歩行済み・現在視界・プレイヤー位置）の保持と、視界 (FOV)・移動・回転・ランダム位置抽選など中核ロジックを担当。`clearFogWithinPlayer()` は `_mapFog` の更新に加え `_mapCurrentView` にも現フレームの視界マスを記録し、`mapIterator()` の `inView` フィールドで参照可能。生成・オブジェクト管理・戦闘・デバッグ出力は `src/lib/map/` 配下のヘルパーモジュールに委譲
- **マップ系ヘルパー**（`src/lib/map/`）: `DungeonMap` から責務分離されたモジュール群。詳細は後述「マップ系モジュール構成」を参照
- **MainView**（`src/lib/MainView.ts`）: 透視投影を使用したメインの3Dスタイルダンジョンビューをレンダリング
- **MiniMapView**（`src/lib/MiniMapView.ts`）: 探索済みエリアを含む俯瞰ミニマップを表示。`render(dun, showAllEnemies)` の第2引数が `false`（デフォルト）の場合、敵は現在の視界内のみ描画し、探索済みだが視界外のマスには半透明の白マスクを重ねる。`true` の場合は従来通り全敵を描画しマスクも適用しない
- **InfoView**（`src/lib/InfoView.ts`）: プレイヤーステータスとフロア情報のUIオーバーレイを管理
- **EquipmentView**（`src/lib/EquipmentView.ts`）: 装備中のスロット（武器・主防具・副防具1/2）をPhaserグラフィックスで描画
- **Player**（`src/lib/Player.ts`）: プレイヤーのステータス、インベントリ、装備、持続効果、状態異常を管理。`getEffectiveFormulaVars()` で base / 装備 / 持続効果 / `permanent` 状態異常を合算した変数辞書を返し、`BaseLoader` の formula 評価に渡される
- **Enemy**（`src/lib/Enemy.ts`）: `MapObject`を継承した敵クラス。ステータス、戦闘ロジック、ターゲット記憶を保持。ダメージ計算は `BaseLoader` の formula に委譲
- **Item**（`src/lib/Item.ts`）: アイテムの効果と情報を管理
- **Inventory**（`src/lib/Inventory.ts`）: プレイヤーのアイテム所持を管理
- **BaseLoader**（`src/lib/BaseLoader.ts`）: `base.yml` の読み込みとゲーム全体設定（ダメージ式・経験値式・レベルアップボーナス・フロア構成・敵自動湧き判定）を集中管理。詳細は後述「base.yml — ゲーム全体設定」を参照
- **SaveManager**（`src/lib/SaveManager.ts`）: LocalStorage ベースのセーブ/ロード。スロット毎に `meta`/`player`/`dungeon`/`floor` を JSON 化。`yamlDigest` で YAML 互換性を確認
- **CustomDataStore**（`src/lib/CustomDataStore.ts`）: ZIP からロードしたカスタム YAML テキストの一時ストア（モジュールスコープ）。タイトル画面で「カスタムデータで開始」した場合に各 Loader の `customText` 引数として注入される
- **YamlCrossValidator**（`src/lib/YamlCrossValidator.ts`）: 起動時に各 Loader 完了後に走る横断バリデータ。`errors` / `infos` を返し、エラー時は `YamlErrorDialog` でユーザ表示

## ゲームシーン構造

Phaser のシーン構成は `src/game/main.ts` で定義：`Boot` → `Preloader` → `MainMenu` → `Game` ⇄ `GameOver` / `GameClear`。

メインゲームシーン（`src/game/scenes/Game.ts`）は以下を調整します：

- 入力処理（WASD 移動・スペース攻撃・M ミニマップ切替・C ステータス表示・1〜0 シーンアクションショートカット）
- 複数ビューのレンダリング（メインビュー、ミニマップ、情報パネル、装備パネル）
- フロア進行とプレイヤー状態管理（`BaseLoader.getFloorConfig(floor)` でサイズ・敵プール・トラップ数を取得）
- UIテキストの日本語フォントレンダリング

**ゴール到達処理:** `enterStairMode()` で `this.floor >= BaseLoader.getGoalFloor()` のとき `GameClear` シーンへ遷移。それ以外は階段確認ダイアログ→`floor++`→マップ再生成。

**マップオブジェクト生成:** `src/lib/map/MapObjects.ts` が `StairsObject` / `TrapObject` / `ItemObject` の `MapObject` 派生クラスを定義し、`src/game/scenes/mapObjectFactory.ts` の `buildStairsObject` / `buildTrapObject` が `Game.ts` 側のコールバックと組み合わせてイベントハンドラを差し込む。

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
| `LoadDialog` | `digestMismatchVisible`, `digestMismatchSaveData` | `loadDialogVisible`, `loadSlotMetas` |
| `YamlErrorDialog` | なし | `yamlErrorVisible`, `yamlValidationErrors` |

**`LoadDialog` のダイジェスト確認フロー：** コンポーネント内で `SaveManager.loadFromSlot()` と `calculateDigest()` を実行し、バージョン不一致時は内部パネルを表示します。ロード確定時のみ `loadConfirmed` emit が発火し、`PhaserGame.vue` が `EventBus.emit('load-game', saveData)` を呼びます。

**ダイアログ関連の EventBus イベント：**

| イベント名 | 方向 | payload | 用途 |
| --- | --- | --- | --- |
| `open-settings` | Phaser→Vue | `{ viewRange, enableFog, showAllEnemies }` | 設定ダイアログを開く |
| `settings-confirmed` | Vue→Phaser | `{ viewRange, enableFog, showAllEnemies }` | 設定を確定してゲームに反映 |
| `open-status` | Phaser→Vue | `string` | ステータスダイアログを開く |
| `open-save-dialog` | Phaser→Vue | なし | セーブダイアログを開く |
| `save-to-slot` | Vue→Phaser | `{ slot: number, memo: string }` | セーブ実行 |
| `close-save-dialog` | Phaser→Vue | なし | セーブダイアログを閉じる（セーブ完了時） |
| `open-load-dialog` | Phaser→Vue | なし | ロードダイアログを開く |
| `close-load-dialog` | Phaser→Vue | なし | ロードダイアログを閉じる |
| `load-game` | Vue→Phaser | `SaveData` | ロード実行 |
| `yaml-cross-validation-errors` | Phaser→Vue | `string[]` | YAMLエラーモーダルを開く |

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
- 壁・扉ビットを設定し、ランダムに部屋を進入禁止化（`setWall`）
- 階段を配置し、フロア遷移を管理
- ミニマップ表示用に探索済みエリアを追跡

## データ駆動設計

ゲームデータはYAMLファイルで管理されています：

- **base.yml**（`public/data/base.yml`）: ゲーム全体の中核設定。ゲーム名・最終フロア・ダメージ式・経験値式・レベルアップボーナス・フロア毎構成・敵自動湧き判定式を保持。詳細は後述「base.yml — ゲーム全体設定」参照
- **stats.yml**（`public/data/stats.yml`）: プレイヤーのステータス定義（HP、MP、攻撃力、防御力など）
- **items.yml**（`public/data/items.yml`）: アイテム定義（武器、防具、消耗品）
- **enemies.yml**（`public/data/enemies.yml`）: 敵の定義（HP、攻撃力、防御力、経験値、表示色）。`walk` フィールドで移動パターンを指定（後述「敵システム」参照）
- **effects.yml**（`public/data/effects.yml`）: 状態異常/強化効果の定義（毒、麻痺、睡眠、強化など）
- **traps.yml**（`public/data/traps.yml`）: トラップの定義（トゲの床、毒の沼、装備解除罠など）
- **skills.yml**（`public/data/skills.yml`）: スキル定義（コスト・ターゲット・action 列・習得条件）。詳細は後述「スキルシステム」参照

各データファイルは対応するLoaderクラス（`BaseLoader`、`StatsLoader`、`ItemsLoader`、`EnemyLoader`、`EffectsLoader`、`TrapsLoader`、`SkillsLoader`）によって読み込まれます。

### Loader クラスと YamlDefinitionStore

`StatsLoader` / `ItemsLoader` / `EnemyLoader` / `EffectsLoader` / `TrapsLoader` / `SkillsLoader` はシングルトンパターンを持つクラスで、固有のバリデーションとドメイン固有ゲッターのみを実装します。fetch・YAMLパース・格納・基本ゲッターの共通処理は `YamlDefinitionStore<T>`（`src/lib/YamlDefinitionStore.ts`）に委譲されます（コンポジション）。

`BaseLoader` は単一スカラー/フォーマット混在の構造（`floors[]` 配列、複数 formula、スカラー定数）のため `YamlDefinitionStore` に乗らず独自に fetch/parse する。

```text
StatsLoader ──────┐
ItemsLoader ──────┤
EnemyLoader ──────┼─── YamlDefinitionStore<T>（fetch / parse / store / getAll / getByName）
EffectsLoader ────┤
TrapsLoader ──────┤
SkillsLoader ─────┘

BaseLoader ───────── 独自実装（fetch / parse / formula コンパイル）
```

`YamlDefinitionStore<T extends { name: string }>` が提供するメソッド：

| メソッド | 概要 |
| --- | --- |
| `load(filePath, dataLabel, validate, options?)` | fetch → YAML パース → バリデーション → 格納。エラー時は `alert` + throw |
| `getAll()` | 全定義の配列コピーを返す |
| `getByName(name)` | 名前で1件取得（Map ルックアップ） |
| `getNames()` | 全名前の配列を返す |
| `has(name)` | 名前の存在確認（`EffectsLoader.hasEffect()` が使用） |

**ファイル不存在・空ファイルの扱い:**

`stats.yml` 以外のデータファイルは存在しなくても起動可能です（敵なし・アイテムなし等のカスタムダンジョン）。`load()` の `options.required` で挙動を切り替えます：

- `required: false`（デフォルト）: 不存在・空・空配列のとき `console.log` して空状態で続行
- `required: true`（`StatsLoader` のみ使用）: 不存在・空・空配列でも `alert` + throw

不正な定義（必須キー欠落など）は `required` の値によらず常に `alert` + throw となります。

**EffectsLoader の特殊構成:**

`EffectsLoader` は `YamlDefinitionStore<EffectDefinition>` に加え、`compiledByName: Map<string, CompiledEffect>` を独自に保持します。`loadEffects()` では `store.load()` 完了後に全エントリの数式を `expr-eval-fork` でコンパイルし、`getCompiledEffect(name)` で高速参照できるようキャッシュします。

## base.yml — ゲーム全体設定

`base.yml` はゲームの根幹挙動（戦闘式・成長式・フロア構成）を定義する **必須** データファイル。すべての formula 文字列は `expr-eval-fork` の `Parser` で起動時にコンパイルされ、`Expression` としてキャッシュされる。

### スカラー設定

| キー | 必須 | フォールバック | 用途 |
| --- | --- | --- | --- |
| `name` | 任意 | `'Dungeon Game'` | タイトル・セーブメタの `gameName` |
| `goalFloor` | 任意 | `10` | このフロアの階段で `GameClear` シーンへ遷移 |
| `defaultDamageStat` | **必須** | — | プレイヤー死亡判定・トラップダメージ等のデフォルト対象ステータス名（通常 `life`） |
| `defaultEnemyDamageStat` | 任意 | `defaultDamageStat` | 敵側のダメージ対象 |

### 死亡判定 (`dead` / `enemyDead`)

```yaml
dead:
  use: [life]              # （ドキュメント目的、実装は formula から自動解決）
  formula: "life <= 0"     # 真のとき死亡
```

`enemyDead` は省略時 `dead.formula`、それも無ければ「`defaultEnemyDamageStat` <= 0」にフォールバック。

### ダメージ計算 (`damageToPlayer` / `damageFromPlayer`)

両方とも **必須**。formula 内で `player_<stat>` / `enemy_<stat>` プレフィックス付きで両者のステータスを参照可能。結果は `Math.max(1, Math.floor(...))` でクランプ。

```yaml
damageFromPlayer:
  player: { use: [power] }
  enemy:  { use: [defense] }
  formula: "player_power - enemy_defense / 2"
```

`use` セクションはドキュメント上の依存宣言で、実装では参照されない（formula 内に書かれた変数名で動的に解決）。

### 経験値式 (`requiredExp`) — 必須

```yaml
requiredExp:
  use: [level]
  formula: "level * 50"
```

`Player.expToNextLevel()` が `getFormulaVars()`（プレイヤーの実効ステータス + `level` + `exp`）を引数に評価。

### レベルアップボーナス (`levelUpBonus`)

配列。各エントリは `{ target, formula, reset? }`：

- `target`: ステータス名
- `formula`: 加算量。current 値で評価される
- `reset: yes` （または `true`）: `stats.yml` で fluctuation 許可されているステータスのとき、最大値増分後に現在値を最大値に揃える（HP 全回復など）

`fluctuation` 非対応ステータスでは `addStat()` 経由で base に加算。

### フロア毎構成 (`floors`)

配列。各要素は `{ <floorNum>: FloorConfigRaw }` のマップ。`getFloorConfig(floor)` は **指定フロア以下で最大のキー** を採用し、結果を `resolvedCache` にキャッシュ。

```yaml
floors:
  - 1:
      size: 15                  # number か { w, h }
      enemyCount: 4             # ランダム敵の追加湧き目標
      enemies:                  # 名前文字列 → ランダムプール、{ name, count } → 固定配置
        - slime
        - { name: ogre, count: 1 }
      trapCount: 0              # number か { min, max }
      traps: [spike, swamp]     # トラップ候補プール（空可）
```

`enemies` 内で `enemies.yml` に存在しない名前は warn + スキップ。`traps` も同様。`trapCount > 0` で `traps` が空の場合は warn のみ。

### 敵自動湧き判定 (`autoSpawner`)

ランダム敵プールから敵を抽選する際、敵が当該フロアに「相応しいか」を判定する formula：

```yaml
autoSpawner:
  use: [currentFloor, life]
  formula: "currentFloor <= 2 ? life <= 40 : ..."
```

利用可能な変数：敵の全ステータス（`life`, `power`, `defense` ...）+ `currentFloor` + `maxFloor` + `rank` / `minRank` / `maxRank`。formula 省略時は「`rank / (maxRank - minRank) * maxFloor <= currentFloor`」というデフォルト式。

### カスタムデータでの上書き

`CustomDataStore.set('base', text)` で ZIP からのカスタム `base.yml` を注入可能。`BaseLoader.load(customText)` がこのテキストを優先採用する（fetch をスキップ）。

## マップオブジェクトシステム

マップ上に配置されるオブジェクト（階段、トラップ、敵など）は`MapObject`基底クラスで統一管理されます：

- **MapObject**（`src/lib/MapObject.ts`）: 全オブジェクトの基底クラス。座標、表示マーク、色、イベントハンドラなどを保持
- **MapMark定数**: オブジェクトの表示形状を定義（`CIRCLE`, `STAR`, `DIAMOND`, `CROSS`, `X_CROSS`）
- **MapObjectStore**（`src/lib/map/MapObjectStore.ts`）: 全オブジェクトを `Map<integer, MapObject>` で一元管理。`instanceof` で型別のフィルタリングが可能。`DungeonMap` は同名の薄い委譲メソッド（`addEnemy`、`getEnemy`、`removeEnemy` など）を公開する

## 敵システム

敵システムの構成：

- **EnemyLoader**: `enemies.yml`から敵データを読み込み、フロアに応じた敵を提供
- **Enemy**: `MapObject`を継承した敵クラス。座標は`MapObject`のプロパティとして自身が保持するため、敵の移動時にキーの差し替えが不要。`target` フィールド（プライベート）でターゲット座標を保持し、ターン間で持続する
- **DungeonMap / MapObjectStore**: 敵を他のオブジェクトと統一管理（`addEnemy`、`getEnemy`、`removeEnemy` などを `DungeonMap` 経由で呼び出すと `MapObjectStore` に委譲。`instanceof Enemy` によるフィルタリングを内部で実施）
- **Game Scene**: フロアごとに敵を自動生成・配置（フロア数に応じて難易度調整）

敵は3Dビュー上で球体（ダイアモンド形マーク）として表示され、各敵は`enemies.yml`で定義された色で描画されます。

### 敵の移動パターン（`walk` フィールド）

`enemies.yml` の各エントリに `walk` フィールドを指定することで、敵ごとに移動AIを切り替えられます（未指定時は `default`）：

| 値 | 動作 |
| --- | --- |
| `default`（未指定） | **パターン移動**: 扉の先をターゲットに巡回。視線が通るプレイヤーがいれば追跡。A*経路探索（`DungeonMap.findPath()`）で移動 |
| `random` | **ランダムウォーク**: 東西南北＋その場の5択をランダム選択 |
| `none` | **移動なし**: 定位置に留まり、プレイヤーが `canAttack` 判定圏内に入ったときのみ攻撃 |

`default` モードの詳細な処理順序：

1. `canAttack()` が真 → 攻撃して終了
2. すでにターゲット到達している → ターゲットをクリアして処理を継続（新たなターゲットを探索）
3. `hasLineOfSight(敵, プレイヤー)` が真 → ターゲットをプレイヤー位置に更新
4. `hasLineOfSight(敵, プレイヤー)` が偽で同ゾーン内にターゲットがある → 現在のターゲットに隣接した部屋の外があればそれをターゲットに更新
5. ターゲットなし → `getDoorTargetsInZone(敵位置)` で扉出口候補を取得し、Mooreネイバーフッド（チェビシェフ距離1）外からランダム選択
6. ターゲット設定不能 → ランダムウォーク（フォールバック）
7. `findPath(現在地, ターゲット)` で経路取得 → 先頭方向へ1歩移動。到達不能時はターゲットをクリアしてランダムウォーク
8. ターゲット到達 → ターゲットをクリア

関連する `DungeonMap` の公開メソッド：

- `hasLineOfSight(x1, y1, x2, y2)`: 2点間に壁・扉がなく視線が通るかを直線走査（DDA）で判定
- `getDoorTargetsInZone(enemyX, enemyY)`: 敵位置から壁・扉のない境界を BFS で展開し、視覚的に繋がった開放空間内の全扉から1マス外側の座標リストを返す

## 戦闘システム

### ターンの流れ

1. プレイヤーがスペースキーを押す → `DungeonMap.attackPlayer()` を呼び出す
2. 正面座標の敵を取得し、`canAttack()` で壁チェックを行う
3. ダメージ計算: `BaseLoader.calculateDamageFromPlayer(playerVars, enemyVars)` が `base.yml` の `damageFromPlayer.formula` を評価（`Math.max(1, Math.floor(...))` クランプ）
4. 敵が死亡した場合（`BaseLoader.isEnemyDead` 判定）: マップから除去し、`player.addExp()` で経験値付与
5. `dispatchObjectEvent()` を呼び出し、隣接する敵の反撃ターンを処理
6. 敵の反撃: `around-1` イベントが `canAttack()` を通過した場合のみ攻撃。ダメージは `BaseLoader.calculateDamageToPlayer` を経由
7. プレイヤー死亡時（`BaseLoader.isDead`）: `EventBus.emit('game-over')` → GameOver シーンへ遷移

### 壁越し攻撃の判定（`DungeonMap.canAttack()`）

隣接する2セル間の攻撃可否を判定します（実装は `src/lib/map/PlayerActions.ts` の `canAttack`、`DungeonMap.canAttack()` から委譲）：

- **縦横方向**: 出発点からその方向に壁があれば攻撃不可
- **斜め方向**: 角を回る2本のL字経路（横→縦 / 縦→横）のうち、**少なくとも1本が通れれば攻撃可**。両方とも壁で塞がれている場合のみ攻撃不可

```text
例1: 縦壁越し → 攻撃不可      例2: L字（1本通れる）→ 攻撃可
　プ                            プ壁
壁壁壁                          　　敵
　敵
```

### 経験値・レベルアップ（`Player`）

- `player.addExp(amount): { levels: Array<{ level, learnedSkills }> }` — 経験値を加算し、各レベルアップの結果（到達レベルとそこで mastery 抽選により新規習得したスキル名）を順序付きで返す
- `player.levelUp(): string[]` — 直接 1 段階レベルアップする。今回のレベルアップで新規習得したスキル名を返す
- 必要経験値: `BaseLoader.getRequiredExp(vars)` が `base.yml` の `requiredExp.formula` を評価（既定の `base.yml` では `level * 50`）
- レベルアップ時の上昇量: `base.yml` の `levelUpBonus` 配列で完全に設定駆動。`reset: yes` が付いていて fluctuation 対応のステータスは最大値増分後に現値を最大値へ揃える（既定では `life` の HP 全回復）
- mastery 抽選: `skills.yml` の各スキルに対し、未習得かつ post-level >= `least` を満たすエントリのうち `least` が最大のものを採用し、その `rate` で `Math.random()` 抽選。`exact: N` は `{ least: N, rate: 1 }` の省略表記として SkillsLoader 内で正規化される。複数レベルアップ時（`addExp` で N → N+3 等）は各 `levelUp` ごとに抽選が走る

### メッセージログ（`PhaserGame.vue`）

戦闘・その他のゲームイベントは `EventBus.emit('message-log', message)` で発行し、`PhaserGame.vue` の Vue リアクティブ変数に蓄積します。ゲームキャンバス下部の `<textarea readonly>` に最新50件を表示します（テキスト選択・コピー可能）。

アイテム取得・フロア移動など、将来のイベントも同じ `'message-log'` イベントを使用してください。

## アイテムシステム

アイテムシステムの構成：

- **ItemsLoader**: `items.yml`からアイテムデータを読み込み
- **Item**: 個別のアイテムインスタンスを管理
- **Inventory**: プレイヤーのアイテム所持を管理（容量制限あり）
- **Player**: 装備スロット管理と装備ボーナス計算。`applyImmediateEffect()` で消耗品の即座効果を能力値へ反映（`addStat` の fluctuation クランプを経由）。`applyContinuousEffect()`/`tickContinuousEffects()` で持続効果を独立エントリ管理。`getEffectiveStat(key)` は基本値+装備ボーナス+持続効果ボーナスの合算を返し、戦闘・表示の両方で使用

アイテムタイプ：

- `weapon`: 武器（攻撃力ボーナス）
- `main_armor`: メイン防具（防御力ボーナス）
- `sub_armor`: サブ防具（指輪など、2スロット）
- `consumable`: 消耗品（即座効果・持続効果）

### 消耗品の使用フロー

1. シーン下部の「アイテム使用」ボタン押下またはショートカットキー押下で `Game.toggleItemList()` が呼ばれる
2. `openItemList()` が `Inventory.getConsumableItems()` で一覧を取得し、EventBus `'open-item-list'` で Vue 側へ渡す。同時に `this.input.keyboard.enabled = false` で Phaser キー入力を停止
3. Vue 側（`PhaserGame.vue`）は textarea 右隣に `<ul>` を表示し、フォーカスを奪う。↑↓/Enter/ESC、ダブルクリック、「使用」「キャンセル」ボタンで操作
4. 「使用」確定時、Vue は EventBus `'use-item'` を `{ instanceId }` 付きで発行
5. Game シーンが受け取り `DungeonMap.useConsumableItem(instanceId)` を呼び出す：
   - 即座効果（`immediate`）がある場合は `Player.applyImmediateEffect()` を実行
   - 持続効果（`continuous`）がある場合は `Player.applyContinuousEffect(effect, label)` で `activeContinuousEffects` に新規エントリを追加（同じアイテムを複数回使用しても合算せず別エントリとして独立保持）
   - 両方とも無いアイテムの場合のみログ表示のみでターン非消費
   - 効果適用後 `Inventory.removeItemById()` → `dispatchObjectEvent()`（敵の反撃ターン）
6. 使用後、残りの消耗品があれば一覧を更新再描画、なければ `closeItemList()` で UI を閉じる
7. `closeItemList()` は `resetKeys()` で Phaser Key 状態をクリアしてから `keyboard.enabled = true` に戻す（`enabled=false` 中に取りこぼした keyup により `Key.isDown` が固定される副作用の対策）

### ImmediateEffect で扱える特殊キー

| キー | 内容 |
| --- | --- |
| `<stat>: number` | 能力値変動（`addStat` 経由、fluctuation クランプ） |
| `applyEffect: <effectName>` | 状態異常を付与（`effects.yml` 参照） |
| `clearEffect: <effectName>` | 状態異常を解除 |
| `learnSkill: <skillName>` | スキルを習得（`skills.yml` 参照、既習得時はログ「習得済み」のみだがアイテムは消費。同 `ImmediateEffect` 内で他効果と併記可） |

### 持続効果のターン進行

`DungeonMap.dispatchObjectEvent()` は player の行動 → 敵反撃 を処理した最後で `Player.tickContinuousEffects()` を呼び、各エントリの残ターン数を1減らします。残ターン数が 0 以下になったエントリは削除され、「○○の効果が切れた」とログ出力されます。

回転（`turnLeftPlayer`/`turnRightPlayer`/`turnBackPlayer`）は `dispatchObjectEvent` を呼ばずターン非消費のため、持続効果も進行しません。

`turns: N` の効果は使用ターンを 1 ターン目として N ターン目までアクティブで、N+1 ターン目のプレイヤー行動時には既に切れている挙動になります（tick が敵反撃の後に行われるため、使用と同ターンの敵反撃にもバフ/デバフが乗る）。

## 状態異常/強化システム

`effects.yml` で定義された data-driven な状態異常/強化を管理します。アイテム使用時の持続効果（`activeContinuousEffects`、固定値ボーナス × 残ターン数）とは別系統で並存します。

### 効果定義（effects.yml）

```yaml
- name: poison              # 識別子
  label: 毒                  # 表示名
  description: 徐々にダメージを受ける
  effects:
    onTurnEnd:              # ターンカウンタ加算直前に発動
      target: life          # 変化対象のパラメータ名
      formula: "(x - 5) <= 0 ? 1 : (x - 5)"  # 数式（x = 現在値）
  clear:
    formula: "(count ** 2) * 0.1"  # 0〜1 の確率（count = 経過ターン数）
```

発動タイミング：

- `onPlayerAction`：プレイヤー入力受付前
- `onTurnEnd`：ターン終了時（`dispatchObjectEvent` 内、`tickContinuousEffects` の後）
- `permanent`：常時（`Player.getEffectiveStat` 計算時に formula を順次適用）

特殊 target：

- `_action: skip`：プレイヤーの W/Space 入力を無視してターン消費（麻痺・睡眠）

`clear` セクション：

- `formula`：`count` を変数とした 0〜1 の確率式。ターン終了時（`onTurnEnd` 適用後 → `count++` の後）に評価
- `onDamage: true`：プレイヤーがダメージを被弾した時にも即座に解除

数式評価には `expr-eval-fork` ライブラリを使用。`Parser` で事前パースして `Expression` をキャッシュします（`EffectsLoader.getCompiledEffect`）。

### 主要 API（Player）

- `applyStatusEffect(name)`：効果を付与。同名効果が既にあれば `count` を 0 にリセット（重複は 1 エントリのみ）
- `getPlayerActionDirective()`：`_action: skip` などのディレクティブを返す
- `tickStatusEffects()`：onTurnEnd 効果適用 → `count++` → clear 判定。`MapObjectStore.dispatchEvent` から呼ばれる
- `notifyDamageTaken()`：被弾時に `clear.onDamage: true` のエントリを即座に解除。`Enemy` の around-1 攻撃ハンドラから呼ばれる
- `getEffectiveStat(key)`：base + 装備 + 持続効果ボーナスに加え、`permanent` 効果の formula を順次適用した値を返す
- `getActiveStatusEffects()`：UI 表示用のスナップショット（label, description, count）

### `count` の進行ルール

- 効果適用時は `count = 0`
- `tickStatusEffects` の処理順序：(1) onTurnEnd を `count` 現在値で適用 → (2) `count++` → (3) clear 判定
- 例：stun の `count > 1 ? 1 : 0` は適用ターン末で `count=1`（解除されず）、次ターン onPlayerAction で skip → そのターン末で `count=2`（解除）→ "1 ターン動けない" と一致

### デバッグ用付与

`Game.create()` で `window.applyStatusEffect(name)` を公開しているため、ブラウザの DevTools コンソールから動作確認可能です。トリガ機構（罠・敵・アイテム経由）はフレームワーク外で個別に実装します。

### EventBus イベント一覧（アイテム使用関連）

| イベント名 | 方向 | payload | 用途 |
| --- | --- | --- | --- |
| `open-item-list` | Phaser→Vue | `{ items: Array<{ id, label, description, ... }>, mode, actionLabel }` | 一覧 UI を開く・再描画する。`mode` は `'item' / 'equip' / 'drop' / 'skill'` |
| `close-item-list` | Phaser→Vue | なし | 一覧 UI を閉じる確定通知 |
| `close-item-list-request` | Vue→Phaser | なし | Vue 側（ESC/キャンセル/外側トリガ）からのクローズ要求 |
| `use-item` | Vue→Phaser | `{ instanceId: string }` | アイテム使用確定 |
| `use-skill` | Vue→Phaser | `{ skillName: string }` | スキル発動確定 |

## トラップシステム

`traps.yml` で定義された data-driven なトラップを `Game.ts` でフロアごとに 10 個ランダム配置します。各位置には `TrapsLoader.getTraps()` から均等ランダムで 1 種を選択。

### YAML 構造

```yaml
- name: spike
  label: トゲの床
  description: トゲが生えた床
  effect:
    - type: stat
      target: life
      value: -10
```

`effect` は配列。各要素は `{ type: string, target?: string, value?: string | number }` で、以下の type をサポート：

- `stat`：ステータス変動（target: ステータス名、value: number）。`Player.addStat(target, value)` を経由。`target === 'life' && value < 0` の場合は従来のダメージ形式ログ + `notifyDamageTaken()` + 死亡時 `game-over`、それ以外は汎用的な変動ログ
- `addEffect`：状態異常付与（value: string、effects.yml の effect 名）。`Player.applyStatusEffect(value)` を経由
- `unequip`：weapon / main_armor / sub_armor1 / sub_armor2 の全スロットを解除（装備中のもののみ）

複数 effect がある場合は配列順に全て適用。`stat` で life が 0 以下になった場合は早期 return で後続を打ち切る。

### 発動条件

未発見状態（`object.visible === false`）で踏んだときのみ effect が発動し、`visible = true` になります。一度踏んで visible になったトラップは、再度踏んでも何も起きません。

### 関連ファイル

- **TrapsLoader**（`src/lib/TrapsLoader.ts`）: traps.yml の読み込み + 検証 + ランダム取得
- **Game.ts**: `addTrapMapObject(x, y, trapDef)` でトラップ配置、`applyTrapEffects(trapDef)` で effect 配列を順次処理

## シーンアクションボタン

シーンごとの操作ボタン（画面下部の「アイテム使用」「ステータス」等）は `EventBus.emit('scene-actions', [{ label, onClick }, ...])` で発行します。`PhaserGame.vue` が受け取り、ボタン列として左寄せで表示します。

Game シーンのデフォルト SceneActions は `[スキル, アイテム使用, 装備変更, ステータス, 足下, セーブ]` の 6 ボタンで、数字キー `1`〜`6` に対応します。数字キー `1〜0`（10 個まで）を左から順に割り当てます（`Phaser.Input.Keyboard.KeyCodes.ONE`〜`ZERO` を `addKey` で登録し、`down` イベントで該当 `onClick` を呼び出す）。アイテム一覧表示中は `keyboard.enabled = false` によりこれらのショートカットも自動的に無効化されます。

### 足下アクション

「足下」ボタン（または `4` キー）は `DungeonMap.dispatchSelfEvent()` を呼び出します。プレイヤーの現在マスに `around-0-self` イベントを持つオブジェクトがあればそのイベントを発火します。対応オブジェクトがない場合は `openDropList()`（アイテム設置フロー）を起動します。足下アクションはターン非消費です。

### モーダルモードとキーブロック（`isModalMode`）

`Game` シーンは `isModalMode` ゲッター（`currentSceneActions !== defaultSceneActions`）でモーダル状態を判定し、W/A/S/D/スペースキーの入力を一律ブロックします。以下の状態が該当します：

- **攻撃方向選択**: 正面斜め方向に複数敵がいるとき「左/中央/右/キャンセル」を表示
- **階段確認**: 階段マスを踏む（`around-0`）または足下アクション（`around-0-self`）で `enterStairMode` → 「進む/やめる」
- **トラップ確認**: 既知のトラップで足下アクションを使用したとき `enterTrapConfirmMode` → 「起動/やめる」

各モードの終了（「やめる」「キャンセル」含む）で `setSceneActions(defaultSceneActions)` を呼び、`isModalMode` が偽に戻ります。

### `around-0-self` イベント

`'around-0'`（プレイヤーが踏んだとき自動発火）とは別に、`'around-0-self'` を登録すると「足下アクション」による明示的な発火が可能です。`MapObjectStore.dispatchSelfEvent()` / `DungeonMap.dispatchSelfEvent()` がプレイヤー位置のオブジェクトを走査して呼び出します。階段とトラップはどちらのイベントも持ち、踏む・足下どちらからでも同じダイアログを起動します。

## セーブ/ロード

`SaveManager`（`src/lib/SaveManager.ts`）が LocalStorage にスロット単位でセーブデータを保存・読込します。

### データ構造

`SaveData` は以下のサブ構造から構成：

- `meta`: `savedAt` / `memo` / `gameName` / `yamlDigest`
- `floor`: 現在フロア
- `player`: `PlayerSaveData`（レベル・経験値・stats/maxStats・インベントリ・装備 ID・持続効果・状態異常・習得スキル）
- `dungeon`: `DungeonSaveData`（マップ・フォグ・歩行済み・プレイヤー位置/向き・ターン数・部屋構造・全オブジェクト・全敵）

### yamlDigest による整合性チェック

セーブ時に `calculateDigest()` で現在ロード中の YAML 全体のハッシュを計算して `meta.yamlDigest` に保存。ロード時に `LoadDialog` 内で再計算し、不一致なら確認パネルを表示（強行ロードか中止を選択させる）。

### スロット運用

複数スロット + メモ機能で `SaveDialog` / `LoadDialog` がスロット一覧を表示する。

## カスタムデータ機能 (ZIP インポート)

タイトル画面（`MainMenu` / `PhaserGame.vue` 側 UI）から ZIP ファイルを選択すると、`JSZip` でデコードして `CustomDataStore.set(key, text)` に格納。各 Loader の `load(customText?)` メソッドが優先採用します。

- 対応キー: `base`, `stats`, `items`, `enemies`, `effects`, `traps`, `skills`（`CustomDataStore.YAML_KEYS`）
- 1つでもカスタムが入っていれば `CustomDataStore.isCustom() === true`
- セーブデータの `gameName` に `BaseLoader.getName()` を埋め込むため、カスタム作品ごとにセーブが識別される

## スキルシステム

`skills.yml` で定義された data-driven なスキルを管理します。Phase 2 時点ではデータ基盤と永続化のみを実装しており、実発動・コスト評価・mastery 抽選・action 実行は後続フェーズで実装予定です。

### スキル定義（skills.yml）

```yaml
- name: double_attack          # 識別子
  label: 2回攻撃                # 表示名
  description: 1ターンで2回攻撃する
  target: front                # front / around / room / map / self
  cost:                        # 使用時に支払うコスト（省略可）
    magic: 2
    life: life * 0.1           # 数式も可（実効値 + <stat>_max を露出）
  action:                      # 実行するアクションの配列（順次実行）
    - attack                   # パラメータなし
    - damage: 30               # 単一キーオブジェクト（数値 or formula）
  mastery:                     # 習得条件（省略可、空ならアイテム/イベントのみ）
    - exact: 2                 # = { least: 2, rate: 1 } のシュガー
    - least: 5
      rate: 0.5
```

`target` 種別：

| 値 | 意味 |
| --- | --- |
| `front` | UI で前方3方向から1セル選択。発動者は含まれない |
| `around` | 発動者隣接 8 マス（Chebyshev 距離1、発動者除外） |
| `room` | 発動者と視覚的に繋がった範囲（部屋＋通路、扉で繋がる範囲も含む。発動者除外） |
| `map` | マップ全体（発動者除外） |
| `self` | 発動者自身のみ |

`mastery` の各エントリは `exact: N`（`{ least: N, rate: 1 }` のシュガー）または `least: N, rate: R`（0〜1）の形式。複数エントリがある場合、レベルアップ抽選時は post-level >= `least` を満たすうち `least` が最大のエントリのレートを使用する。

### Player.learnedSkills

`Player` に習得済みスキル名の `Set<string>` を保持。関連 API：

- `learnSkill(name)`：未習得・既定義スキルなら習得して `true`。未定義 or 既習得は `false`
- `hasSkill(name)`：習得済みかを判定
- `getLearnedSkillNames()`：習得済みスキル名の配列を取得
- `forgetSkill(name)`：習得を取り消す（デバッグ・テスト用）

セーブデータ（`PlayerSaveData.learnedSkills: string[]`）として永続化される。ロード時に `skills.yml` に存在しないスキル名は警告ログ + スキップ。

### スキル習得経路

スキルは以下の経路で習得できます：

- **レベルアップ抽選**：`skills.yml` の `mastery` 配列に基づき、`Player.levelUp()` 末尾で未習得スキルそれぞれを抽選。post-level >= `least` を満たすエントリのうち `least` が最大のものを採用し、その `rate` で抽選成功時に習得。`exact: N` は `{ least: N, rate: 1 }` の省略表記。`addExp` の複数レベルアップ時は各 `levelUp` ごとに走るため、レベル飛ばしでも各段階で抽選が発生する
- **アイテム使用**：消耗品の `effect.immediate.learnSkill: <skillName>` で習得。既習得スキルでもアイテムは消費され、ログ「習得済み」を表示する。同 `immediate` 内に `life: 30` 等の他効果を併記すると両方適用される
- **デバッグ用 `window.learnSkill(name)`**：DevTools コンソールから直接付与

### コスト評価・支払いフロー

スキル発動時、`SkillsLoader.getCompiledSkill(name)` で `Expression` パース済みコスト式を取得し、`src/lib/skills/SkillExecutor.ts` の以下の関数で評価・適用する：

- `evaluateCost(player, compiled)`：コスト式を `player.getEffectiveFormulaVarsWithMax()`（実効値 + `<stat>_max` + `level` / `exp`）で評価し、`Map<stat, delta>`（delta は負値）を返す。端数は `Math.floor`、負値結果は警告 + 0 にクランプ
- `canPayCost(player, deltas)`：仮想評価のみで以下を検証（実ステータスは未変更）
  - 適用後にいずれかのステータスが `< 0` → false
  - `BaseLoader.isDead(postVars)` が真 → false（自殺コストは禁止）
- `payCost(player, deltas)`：実際にコストを `addStat` 経由で適用（fluctuation クランプを通す）
- `formatCostSummary(deltas)`：UI 表示用文字列を生成（例：`HP:10, MP:2`、`0` のエントリは省略）

`PlayerActions.useSkill` のフロー：

1. プレイヤー・スキル定義・習得済みかをチェック
2. `evaluateCost` でコスト差分を算出
3. `canPayCost` で支払い可否を検証（失敗時はログ「コストを支払えない」＋ ターン非消費で return）
4. `payCost` でコスト適用
5. action 実行（Phase 7 以降）
6. `dispatchObjectEvent` で敵反撃・tick 進行

UI 連携：`Game.buildSkillListPayload` が各スキルについて `evaluateCost` + `canPayCost` + `formatCostSummary` を呼び、`open-item-list` のペイロード（`costSummary` / `disabled` / `disabledReason`）に反映する。スキル一覧表示時にコストが視覚化され、支払い不能スキルは半透明 + tooltip「コスト不足」になる。

### target 解決と方向選択 UI

`src/lib/skills/TargetResolver.ts` がスキルの `target` スコープをセル配列に解決する：

| target | 解決ルール |
| --- | --- |
| `self` | caster の現在位置 1 セル |
| `front` | UI で選ばれた 1 セル（未指定なら空配列、`useSkill` で発動不可と判定） |
| `around` | caster 隣接 8 マス（Chebyshev 距離 1、caster 自身は含まない）のうち、`canAttack` で到達可能なセルのみ。壁に塞がれた方向や、対角線で両側の L 字経路がともに壁の方向は除外される |
| `room` | `DungeonMap.getCellsInZone(px, py)` の結果から caster を除いたもの。壁・扉で囲まれた視覚的開放空間（`getDoorTargetsInZone` と同じ BFS 方針、扉では止まる） |
| `map` | マップ全体の playable 範囲 `(1..getWidth(), 1..getHeight())` のうち、壁マス (`getAt = -1`) と caster 位置を除いたセル |

`getCellsInZone(x, y)` は壁または扉ビットが立っていない方向にのみ BFS で展開する（door bit は wall bit と共に立つ実装が前提）。

`target: front` の UI フローは [`enterAttackDirectionMode`](src/game/scenes/Game.ts) を踏襲：

```text
[スキル一覧で front スキル選択]
  → EventBus 'use-skill'
  → Game.ts ハンドラが def.target === 'front' を検出
  → closeList で一覧を閉じる
  → enterSkillTargetSelectMode：左/中央/右/キャンセルの 4 ボタン
     ・各候補は getFrontCandidates で取得（valid = canAttack 判定）
     ・無効方向は disabled で表示
  → ユーザ選択 → executeSkillWithFront → dungeon.useSkill(name, cell)
     ・キャンセル時はコスト未消費、defaultSceneActions に復帰
```

`target: self / around / room / map` は即発動（一覧再表示で開いたまま）。

`buildSkillListPayload` は `formatTargetSummary` の結果を `targetSummary` フィールドに、`formatCostSummary` の結果を `costSummary` フィールドに埋める。`PhaserGame.vue` の `buildSummaryText` ヘルパーが両者を `/` 区切りで括弧内に並べて表示する。表示例：

- `2回攻撃 (前方 / MP:2)`
- `自己治癒 (自分 / MP:5)`
- `爆発 (部屋 / HP:10, MP:10)`

### アクション実行

`SkillExecutor.executeActions(dungeon, caster, compiled, cells)` がスキルの `action` 配列を順次ディスパッチする。各 action は target セル全体を独立に処理する：

- `[attack, attack]` + `target: front` → 選択セルの敵を 2 回叩く
- `[attack]` + `target: room` → 部屋＋通路内の全敵に 1 回ダメージ
- `[attack, attack]` + `target: room` → 全敵を 2 周分叩く（イテレーション意味論：sequence × multi-target = 各 action が独立にスコープ全体を回る）

実装済み action：

- **`attack`**（`src/lib/skills/actions/AttackAction.ts`）：target セル内の生存敵を抽出し、`base.yml` の `damageFromPlayer` formula で各敵にダメージを与える。死亡時は除去 + `caster.addExp` + レベルアップログ + mastery 抽選ログ。攻撃フラッシュは「ヒットした敵が 1 体以上いる場合」に 1 回のみ発行。既存の通常攻撃（[`attackEnemyAt`](src/lib/map/PlayerActions.ts)）と damage 計算ロジックが重複するが、共通化は他 action 実装後に判断する
- **`damage`**（`src/lib/skills/actions/DamageAction.ts`）：独自 formula でダメージを与える。パラメータは数値リテラルまたは formula 文字列。使用可能変数は caster 側 `<stat>` / `<stat>_max` / `level` / `exp`（プレフィックスなし）、target 側 `target_<stat>` / `target_<stat>_max`（`target_` プレフィックス、敵生ステータス）。端数は `Math.floor` のみ、`Math.max(1, ...)` クランプは行わず 0 ダメージを許容する（負値結果は `addStat` の fluctuation クランプを通すため敵 HP 上限超過は発生しない）。死亡時の処理は attack と同じ。formula は module 内 Map でキャッシュする

例：

```yaml
- damage: 30                                # 固定値 30
- damage: "power * 2 - target_defense"      # caster 視点の formula
- damage: "target_life_max * 0.1"           # 敵の最大 HP の 10%
```

- **`heal`**（`src/lib/skills/actions/HealAction.ts`）：target スコープ内のエンティティ（caster を含む可能性あり）に `defaultDamageStat`（通常 `life`=HP）を回復させる。対象判定は「cells に caster の現在位置が含まれる場合 caster を含む、各 cell の生存 Enemy も含む」のシンプル位置ベース。`target: self` のみ caster が含まれ、`target: around / room / map` は caster を除外したスコープなので caster は対象にならない（プレイヤー発動のヒールは事実上 self 以外では敵を回復する）。変数規則は damage と同じ（caster 側プレフィックスなし、target 側 `target_` プレフィックス）。端数は `Math.floor`、負値は警告 + 0 クランプ。回復は `addStat` 経由で fluctuation 上限クランプを通る（最大値を超えない）。ログは caster 自身なら `HPが N 回復した`、Enemy なら `{敵label}のHPが N 回復した`。formula は module 内 Map でキャッシュ

例：

```yaml
- heal: 30                                  # 固定値 30
- heal: "life_max * 0.3"                    # caster 最大 HP の 30%（self 用途）
- heal: "target_life_max * 0.5"             # 対象最大 HP の 50%
```

未実装 action（Phase 11）：`reveal_trap`。未知の action 名は警告ログのみで継続する。

### スキル発動 UI フロー

シーンアクションの「スキル」ボタン（`1` キー）または `Game.toggleList('skill')` でスキル一覧を開きます。アイテム一覧と同じ `open-item-list` EventBus イベントを `mode: 'skill'` で発行し、`PhaserGame.vue` の既存リスト UI を共有します。

```text
[1 キー / スキルボタン] → Game.toggleList('skill') → openList('skill')
  → buildSkillListPayload で習得済みスキルのペイロード生成
  → EventBus.emit('open-item-list', { items, mode: 'skill', actionLabel: '発動' })
  → ユーザ選択 → 確定（Enter / 発動ボタン / ダブルクリック）
  → EventBus.emit('use-skill', { skillName })
  → DungeonMap.useSkill → PlayerActions.useSkill
  → モック発動ログ + dispatchObjectEvent（敵反撃 + tick）
  → 一覧を再描画して開いたまま
```

Phase 3 時点では `PlayerActions.useSkill` はモック実装（メッセージログとターン消費のみ）。コスト評価・target 解決・action 実行は後続フェーズで順次実装します。

`buildSkillListPayload` が返すエントリには Phase 6/7 で使用する `costSummary` / `targetSummary` / `disabled` / `disabledReason` フィールドの足場が含まれます（Phase 3 では全て空 or false）。

### スキルのデバッグ用付与

`Game.create()` で以下のグローバルヘルパーを公開：

- `window.learnSkill(name)`：スキルを習得
- `window.forgetSkill(name)`：習得を取り消し
- `window.listSkills()`：習得済みスキル一覧を取得
- `window.addExp(n)`：経験値を `n` 加算（敵討伐と同じ経路で levelUp + mastery 抽選が走る）
- `window.levelUpN(n=1)`：経験値計算を介さず直接 `n` 回 `levelUp` を呼ぶ（純粋な mastery 抽選確認用）

## YAML 横断バリデーション

`YamlCrossValidator.validate()`（`src/lib/YamlCrossValidator.ts`）は全 Loader の `load()` 完了後に走り、以下のクロス参照を検証する：

- `base.yml` の `floors[].enemies` / `floors[].traps` 名が `enemies.yml` / `traps.yml` に存在するか
- `traps.yml` の `effect[].type === 'addEffect'` の `value` が `effects.yml` に存在するか
- `items.yml` の `effect.immediate.learnSkill` が `skills.yml` に存在するか
- `base.yml` のオプションフィールド欠落（フォールバック適用のお知らせ）

`{ errors: string[], infos: string[] }` を返し、`errors.length > 0` のとき `EventBus.emit('yaml-cross-validation-errors', errors)` で `YamlErrorDialog` を表示。INFO レベルは現状コンソール出力のみ。

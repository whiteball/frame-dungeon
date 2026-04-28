# アーキテクチャ詳細

このドキュメントは、Frame Dungeon のゲームシステムの詳細な構成を解説します。概観は [CLAUDE.md](../CLAUDE.md) を参照してください。

## コアゲームアーキテクチャ

メインゲームロジックは複数のモジュールに分割されています：

- **MapObject**（`src/lib/MapObject.ts`）: マップ上に配置される全オブジェクトの基底クラス。表示マーク定数（`MapMark`）やイベントハンドラの型定義も含む
- **MapGenerator**（`src/lib/MapGenerator.ts`）: `DungeonMap` クラスを公開。マップ状態（壁・フォグ・歩行済み・プレイヤー位置）の保持と、視界 (FOV)・移動・回転・ランダム位置抽選など中核ロジックを担当。生成・オブジェクト管理・戦闘・デバッグ出力は `src/lib/map/` 配下のヘルパーモジュールに委譲
- **マップ系ヘルパー**（`src/lib/map/`）: `DungeonMap` から責務分離されたモジュール群。詳細は後述「マップ系モジュール構成」を参照
- **MainView**（`src/lib/MainView.ts`）: 透視投影を使用したメインの3Dスタイルダンジョンビューをレンダリング
- **MiniMapView**（`src/lib/MiniMapView.ts`）: 探索済みエリアを含む俯瞰ミニマップを表示
- **InfoView**（`src/lib/InfoView.ts`）: プレイヤーステータスとフロア情報のUIオーバーレイを管理
- **Player**（`src/lib/Player.ts`）: プレイヤーのステータス、インベントリ、装備を管理
- **Enemy**（`src/lib/Enemy.ts`）: `MapObject`を継承した敵クラス。敵のステータスと戦闘ロジックを管理
- **Item**（`src/lib/Item.ts`）: アイテムの効果と情報を管理
- **Inventory**（`src/lib/Inventory.ts`）: プレイヤーのアイテム所持を管理

## ゲームシーン構造

メインゲームシーン（`src/game/scenes/Game.ts`）は以下を調整します：

- 入力処理（WASD移動、スペースキーで攻撃）
- 複数ビューのレンダリング（メインビュー、ミニマップ、情報パネル）
- フロア進行とプレイヤー状態管理
- UIテキストの日本語フォントレンダリング

## Vue-Phaser通信

通信にはEventBusパターンを使用します：

```typescript
// VueからPhaserへ
EventBus.emit('event-name', data);

// PhaserからVueへ
EventBus.on('event-name', callback);
```

## マップ系モジュール構成

`DungeonMap`（`src/lib/MapGenerator.ts`）は薄いファサードとして以下のモジュール群へ責務を委譲します：

- **MapBuilder**（`src/lib/map/MapBuilder.ts`）: 部屋・通路・壁・扉の生成アルゴリズム。`DungeonMap.build()` から呼ばれ、生成結果（`Rect[]` と `RoomWithCorridors[]`）を返す
- **MapObjectStore**（`src/lib/map/MapObjectStore.ts`）: マップ上のオブジェクト・敵を `Map<integer, MapObject>` で一元管理。プレイヤー位置を引数で受け取り `around-N` イベントをディスパッチ。`Player.tickContinuousEffects()` の呼び出しもここで行う
- **PlayerActions**（`src/lib/map/PlayerActions.ts`）: ターン消費アクションの純粋関数群（`canAttack` / `attackPlayer` / `useConsumableItem` / `changeEquipment`）。`EventBus` を介したメッセージログ通知を集約
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

- **stats.yml**（`public/data/stats.yml`）: プレイヤーのステータス定義（HP、MP、攻撃力、防御力など）
- **items.yml**（`public/data/items.yml`）: アイテム定義（武器、防具、消耗品）
- **enemies.yml**（`public/data/enemies.yml`）: 敵の定義（HP、攻撃力、防御力、経験値、表示色）
- **effects.yml**（`public/data/effects.yml`）: 状態異常/強化効果の定義（毒、麻痺、睡眠、強化など）
- **traps.yml**（`public/data/traps.yml`）: トラップの定義（トゲの床、毒の沼、装備解除罠など）

各データファイルは対応するLoaderクラス（`StatsLoader`、`ItemsLoader`、`EnemyLoader`、`EffectsLoader`、`TrapsLoader`）によって読み込まれます。

## マップオブジェクトシステム

マップ上に配置されるオブジェクト（階段、トラップ、敵など）は`MapObject`基底クラスで統一管理されます：

- **MapObject**（`src/lib/MapObject.ts`）: 全オブジェクトの基底クラス。座標、表示マーク、色、イベントハンドラなどを保持
- **MapMark定数**: オブジェクトの表示形状を定義（`CIRCLE`, `STAR`, `DIAMOND`, `CROSS`, `X_CROSS`）
- **MapObjectStore**（`src/lib/map/MapObjectStore.ts`）: 全オブジェクトを `Map<integer, MapObject>` で一元管理。`instanceof` で型別のフィルタリングが可能。`DungeonMap` は同名の薄い委譲メソッド（`addEnemy`、`getEnemy`、`removeEnemy` など）を公開する

## 敵システム

敵システムの構成：

- **EnemyLoader**: `enemies.yml`から敵データを読み込み、フロアに応じた敵を提供
- **Enemy**: `MapObject`を継承した敵クラス。座標は`MapObject`のプロパティとして自身が保持するため、敵の移動時にキーの差し替えが不要
- **DungeonMap / MapObjectStore**: 敵を他のオブジェクトと統一管理（`addEnemy`、`getEnemy`、`removeEnemy` などを `DungeonMap` 経由で呼び出すと `MapObjectStore` に委譲。`instanceof Enemy` によるフィルタリングを内部で実施）
- **Game Scene**: フロアごとに敵を自動生成・配置（フロア数に応じて難易度調整）

敵は3Dビュー上で球体（ダイアモンド形マーク）として表示され、各敵は`enemies.yml`で定義された色で描画されます。

## 戦闘システム

### ターンの流れ

1. プレイヤーがスペースキーを押す → `DungeonMap.attackPlayer()` を呼び出す
2. 正面座標の敵を取得し、`canAttack()` で壁チェックを行う
3. ダメージ計算: `max(1, playerPower - floor(enemyDefense / 2))`
4. 敵が死亡した場合: マップから除去し、`player.addExp()` で経験値付与
5. `dispatchObjectEvent()` を呼び出し、隣接する敵の反撃ターンを処理
6. 敵の反撃: `around-1` イベントが `canAttack()` を通過した場合のみ攻撃
7. プレイヤーHP が 0 以下になった場合: `EventBus.emit('game-over')` → GameOver シーンへ遷移

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

- `player.addExp(amount): number` — 経験値を加算し、上昇したレベル数を返す（複数レベルアップに対応）
- 必要経験値: `level × 50`
- レベルアップ時: 最大HP +10（HP全回復）、攻撃力 +2、防御力 +1

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
| `open-item-list` | Phaser→Vue | `{ items: Array<{ id, label, description }> }` | 一覧 UI を開く・再描画する |
| `close-item-list` | Phaser→Vue | なし | 一覧 UI を閉じる確定通知 |
| `close-item-list-request` | Vue→Phaser | なし | Vue 側（ESC/キャンセル/外側トリガ）からのクローズ要求 |
| `use-item` | Vue→Phaser | `{ instanceId: string }` | 使用確定 |

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

Game シーンでは、これらのボタンに数字キー `1〜0`（10 個まで）を左から順に割り当てます（`Phaser.Input.Keyboard.KeyCodes.ONE`〜`ZERO` を `addKey` で登録し、`down` イベントで該当 `onClick` を呼び出す）。アイテム一覧表示中は `keyboard.enabled = false` によりこれらのショートカットも自動的に無効化されます。

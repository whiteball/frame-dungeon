# アーキテクチャ詳細

このドキュメントは、Frame Dungeon のゲームシステムの詳細な構成を解説します。概観は [CLAUDE.md](../CLAUDE.md) を参照してください。

## コアゲームアーキテクチャ

メインゲームロジックは複数のモジュールに分割されています：

- **MapObject**（`src/lib/MapObject.ts`）: マップ上に配置される全オブジェクトの基底クラス。表示マーク定数（`MapMark`）やイベントハンドラの型定義も含む
- **MapGenerator**（`src/lib/MapGenerator.ts`）: 部屋ベースのアルゴリズムを使用したダンジョン生成を処理。`DungeonMap`クラスがマップ状態とオブジェクト管理を担当
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

## マップ生成

ダンジョンは部屋ベースの生成アルゴリズムを使用します：

- ランダムサイズの矩形の部屋を作成
- 廊下で部屋を接続
- 階段を配置し、フロア遷移を管理
- ミニマップ表示用に探索済みエリアを追跡

## データ駆動設計

ゲームデータはYAMLファイルで管理されています：

- **stats.yml**（`public/data/stats.yml`）: プレイヤーのステータス定義（HP、MP、攻撃力、防御力など）
- **items.yml**（`public/data/items.yml`）: アイテム定義（武器、防具、消耗品）
- **enemies.yml**（`public/data/enemies.yml`）: 敵の定義（HP、攻撃力、防御力、経験値、表示色）

各データファイルは対応するLoaderクラス（`StatsLoader`、`ItemsLoader`、`EnemyLoader`）によって読み込まれます。

## マップオブジェクトシステム

マップ上に配置されるオブジェクト（階段、トラップ、敵など）は`MapObject`基底クラスで統一管理されます：

- **MapObject**（`src/lib/MapObject.ts`）: 全オブジェクトの基底クラス。座標、表示マーク、色、イベントハンドラなどを保持
- **MapMark定数**: オブジェクトの表示形状を定義（`CIRCLE`, `STAR`, `DIAMOND`, `CROSS`, `X_CROSS`）
- **DungeonMap._objects**: 全オブジェクトを`Map<integer, MapObject>`で一元管理。`instanceof`で型別のフィルタリングが可能

## 敵システム

敵システムの構成：

- **EnemyLoader**: `enemies.yml`から敵データを読み込み、フロアに応じた敵を提供
- **Enemy**: `MapObject`を継承した敵クラス。座標は`MapObject`のプロパティとして自身が保持するため、敵の移動時にキーの差し替えが不要
- **DungeonMap**: 敵を`_objects`で他のオブジェクトと統一管理（`addEnemy`、`getEnemy`、`removeEnemy`など。内部で`instanceof Enemy`によるフィルタリングを使用）
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

隣接する2セル間の攻撃可否を判定します（`src/lib/MapGenerator.ts`）：

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
- **Player**: 装備スロット管理と装備ボーナス計算

アイテムタイプ：

- `weapon`: 武器（攻撃力ボーナス）
- `main_armor`: メイン防具（防御力ボーナス）
- `sub_armor`: サブ防具（指輪など、2スロット）
- `consumable`: 消耗品（即座効果・持続効果）

# アーキテクチャ詳細

このドキュメントは、Frame Dungeon のゲームシステムの詳細な構成を解説します。概観は [CLAUDE.md](../CLAUDE.md) を参照してください。

分量が大きいため、トピック別に以下のファイルへ分割しています。

## 目次

| ファイル | 内容 |
| --- | --- |
| [architecture/overview.md](./architecture/overview.md) | コアゲームアーキテクチャ・シーン構造・Vue-Phaser通信・ダイアログコンポーネント・マップ系モジュール構成・マップ生成 |
| [architecture/data.md](./architecture/data.md) | データ駆動設計・Loader クラス・`base.yml` 全体設定・YAML 横断バリデーション |
| [architecture/combat.md](./architecture/combat.md) | マップオブジェクトシステム・敵システム・戦闘システム |
| [architecture/items.md](./architecture/items.md) | アイテムシステム・アイテム修飾状態（modifier）・状態異常/強化システム・トラップシステム |
| [architecture/gameplay.md](./architecture/gameplay.md) | シーンアクションボタン・セーブ/ロード・カスタムデータ機能（ZIP インポート） |
| [architecture/skills.md](./architecture/skills.md) | スキルシステム全般（定義・コスト評価・target 解決・action 実行・パッシブスキル） |
| [architecture/events.md](./architecture/events.md) | 汎用イベントオブジェクト（`events.yml` フォーマット・action 種別・選択肢/rate 分岐・配置） |

## トピック早見表

| 知りたいこと | 参照先 |
| --- | --- |
| `MapObject` / `DungeonMap` / `MainView` などの責務 | [overview.md](./architecture/overview.md) |
| Vue ダイアログの構成・EventBus イベント一覧 | [overview.md](./architecture/overview.md) |
| マップ生成アルゴリズム（部屋・通路・障害物） | [overview.md](./architecture/overview.md) |
| YAML ファイルの読み込み・`YamlDefinitionStore` | [data.md](./architecture/data.md) |
| `base.yml` のダメージ式・経験値式・フロア構成・autoSpawner | [data.md](./architecture/data.md) |
| `secretRoom` / `itemModifierChance` / `enemyDropPool` | [data.md](./architecture/data.md) |
| YAML 横断バリデーション | [data.md](./architecture/data.md) |
| 敵の `walk` パターン・ターゲット記憶・経路探索 | [combat.md](./architecture/combat.md) |
| 戦闘の処理順序・`canAttack` の壁判定 | [combat.md](./architecture/combat.md) |
| 経験値・レベルアップ・mastery 抽選 | [combat.md](./architecture/combat.md) |
| アイテム修飾状態（modifier）・`getEffectiveStat` の適用順序 | [items.md](./architecture/items.md) |
| 消耗品の `immediate` / `continuous` 効果 | [items.md](./architecture/items.md) |
| `effects.yml` の状態異常システム（毒・麻痺・睡眠） | [items.md](./architecture/items.md) |
| `traps.yml` のトラップ定義・発動条件 | [items.md](./architecture/items.md) |
| シーンアクションボタン・モーダルモード（`isModalMode`） | [gameplay.md](./architecture/gameplay.md) |
| セーブデータ構造・`yamlDigest` 整合性チェック | [gameplay.md](./architecture/gameplay.md) |
| ZIP カスタムデータ（`CustomDataStore`） | [gameplay.md](./architecture/gameplay.md) |
| スキル定義・`cost` / `target` / `action` / `mastery` | [skills.md](./architecture/skills.md) |
| スキル `target` スコープ解決（front/around/room/map/self/hit） | [skills.md](./architecture/skills.md) |
| 実装済み action（`attack` / `damage` / `heal` / `reveal_trap` / `apply_effect`） | [skills.md](./architecture/skills.md) |
| 敵のパッシブスキル（`trigger: on_attack`） | [skills.md](./architecture/skills.md) |
| 汎用イベントオブジェクト（回復ポイント / 祭壇 / 能力依存判定） | [events.md](./architecture/events.md) |

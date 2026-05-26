# イベントシステム

[← 索引へ戻る](../architecture.md)

`events.yml` で data-driven 定義する**汎用イベントオブジェクト**の仕組みを扱います。回復ポイント・祭壇・能力依存判定の宝石・三択リスクリワード等のユースケースを 1 つのフォーマットで実現します。

## 設計方針

- **調査専用**: イベントは `C キー`（`MapInteractionHandler.trySearch` → 方向選択）からのみ起動する。踏み発動はトラップが担当（`traps.yml` の `visible: true` + `appearance` で同等の「最初から見えるオブジェクト」を実現可能）
- **3 種の結末**: `action` / `random_outcome` / `choices` のうちちょうど 1 つを指定。EventsLoader が起動時に排他チェック
- **進入禁止セル化**: `blocking: true`（既定）のイベントは `DungeonMap.isCellBlocked` で進入禁止扱いとなる（宝箱と同じ）
- **コスト + 確率分岐**: 選択肢にはスキルと同じ formula 記法の `cost` を指定可能。`rate` で成功率を formula 評価し `on_success` / `on_fail` に分岐可能
- **自壊制御**: action 内に `self_destruct` を含めると当該イベントが消える。無いイベントは繰り返し発動可能（回復ポイント等）

## events.yml フォーマット

```yaml
- name: healing_fountain          # 識別子（base.yml / セーブデータ参照キー）
  label: 癒しの泉                  # 表示名
  description: 清らかな水が湧き出ている  # 任意の説明
  flavor: 透き通った水が傷を癒してくれそうだ。  # 調査時に必ずログ出力されるフレーバー文
  appearance:                     # 任意。既定: '*' / 0x88CCFF / sphere
    mark: o                       # MapMark 値（'o' / '*' / '<>' / '+' / 'x' / '[]'）
    color: 0x66CCFF               # 数値 (0xRRGGBB) または '#RRGGBB' / '#RGB' 文字列
    shape: cylinder               # フレンドリ名: none / sphere / cube / box / cylinder / pyramid
    concentric_circle: true       # 床マーカーを同心円で描画
  blocking: true                  # 既定 true。false で進入可能化（看板等）
  choices:                        # ↓ 結末指定（action / random_outcome / choices のうちちょうど 1 つ）
    - label: 飲む
      cost: { magic: 2 }
      action:
        - heal: "life_max * 0.5"
        - message: 心地よい水が体を満たした
    - label: 立ち去る
      action: []                  # 空配列で「何もしない」
```

### 結末の 3 パターン

| キー | 用途 | 例 |
| --- | --- | --- |
| `action: [...]` | 選択肢無しで即実行 | シンプルな踏み入り効果（実際は調査経由） |
| `random_outcome: [{ weight, label?, action }]` | 重み付き抽選で 1 件選んで実行 | 「祝福 or 何も無し or 呪い」のランダム祭壇 |
| `choices: [{ label, cost?, rate?, action / on_success+on_fail }]` | 選択肢メニューを表示（最大 10、+ 自動キャンセル） | 「飲む / 立ち去る」、「大胆 / 慎重 / 罠解除」 |

### `choices` の `rate` 指定

```yaml
choices:
  - label: 退かす
    cost: { life: "ceil(life_max * 0.05)" }
    rate: "min(1, power / 30)"  # 数値リテラルまたは formula 文字列
    on_success:
      - give_item: { name: emerald }
      - self_destruct
    on_fail:
      - damage: 10
```

- `rate` 指定時は `action` ではなく `on_success` / `on_fail` 両方を要求
- formula 変数は player の実効値 + `<stat>_max` + `level` / `exp`
- 評価結果は [0,1] にクランプ

### action 種別

| action | 動作 |
| --- | --- |
| `heal: <number\|formula>` | プレイヤー HP（`defaultDamageStat`）を回復 |
| `damage: <number\|formula>` | プレイヤー HP を減少。死亡判定 → `game-over` 発火 |
| `apply_effect: <name>` または `{ effect, rate }` | 状態異常を付与（rate 評価あり） |
| `learn_skill: <name>` | スキル習得（既習得時もアイテム同等のログ） |
| `add_modifier: <name>` | 装備中アイテムへ modifier 付与（`Player.applyImmediateEffect` 経由） |
| `remove_modifier_kind: { kind, target? }` | 指定 kind の modifier を解除 |
| `execute_skill: <name>` | コスト無し・未習得不問でスキル発動（`SkillExecutor.executeSkillFromItem`）。`target: front` スキルは event 経由では発動不可 |
| `give_item: <name>` または `{ name, count?, modifiers? }` | アイテムをインベントリに追加。**満杯時は足下に `ItemObject` 配置**（宝箱開封と同じ流儀） |
| `spawn_enemy: <name>` または `{ name, count?, near? }` | 敵を生成・配置。`near: around`（既定、隣接 8 マス）/ `room`（プレイヤーゾーン）。`around` で不足する場合は `room` にフォールバック。**プレイヤーセルと候補セル間の壁/扉は検査しないため、プレイヤーが壁際にいると壁の向こう側の部屋に敵が出現する場合がある**（演出としては許容範囲と判断、`EventExecutor.getAroundEmptyCells` 参照） |
| `message: <text>` | 任意ログ出力（演出用） |
| `unlock_door: self` | `EventObject.linkedDoor` で指定された扉を解錠（`DungeonMap.unlockDoor`）。`secret_room_key` 専用 action で、`param: 'self'` 固定。linkedDoor は YAML には書かず、`FloorPopulator` が施錠扉ごとに runtime で注入する |
| `self_destruct` | 当該 `EventObject` を `removeMapObject`。1 回限りのイベントに |

action 配列は順次実行され、`self_destruct` を含んでいた場合は最後に EventObject を除去する。`damage` でプレイヤー死亡時は以降の action をスキップ。

## クラス構成

- **EventDefinition / EventsLoader** (`src/lib/EventsLoader.ts`): YAML パース + 構造検証 + cost / rate formula コンパイル + Singleton 公開。`getCompiledEvent(name)` で `CompiledEvent` を取得可能
- **AppearanceSpec** (`src/lib/AppearanceSpec.ts`): mark / color / shape / concentric_circle のパース。`TrapsLoader` と共有
- **EventObject** (`src/lib/map/MapObjects.ts`): `MapObject` 継承。`eventDef` を保持、`isBlocking` getter で `blocking` フラグを露出
- **EventExecutor** (`src/lib/events/EventExecutor.ts`): action 実行の中核。formula キャッシュ・コスト評価・rate 判定・action ディスパッチ・選択肢実行（`executeEventImmediate` / `executeEventChoice`）
- **MapInteractionHandler.investigateEvent** (`src/game/scenes/game/MapInteractionHandler.ts`): C キー調査時に EventObject を検出した際の起動口。flavor 出力 → 即実行 or 選択肢モード遷移
- **SceneModeController.enterEventChoiceMode** (`src/game/scenes/game/SceneModeController.ts`): 最大 10 個 + 自動キャンセルのモーダル UI。cost 不足の choice は disabled で表示

## フロア配置 (`base.yml`)

```yaml
floors:
  - 4:
      # ...既存設定...
      eventCount: { min: 1, max: 2 }   # 数値単独 or { min, max }
      events:                          # 抽選プール
        - healing_fountain             # 文字列で重み 1
        - mysterious_altar
        - name: heavy_rock             # 重み指定
          weight: 2
```

`FloorPopulator.populateFloor` が宝箱配置後・トラップ配置前にイベント配置ブロックを実行する。配置先は `withoutCorridor: true` / `withoutDoor: true` / `withoutSecretRoom: true` 制約付きのランダムセル。

## YAML 横断バリデーション

`YamlCrossValidator.validate()` が起動時に以下を検証する：

- `base.yml.floors[].events[]` の名前が `events.yml` に存在するか
- `base.yml.floors[].eventCount` が数値または `{ min, max }` 形式か
- events action 内の参照：`give_item.name` → items.yml / `spawn_enemy.name` → enemies.yml / `learn_skill` → skills.yml / `execute_skill` → skills.yml（active のみ）/ `add_modifier` → item_modifiers.yml / `apply_effect.effect` → effects.yml / `remove_modifier_kind.kind` → item_modifiers.yml（kind タグ存在チェック、空なら INFO）

イベントの構造検証（結末排他チェック / `choices` 個数上限 / `rate` と `on_success`/`on_fail` の整合性 など）は `EventsLoader.validateEvent` 内で起動時に throw する。

## セーブ/ロード

`MapObjectSaveData` に `{ type: 'event'; x; y; eventName; linkedDoor? }` を追加。`DungeonMap.serialize` / `deserialize` で EventObject の名前と座標を永続化する。「自壊済みか」は「マップ上に存在するか」で表現するため追加状態は不要。`linkedDoor` は `secret_room_key` のような扉と紐付くイベント用のオプション（隠し部屋施錠扉システム）。

`yamlDigest` は `CustomDataStore.YAML_KEYS` から計算され、`events` キーが既に登録済みのため events.yml の変更は自動的にダイジェスト変化として検出される。

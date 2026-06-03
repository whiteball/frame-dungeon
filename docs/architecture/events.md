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

### `choices` の `condition` 指定（条件付き表示）

```yaml
choices:
  - label: 薬を与える
    condition: 'has_item("potion")'   # 真のときだけメニューに表示される
    action:
      - consume_item: { name: potion, count: 1 }
      - give_item: { name: power scroll }
      - self_destruct
  - label: そっとしておく
    action: []
```

- `condition`（formula 文字列 or 数値リテラル）の**評価結果が真（非 0）のときだけ選択肢を表示**し、偽（0）なら**非表示**にする（grey-out ではなく完全に出さない）
- `cost` / `rate` / `action` とは独立して併用可能（cost 不足の disabled とは別軸）
- 「特定アイテム所持時のみ」「特定スキル習得済みのみ」といった出し分けに使う
- UI フィルタ（`MapInteractionHandler.enterChoiceMode`）に加え、`EventExecutor.executeEventChoice` 側でも実行直前に再判定する（すり抜け防止）

#### イベント formula で使えるクエリ関数

イベント系 formula（`condition` / `cost` / `rate` / `heal`・`damage` 数式など）では、通常の変数に加えて以下の関数を呼べる（`src/lib/events/eventFormula.ts` の共有 `eventParser` に登録）：

| 関数 | 戻り値 | 用途 |
| --- | --- | --- |
| `has_item("name")` | 所持していれば 1、なければ 0 | アイテム所持判定 |
| `item_count("name")` | 所持個数 | 個数依存の cost / rate / condition |
| `has_skill("name")` | 習得済みなら 1、なければ 0 | スキル習得判定 |

> **実装メモ**: `expr-eval-fork` は values 経由で渡した関数の呼び出しを拒否するため、これらは parser インスタンスの `functions` に登録している。よって全イベント formula は共有 `eventParser`（`compileEventFormula`）で parse し、評価は `evalWithPlayer(player, () => expr.evaluate(vars))` で player 文脈をセットして行うこと。

### action 種別

| action | 動作 |
| --- | --- |
| `heal: <number\|formula>` | プレイヤー HP（`defaultDamageStat`）を回復 |
| `damage: <number\|formula>` | プレイヤー HP を減少。死亡判定 → `game-over` 発火 |
| `mod_stat: { stat, formula }` | 任意ステータスを formula 評価値に**設定**する（heal/damage が HP 加減算なのに対し、MP 等を狙った値にできる。例: `{ stat: magic, formula: "1" }` で MP を 1 に）。formula 内で実効値 + `<stat>_max` を参照可（current 値も `magic` 等で参照可能）。`addStat` 差分適用で fluctuation クランプを通す。HP を下げて死亡した場合は `game-over` 発火 |
| `apply_effect: <name>` または `{ effect, rate }` | 状態異常を付与（rate 評価あり） |
| `learn_skill: <name>` | スキル習得（既習得時もアイテム同等のログ） |
| `add_modifier: <name>` | 装備中アイテムへ modifier 付与（`Player.applyImmediateEffect` 経由） |
| `remove_modifier_kind: { kind, target? }` | 指定 kind の modifier を解除 |
| `execute_skill: <name>` | コスト無し・未習得不問でスキル発動（`SkillExecutor.executeSkillFromItem`）。`target: front` スキルは event 経由では発動不可 |
| `give_item: <name>` または `{ name, count?, modifiers? }` | アイテムをインベントリに追加。**満杯時は足下に `ItemObject` 配置**（宝箱開封と同じ流儀） |
| `consume_item: <name>` または `{ name, count? }` | インベントリから name 一致のアイテムを最大 count 個（既定 1）除去。除去できた数だけログ出力。`condition: 'has_item("...")'` と組み合わせて「所持アイテムを対価に渡す」イベントに使う（`Inventory.removeItemByName`） |
| `spawn_enemy: <name>` または `{ name, count?, near? }` | 敵を生成・配置。`near: around`（既定、隣接 8 マス）/ `room`（プレイヤーゾーン）。`around` で不足する場合は `room` にフォールバック。**プレイヤーセルと候補セル間の壁/扉は検査しないため、プレイヤーが壁際にいると壁の向こう側の部屋に敵が出現する場合がある**（演出としては許容範囲と判断、`EventExecutor.getAroundEmptyCells` 参照） |
| `message: <text>` | 任意ログ出力（演出用） |
| `unlock_door: self` | `EventObject.linkedDoor` で指定された扉を解錠（`DungeonMap.unlockDoor`）。`secret_room_key` 専用 action で、`param: 'self'` 固定。linkedDoor は YAML には書かず、`FloorPopulator` が施錠扉ごとに runtime で注入する |
| `self_destruct` | 当該 `EventObject` を `removeMapObject`。1 回限りのイベントに |

action 配列は順次実行され、`self_destruct` を含んでいた場合は最後に EventObject を除去する。`damage` でプレイヤー死亡時は以降の action をスキップ。

## クラス構成

- **eventFormula** (`src/lib/events/eventFormula.ts`): イベント formula 専用の共有 `Parser`（`has_item` / `item_count` / `has_skill` 関数を登録済み）と `compileEventFormula` / `evalWithPlayer` を提供。全イベント formula の parse / evaluate はここを経由する
- **EventDefinition / EventsLoader** (`src/lib/EventsLoader.ts`): YAML パース + 構造検証 + cost / rate / condition formula コンパイル + Singleton 公開。`getCompiledEvent(name)` で `CompiledEvent` を取得可能
- **AppearanceSpec** (`src/lib/AppearanceSpec.ts`): mark / color / shape / concentric_circle のパース。`TrapsLoader` と共有
- **EventObject** (`src/lib/map/MapObjects.ts`): `MapObject` 継承。`eventDef` を保持、`isBlocking` getter で `blocking` フラグを露出
- **EventExecutor** (`src/lib/events/EventExecutor.ts`): action 実行の中核。formula キャッシュ・コスト評価・rate 判定・action ディスパッチ・選択肢実行（`executeEventImmediate` / `executeEventChoice`）。`executeActionArray` / `executeOneAction` は `eventObj: EventObject | null` を取り、`null` 文脈（時限イベント等）では `self_destruct` を no-op・`unlock_door: self` を警告 skip とする。`executeEventByName(dungeon, player, eventName)` は EventObject 非依存でイベント名から `action` / `random_outcome` を実行する公開エントリ（`choices` 形式は無人実行不可で警告 + false 返却）
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

## 調査以外の起動経路（時間トリガー）

イベントは本来「調査専用」だが、`action` / `random_outcome` 形式のイベントは座標・EventObject に依存せず `EventExecutor.executeEventByName()` で発火できるため、以下のターン経過トリガーからも実行される：

- **時限イベント `scheduledEvents`**（`base.yml`）: 通算/フロア経過ターンで発火。`MapGenerator.dispatchObjectEvent()` から発火。詳細は [data.md](./data.md) の「時限イベント (`scheduledEvents`)」
- **状態異常の満了アクション `onExpire`**（`effects.yml`）: 状態異常が**満了（`clear.formula` 由来の自然解除）した瞬間に 1 回**発火する events.yml イベント名。`Player.tickStatusEffects()` が解除エントリに `expireEvent` を載せ、`MapObjectStore.dispatchEvent()` が `executeEventByName` で発火する。治療（`clearStatusEffect`）や被弾解除（`clear.onDamage`）では発火しない（=「何もしなければ N ターン後に発動／治療すれば回避」型の遅延効果を実現）。onExpire 発火エントリには「解けた」ログを出さず、イベント側の action / message に委ねる

`onExpire` 型の遅延効果の作り方：`effects.yml` で `clear.formula` を確率式ではなく閾値式 `count >= N ? 1 : 0` にしてカウントダウンにし、`onExpire: <event名>` を付ける。発火する効果は events.yml の action（`mod_stat` で HP/MP を特定値に、`apply_effect` で別状態異常に変化、`give_item` 等）を自由に組める。サンプル: `death_curse`（effects.yml）→ `death_curse_payload`（events.yml, HP/MP を 1 に）。付与は `curse_strike`（skills.yml, 敵 on_attack）等の `apply_effect` で行う。

いずれも `choices` 形式のイベントは無人実行できないため使用不可（`YamlCrossValidator` がエラーで弾く）。`flavor` は調査時専用の出力なので時間トリガー発火では表示されない（定義上は必須項目のまま）。

## YAML 横断バリデーション

`YamlCrossValidator.validate()` が起動時に以下を検証する：

- `base.yml.floors[].events[]` の名前が `events.yml` に存在するか
- `base.yml.floors[].eventCount` が数値または `{ min, max }` 形式か
- events action 内の参照：`give_item.name` / `consume_item.name` → items.yml / `spawn_enemy.name` → enemies.yml / `learn_skill` → skills.yml / `execute_skill` → skills.yml（active のみ）/ `add_modifier` → item_modifiers.yml / `apply_effect.effect` → effects.yml / `remove_modifier_kind.kind` → item_modifiers.yml（kind タグ存在チェック、空なら INFO）

イベントの構造検証（結末排他チェック / `choices` 個数上限 / `rate` と `on_success`/`on_fail` の整合性 / `condition` の formula parse など）は `EventsLoader.validateEvent` 内で起動時に throw する。`condition` 内の `has_item("...")` 等の引数（formula 文字列リテラル）はクロス検証しない（静的抽出が脆いため parse 検証のみ）。

## セーブ/ロード

`MapObjectSaveData` に `{ type: 'event'; x; y; eventName; linkedDoor? }` を追加。`DungeonMap.serialize` / `deserialize` で EventObject の名前と座標を永続化する。「自壊済みか」は「マップ上に存在するか」で表現するため追加状態は不要。`linkedDoor` は `secret_room_key` のような扉と紐付くイベント用のオプション（隠し部屋施錠扉システム）。

`yamlDigest` は `CustomDataStore.YAML_KEYS` から計算され、`events` キーが既に登録済みのため events.yml の変更は自動的にダイジェスト変化として検出される。

# アイテム / modifier / 状態異常 / トラップ

[← 索引へ戻る](../architecture.md)

アイテム・装備・modifier、`effects.yml` ベースの状態異常システム、`traps.yml` ベースのトラップを扱います。

## アイテムシステム

アイテムシステムの構成：

- **ItemsLoader**: `items.yml`からアイテムデータを読み込み
- **ItemModifiersLoader**: `item_modifiers.yml` から修飾状態の定義を読み込み、formula を事前パース。`getCompiled(name)` で実行用 `CompiledItemModifier`（effect 配列 + パース済み `Expression`）を返す。`getNamesByKind(kind)` で kind タグ別 modifier 名を取得（解呪用）
- **Item**: 個別のアイテムインスタンスを管理。`modifiers: Map<string,number>`（name → count）を保持し、`addModifier`/`setModifierCount`/`removeModifier`/`removeModifiersByKind` で操作。`canUnequip()` は `cannot_unequip` 効果の有無で判定。`getModifierStatBonuses(vars)` は装備中の add_stats を formula 評価して `{stat → delta}` を返す（vars に `count` を自動マージ）。`getLabelWithModifiers()` で suffix 形式の表示ラベルを生成
- **ItemLabelFormatter**（`src/lib/ItemLabelFormatter.ts`）: `formatItemLabelWithModifiers(baseLabel, modifiers)` で `"鉄の剣 [攻+2/呪]"` のような suffix 形式ラベルを組み立てる。`countable` の modifier は `shortLabel + count`、それ以外は `shortLabel` のみ。`shortLabel` 未定義時は `label` を使用
- **Inventory**: プレイヤーのアイテム所持を管理（容量制限あり）
- **Player**: 装備スロット管理と装備ボーナス計算。`applyImmediateEffect()` で消耗品の即座効果を能力値へ反映（`addStat` の fluctuation クランプを経由）。`applyContinuousEffect()`/`tickContinuousEffects()` で持続効果を独立エントリ管理。`getEffectiveStat(key)` は **base → 装備raw → 装備 modifier の add_stats（formula 評価；元 stat 値は base+装備raw を渡す）→ 持続効果 → permanent status effect** の順で合算した実効値を返す。`predictEquipSlot(item)` / `getItemInSlot(slot)` で装備変更前の置き換え対象を予測（`cannot_unequip` 検査のために `PlayerActions.changeEquipment` が使用）

アイテムタイプ：

- `weapon`: 武器（攻撃力ボーナス）
- `main_armor`: メイン防具（防御力ボーナス）
- `sub_armor`: サブ防具（指輪など、2スロット）
- `consumable`: 消耗品（即座効果・持続効果）

### アイテム修飾状態（modifier）

装備中のアイテムに重ねて適用される個体差システム。`item_modifiers.yml` で定義し、装備中のみ全 effect が発動する（インベントリ内・床落ち状態では無効）。

| effect.name | 用途 | 必須パラメータ |
| --- | --- | --- |
| `add_stats` | target stat に formula 評価値を加算（装備中） | `target`（stat 名）、`formula`（変数: `count`、元 stat 値、player 各 stat） |
| `cannot_unequip` | 装備解除をブロック（呪い用） | （なし） |

- `Item.modifiers: Map<string, number>` でアイテムごとに `name → count` を保持
- `countable: true` の modifier は `max` でクランプ、`initial.{min,max}` の範囲で count を一様抽選（床配置時、`ItemModifiersLoader.rollInitialCount(name)`）
- フロア床配置時の抽選フロー: `Game.ts` 床配置 → `ItemFactory.createItem(name, { rollModifiers: true, floor })` → `BaseLoader.getFloorConfig(floor).itemModifierChance` で確率判定 → 当選時 `ItemModifiersLoader.pickRandomFor(itemType, itemModifierPool)` で名前抽選 → `rollInitialCount(name)` で count 決定 → `Item.setModifierCount(name, count)`
- 装備変更フロー：`PlayerActions.changeEquipment` は装備中アイテムの `canUnequip()` を判定し、`cannot_unequip` の場合は装備解除も置き換え装備もブロックしてメッセージ出力（ターン非消費）。一方、装備解除トラップ（`unequip` effect）は **ローグライク慣例に倣い `cannot_unequip` を無視して強制的に外す**
- 巻物による付与/解除：`items.yml` の消耗品 `immediate.add_modifier` で装備中アイテムへ自動付与、`immediate.remove_modifier_kind: { kind, target }` で kind タグ一致の modifier を一括除去（解呪など）。サンプル: 攻撃強化の巻物 (`add_modifier: power_reinforced`) / 攻撃弱化の巻物 (`add_modifier: power_weakened`) / 解呪の巻物 (`remove_modifier_kind: { kind: curse, target: all_equipped }`)
- 敵ドロップ経由の付与：`enemies.yml` の `drop: [{ item, rate, modifierChance? }]` と `base.yml` floor の `enemyDropPool` は additive。`src/lib/map/EnemyDropResolver.ts` の `tryEnemyDrop(dungeon, enemy, floor)` が両プールを連結して各エントリの rate で独立判定し、当選アイテムを敵が居たマスに `ItemObject` として配置。`modifierChance` が指定されているドロップは floor の `itemModifierChance` を上書きできる（敵ドロップだけ高確率にするなど）。`PlayerActions.attackEnemyAt` と `skills/actions/DamageAction.executeDamageAction` の両方の敵死亡経路から呼ばれる。フロア番号は `DungeonMap.getCurrentFloor()` から取得（go-to-next-floor とセーブロード時に `setCurrentFloor` で設定）
- ドロップ配置の空きセル探索：敵死亡セルに既に `ItemObject` または生存敵が居る場合、`findDropTarget` がマンハッタン距離 2 以内かつ壁を越えずに 2 歩で到達可能な空きセルを 4 方向 BFS で探索（`Pathfinding.canPass` を使用して壁・扉判定）。プレイヤーセルは候補から除外する（直後の `dispatchObjectEvent` で即時拾得されてしまうのを防ぎ、床に一旦置かれることを保証するため。ただし BFS の中継点としては通過可能）。候補セルが見つからない場合はドロップを破棄し「床に余裕がなかった」ログを残す。同一マスに ItemObject が重複しないため、満杯インベントリで足元拾得時の `pendingPickup` 上書き問題を回避できる
- UI 表示：装備変更ダイアログ・ステータスダイアログ・インベントリ・メッセージログは全て `Item.getLabelWithModifiers()` 経由で suffix 表示
- セーブ：`ItemSaveData.modifiers?: Record<string,number>`（旧セーブでは省略、deserialize 時に空 Map）。未知 modifier 名はロード時にスキップ（警告ログ）

### 隠し部屋の宝箱（TreasureObject）

隠し部屋に確率で配置される `TreasureObject`（`src/lib/map/MapObjects.ts`）。中身は確定アイテム（modifier 強制付与）でリターンが大きい一方、開封時に確率でフロアのトラップが発動するリスクを伴う。

- 設定は `base.yml` フロア配下の `treasure: { rate, trapRate, items[] }`（[data.md](./data.md#フロア毎構成-floors) 参照）。`secretRoom` が無効なフロアでは配置されない
- 配置: マップ生成時、各隠し部屋について `rate` 判定 → 当選なら部屋内の「扉前以外の通行可能セル」（`DungeonMap.findDoorsInRoom` で扉セルを除外）から 1 セル抽選し `TreasureObject` を配置。階段・敵・トラップ・床アイテムと座標が重ならないよう `excludePositionList` でガード
- 抽選: `Game.pickTreasureItem` が `items[].bias` を重みとして 1 アイテム決定。`ItemFactory.createItem(name)` を modifier ロール無しで呼び、`items[].modifiers[].name`/`count` を `Item.setModifierCount` で**そのまま強制付与**する（フロアの `itemModifierChance` とは独立）
- 進入禁止: 宝箱セルは敵セルと同等に通行不可。`DungeonMap.isCellBlocked(x, y)` が `getEnemy` と `TreasureObject` を統一判定し、プレイヤー前進 (`movePlayer`) と敵移動 (`tryMoveEnemy`) の両方から参照される
- 開封: C キー → `trySearch` の方向選択 UI を経由。`Game.executeSearch` が対象セルに `TreasureObject` を検出すると `openTreasure(treasure, x, y)` を呼出
  1. `「宝箱を開けた！」` をメッセージログ
  2. `Math.random() < trapRate && trapPool.length > 0` のとき `trapPool` からランダム 1 つを `applyTrapEffects(trapDef)` に渡して効果適用（既存トラップ発動と同じメッセージ・ダメージ計算）
  3. `removeMapObject(treasure)` で宝箱を消去 → 抽選アイテムを `ItemObject` として同セルに `placeObject`（常に床配置。インベントリには直接入れない）
  4. `「<アイテム名>が出てきた」` をメッセージログ
  5. `dispatchObjectEvent()` でターン進行（`searchAt` と同じポリシー）
- セーブ: `MapObjectSaveData` の `type: 'treasure'` ケース（`item: ItemSaveData`, `trapRate`, `trapPool`）で永続化。`MapGenerator.deserialize` が `TreasureObject` を復元

### Player.getEffectiveStat の適用順序

`getEquipmentBonuses()` は装備の生ボーナス（modifier 含まず）を返す。`getEffectiveStat(key)` 内では:

```text
1. base stat（this.stats.get(key)）
2. + 装備 raw ボーナス（getEquipmentBonuses().get(key)）
3. + 装備 modifier の add_stats を合算（各装備中 Item.getModifierStatBonuses(vars) を呼び出し。
     vars は getFormulaVars() に key=preModValue（1+2 の和）を上書きしたもの。
     count 変数は Item 側で modifier ごとにマージされる）
4. + 持続効果ボーナス（getContinuousBonuses().get(key)）
5. + permanent status effect（formula(x, count) を順次適用）
```

modifier formula 内の `power` 等の名前は元値（preModValue）を参照し、複数の同種 modifier が重ねがけされても各々が同じ基準値を見るため過剰な乗算は起きない。

### 消耗品の使用フロー

1. シーン下部の「アイテム」ボタン押下またはショートカットキー押下で `ItemListController.toggleList('inventory')` が呼ばれる（統合インベントリ）
2. `openList('inventory')` が `Inventory.getItems()`（消耗品を先頭に安定ソート）で一覧を取得し、EventBus `'open-item-list'` で Vue 側へ渡す。同時に `this.input.keyboard.enabled = false` で Phaser キー入力を停止
3. Vue 側（`PhaserGame.vue`）は `<ul>` を表示してフォーカスを奪い、画面下部を専用コンテキストバー（`使用/装備/投げる/置く/説明/閉じる`）に差し替える。↑↓ で項目選択、コンテキストバーのボタン（または対応する数字キー）、ダブルクリック、Enter/ESC で操作
4. 消耗品の使用は「使用」ボタンか Enter（選択中が消耗品のときの既定アクション）で、Vue は EventBus `'use-item'` を `{ instanceId }` 付きで発行
5. `ItemListController` の `use-item` ハンドラが `DungeonMap.useConsumableItem(instanceId)` を呼び出す：
   - 即座効果（`immediate`）がある場合は `Player.applyImmediateEffect()` を実行
   - 持続効果（`continuous`）がある場合は `Player.applyContinuousEffect(effect, label)` で `activeContinuousEffects` に新規エントリを追加（同じアイテムを複数回使用しても合算せず別エントリとして独立保持）
   - 両方とも無いアイテムの場合のみログ表示のみでターン非消費
   - 効果適用後 `Inventory.removeItemById()` → `dispatchObjectEvent()`（敵の反撃ターン）
6. 使用後、`reopenCurrentList()` が現在の `listMode`（`'inventory'` なら統合リスト）で一覧を再構築し、対象が空になったら `closeList()` で UI を閉じる
7. `closeList()` は `resetKeys()` で Phaser Key 状態をクリアしてから `keyboard.enabled = true` に戻す（`enabled=false` 中に取りこぼした keyup により `Key.isDown` が固定される副作用の対策）

### ImmediateEffect で扱える特殊キー

| キー | 内容 |
| --- | --- |
| `<stat>: number` | 能力値変動（`addStat` 経由、fluctuation クランプ） |
| `applyEffect: <effectName>` | 状態異常を付与（`effects.yml` 参照）。`Player.getEffectiveResists()` に含まれる場合は付与せず `resistedEffects` に記録 |
| `clearEffect: <effectName>` | 状態異常を解除 |
| `learnSkill: <skillName>` | スキルを習得（`skills.yml` 参照、既習得時はログ「習得済み」のみだがアイテムは消費。同 `ImmediateEffect` 内で他効果と併記可） |
| `executeSkill: <skillName>` | アクティブスキルを即時発動（コスト無し・未習得不問・スタンチェック無し）。`target: front` のスキルは UI が方向選択モードに切り替わり、確定時のみアイテム消費 + スキル発動／キャンセル時はアイテム非消費。パッシブ系（`trigger: on_attack`/`on_turn`/`on_damage`/`passive`）は `YamlCrossValidator` で起動エラー。サンプル: 爆発の巻物 (`executeSkill: explosion`) |
| `add_modifier: <modifierName>` | 装備中で modifier の `target` type に一致する全アイテムに modifier を付与（countable は +1 でスタック、max クランプ。未付与なら count=1）。対象不在時はログ「しかし何も起こらなかった」 |
| `remove_modifier_kind: { kind, target }` | `target` で指定したスロット（`all_equipped`/`weapon`/`main_armor`/`sub_armor`）の装備から `kind` タグ一致の modifier を一括除去。対象不在/該当 modifier なしで `modifierNoTarget` フラグが立つ |

### アイテム投擲（`throwEffect` / 効果転用）

「投げる」アクションで装備していない所持アイテムを直線方向へ投擲できる（処理フロー・直線走査・射程は [combat.md](./combat.md) の「アイテム投擲システム」を参照）。ここではアイテム定義側の仕様を扱う。

`ItemDefinition.throwEffect?: ThrowEffectEntry[]`（`ItemsLoader`）— 投擲して敵に命中したときに発揮する効果。指定があれば下記の既定転用より **最優先**。各エントリは1種別を指定し配列で複数列挙可：

| キー | 内容 |
| --- | --- |
| `damage: number \| formula` | `executeDamageAction` で評価（caster 実効値 `<stat>`/`<stat>_max`、`target_<stat>`、level、exp を変数に取る） |
| `apply_effect: <effectName> \| { effect, rate }` | `executeApplyEffectAction` で敵に状態異常付与（rate は数値 or formula） |
| `clear_effect: <effectName>` | 命中した敵の当該状態異常を解除 |

`throwEffect` を持たないアイテムの既定の敵への効果（`ThrowResolver.applyThrowHit`）：

| アイテム種別 | 投擲命中時の効果 |
| --- | --- |
| `weapon` | 仮装備ダメージ（`Player.getThrownWeaponFormulaVars` で武器スロットを差し替えた実効値を `enemy.takeDamageFromPlayer` へ） |
| `consumable` | `immediate` の `applyEffect` / `clearEffect` / 数値 stat を敵へ転用（`life` 減少はダメージ表記・`notifyDamageTaken` 連携）。加えて `continuous`（数ターンの能力値変動／耐性）も `Enemy.applyContinuousEffect` で敵に付与する。`learnSkill`・`executeSkill`・`add_modifier`・`remove_modifier_kind` は無視。回復薬・強化薬を敵に投げると敵を利する（利敵を許容。`弱体の薬` 等で敵をデバフできる） |
| `main_armor` / `sub_armor` | 投げ損（消滅のみ）。救済したい防具は `throwEffect` を付ける |

検証：`validateItemDefinition` が `throwEffect` の形状を、`YamlCrossValidator` が `apply_effect` / `clear_effect` の effect 名を effects.yml と照合する。

### 装備・消耗品・effect に持たせる resist

派生パラメータ `resist`（effect 名の文字列配列）を以下の経路で動的に獲得できる：

- 装備系アイテム：`effect.resist: [<effectName>...]`（トップレベル、装備中のみ有効）
- 消耗品の持続効果：`effect.continuous.resist: [<effectName>...]`（持続ターン中のみ有効）
- status effect 自身：`effects.yml` のトップレベル `resist: [<effectName>...]`（その状態が付与されている間のみ有効）
- 敵：`enemies.yml` トップレベル `resist: [<effectName>...]`（敵が状態異常付与を受け付けない／敵が状態異常になる経路は未実装で、判定のみ準備）

`Player.applyStatusEffect(name)` の戻り値は `'applied' | 'resisted' | 'unknown'` の union。`'resisted'` のときは message-log に「○○を耐性で防いだ！」を出力する（呼び出し側で対応）。新規付与の阻止のみを行い、既に付与されている同名異常を解除する効果は持たない。

### 持続効果のターン進行

`DungeonMap.dispatchObjectEvent()` は player の行動 → 敵反撃 を処理した最後で `Player.tickContinuousEffects()` を呼び、各エントリの残ターン数を1減らします。残ターン数が 0 以下になったエントリは削除され、「○○の効果が切れた」とログ出力されます。

敵も同形式の持続効果を持ち（投擲消費アイテムの `continuous` 等で付与）、`MapGenerator.tickEnemies()` が `enemy.act()` → `tickStatusEffects()` の後に `enemy.tickContinuousEffects()` を呼んで 1 ターン進めます。期限切れ時は「○○の△△の効果が切れた」とログ出力されます。

持続効果のロジック本体は `ContinuousEffectManager`（`src/lib/ContinuousEffectManager.ts`）に集約されており、Player / Enemy が 1 つずつ保持して `apply` / `tick` / `getBonuses` / `getResists` / `serialize` / `restore` を委譲します。

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

- `onAction`：行動主体（プレイヤー／敵）の行動入力時。`_action` で行動を**強制**または**禁止**できる
- `onTurnEnd`：ターン終了時（`dispatchObjectEvent` 内、`tickContinuousEffects` の後）
- `permanent`：常時（`Player.getEffectiveStat` 計算時に formula を順次適用）

特殊 target `_action`：

- `value` はアクションノード（文字列 / `[verb, arg]` / `[random|repeat, [...]]`）の単体またはリスト。データ仕様の全リストは [MANUAL_DEV.md](../../MANUAL_DEV.md) の「`target: _action`」節を参照
- 2 系統：**force**（`skip`/`attack`/`attack_self`/`move`/`use_item`/`equip`/`unequip`/`use_skill` ＝入力を上書きしてターン消費）と **forbid**（`not_move`/`not_skill`/`not_attack`/`not_action` ＝一部入力を拒否・ターン非消費）
- 解決は純粋関数 `src/lib/effects/StatusActionResolver.ts`（`aggregateDirective`）。Player は `getPlayerActionDirective`、Enemy は `getActionDirective` が呼び、戻り値は `{ forbid: Map<category,msg>, force? }`
- リスト選択は効果ごとの `actionIndex`（後述）。実行は Player=`src/lib/map/ForcedActionExecutor.ts`、Enemy=`Enemy.executeForce`。入力ゲートウェイは `Game.handlePlayerActionDirective(category)` に集約し、メニュー操作（アイテム/装備/スキル/足下）も `ItemListController.blockByDirective` で gating する
- 複数効果同時付与：forbid は和集合、force は付与順で最初の 1 つ。force のカテゴリが forbid に入れば `skip` へ降格。敵では item/equip/skill 系 force と `not_skill` は無効（skip 扱い）

`clear` セクション：

- `formula`：`count` を変数とした 0〜1 の確率式。ターン終了時（`onTurnEnd` 適用後 → `count++` の後）に評価
- `onDamage: true`：被弾した時にも即座に解除（Player は `Enemy.attackPlayer` から、Enemy は `Enemy.damage()` 内から `notifyDamageTaken()` が呼ばれる）

数式評価には `expr-eval-fork` ライブラリを使用。`Parser` で事前パースして `Expression` をキャッシュします（`EffectsLoader.getCompiledEffect`）。

### 主要 API（Player）

- `applyStatusEffect(name)`：効果を付与。同名効果が既にあれば `count` を 0 にリセット（重複は 1 エントリのみ）。戻り値は `'applied' | 'resisted' | 'unknown'`（`getEffectiveResists()` に含まれる effect は `'resisted'` を返して付与しない）
- `getEffectiveResists()`：装備 + 持続効果 + 付与中 status effect の `resist` を集約した `Set<string>`
- `getPlayerActionDirective()`：有効な `_action` 効果を集約した `AggregatedDirective`（`{ forbid, force }`）を返す純粋関数。UI / パッシブ判定が何度呼んでも `actionIndex` は進まない
- `markStatusEffectsActionEligible()`：行動決定時に呼び、有効効果へ「次の tick で `actionIndex` 前進可」の印を付ける（罠等の当該手番付与は対象外＝先頭要素が飛ばない）
- `tickStatusEffects()`：onTurnEnd 効果適用 → `count++`／印付き効果は `actionIndex++` → clear 判定。`MapObjectStore.dispatchEvent` から呼ばれる
- `notifyDamageTaken()`：被弾時に `clear.onDamage: true` のエントリを即座に解除。`Enemy` の around-1 攻撃ハンドラから呼ばれる
- `getEffectiveStat(key)`：base + 装備 + 持続効果ボーナスに加え、`permanent` 効果の formula を順次適用した値を返す
- `getActiveStatusEffects()`：UI 表示用のスナップショット（label, description, count）

### 主要 API（Enemy）

Player と同じシグネチャ・同じ意味で以下を実装：

- `applyStatusEffect(name)` / `clearStatusEffect(name)` / `getActiveStatusEffects()`
- `getEffectiveResists()`（definition.resist + 持続効果の resist + 付与中 effect 自身の resist を集約）
- `getEffectiveStat(key)` / `getEffectiveFormulaVars()`（base → continuous ボーナス → permanent 効果 formula の順で反映した実効値。装備は持たないが、continuous は Player と同形式で持つ）
- `applyContinuousEffect(effect, sourceLabel)` / `tickContinuousEffects()`：Player と同形式の持続効果。`ContinuousEffectManager` に委譲。投擲消費アイテムの `continuous` 付与と `MapGenerator.tickEnemies()` のターン進行で使用
- `getActionDirective()` / `markStatusEffectsActionEligible()` / `executeForce()`：Player と同形式。`Enemy.act()` 先頭で評価し、force なら `executeForce`（item/equip/skill 系は skip 扱い・`attack_self` で自滅した敵は `tickEnemies` が回収）、forbid なら攻撃/移動を制限
- `tickStatusEffects()`：Player と同じく onTurnEnd → count++ → clear 判定。`MapGenerator.tickEnemies()` から `enemy.act()` 後に呼ばれ、結果は message-log に流される
- `notifyDamageTaken()`：`Enemy.damage()` の内部から呼ばれる。`takeDamageFromPlayer()` は `{ dealt, cleared }` を返し、呼び出し側（AttackAction / DamageAction）がログを出す
- `Enemy.calculateDamageToPlayer` / `takeDamageFromPlayer` は実効値経路。`DamageAction` の formula 評価でも `target_<stat>` は実効値を渡す
- tick 経過で敵が死亡した場合は `MapGenerator.tickEnemies()` がマップから除去するが、経験値は付与しない（プレイヤーが直接倒したわけではないため）

### `count` / `actionIndex` の進行ルール

- 効果適用時は `count = 0` / `actionIndex = 0`
- `tickStatusEffects` の処理順序：(1) onTurnEnd を `count` 現在値で適用 → (2) `count++`（印付き効果は `actionIndex++` も）→ (3) clear 判定
- 例：stun の `count > 1 ? 1 : 0` は適用ターン末で `count=1`（解除されず）、次ターン onAction で skip → そのターン末で `count=2`（解除）→ "1 ターン動けない" と一致
- `actionIndex` は **`_action` リストの選択専用**で `count` とは独立。前進は「その効果が行動を支配した手番」のみ（`markStatusEffectsActionEligible` の印 → tick で前進）。付与した手番では印が付かないため、罠で自己付与しても先頭要素 `value[0]` が必ず最初に使われる。セーブ対象（旧セーブは 0 復元）

### デバッグ用付与

`Game.create()` で以下を公開しているため、ブラウザの DevTools コンソールから動作確認可能です：

- `window.applyStatusEffect(name)`：プレイヤーに状態異常を付与
- `window.applyStatusEffectToEnemy(name, instanceId?)`：指定 instanceId の敵、未指定なら視界内で最も近い敵に状態異常を付与（プレイヤー側から敵に状態異常をかける正規経路は未実装で、スキル action 化は次タスク）

トリガ機構（罠・敵・アイテム経由）はフレームワーク外で個別に実装します。

### EventBus イベント一覧（アイテム使用関連）

| イベント名 | 方向 | payload | 用途 |
| --- | --- | --- | --- |
| `open-item-list` | Phaser→Vue | `{ items: Array<{ id, label, description, ... }>, mode, actionLabel }` | 一覧 UI を開く・再描画する。`mode` は `'item' / 'equip' / 'drop' / 'skill' / 'throw' / 'inventory'`（`'inventory'` は統合インベントリ＝下部コンテキストバー方式） |
| `close-item-list` | Phaser→Vue | なし | 一覧 UI を閉じる確定通知 |
| `close-item-list-request` | Vue→Phaser | なし | Vue 側（ESC/キャンセル/外側トリガ）からのクローズ要求 |
| `use-item` | Vue→Phaser | `{ instanceId: string }` | アイテム使用確定 |
| `equip-item` | Vue→Phaser | `{ instanceId: string }` | 装備変更確定（統合インベントリの「装備」） |
| `throw-item` | Vue→Phaser | `{ instanceId: string }` | 投擲確定（→ 方向選択モードへ移行） |
| `drop-item` | Vue→Phaser | `{ instanceId: string }` | 設置確定（足下に置く／満杯時の入れ換え） |
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

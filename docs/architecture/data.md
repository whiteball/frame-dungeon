# データ駆動設計 / base.yml / YAML 横断バリデーション

[← 索引へ戻る](../architecture.md)

YAML ファイルによるデータ定義の仕組みと、各 Loader、`base.yml` の中核設定、起動時の横断バリデーションを扱います。

## データ駆動設計

ゲームデータはYAMLファイルで管理されています：

- **base.yml**（`public/data/base.yml`）: ゲーム全体の中核設定。ゲーム名・最終フロア・ダメージ式・経験値式・レベルアップボーナス・フロア毎構成・敵自動湧き判定式を保持。詳細は後述「base.yml — ゲーム全体設定」参照
- **stats.yml**（`public/data/stats.yml`）: プレイヤーのステータス定義（HP、MP、攻撃力、防御力など）。`order` で InfoView 表示順を制御（未指定は非表示）、`default` で「この値と一致するとき非表示」を指定可能。初期値は `base.yml` の `playerInitialStats` で定義
- **items.yml**（`public/data/items.yml`）: アイテム定義（武器、防具、消耗品）
- **enemies.yml**（`public/data/enemies.yml`）: 敵の定義（HP、攻撃力、防御力、経験値、表示色）。`walk` フィールドで移動パターンを指定（[combat.md](./combat.md) の「敵システム」参照）
- **effects.yml**（`public/data/effects.yml`）: 状態異常/強化効果の定義（毒、麻痺、睡眠、強化など）
- **traps.yml**（`public/data/traps.yml`）: トラップの定義（トゲの床、毒の沼、装備解除罠など）
- **skills.yml**（`public/data/skills.yml`）: スキル定義（コスト・ターゲット・action 列・習得条件）。詳細は [skills.md](./skills.md) を参照
- **item_modifiers.yml**（`public/data/item_modifiers.yml`）: アイテム修飾状態（呪い・強化・弱化など）の定義。`effect[].name` は `add_stats`（formula 評価結果を target stat に加算）/ `cannot_unequip`（装備解除ブロック）のいずれかをオブジェクト形式で記述。`target: [weapon|main_armor|sub_armor|consumable]` で適用可能 type を指定、`countable: true` の modifier は `max` と `initial.{min,max}` を伴い重ねがけ可能。`kind` タグで解呪等の一括除去対象を分類、`weight` はフロア床配置・敵ドロップ時の抽選重み。詳細は [items.md](./items.md) の「アイテム修飾状態（modifier）」節を参照。ZIP カスタムデータでは欠落許容（後方互換のため optional 扱い）
- **events.yml**（`public/data/events.yml`）: 汎用イベントオブジェクト（回復ポイント・祭壇・能力依存判定・選択肢メニュー等）の定義。`base.yml.floors[].events` で参照し、`MapInteractionHandler.investigateEvent` が C キー調査経由で起動する。詳細は [events.md](./events.md) を参照

各データファイルは対応するLoaderクラス（`BaseLoader`、`StatsLoader`、`ItemsLoader`、`EnemyLoader`、`EffectsLoader`、`TrapsLoader`、`SkillsLoader`、`ItemModifiersLoader`）によって読み込まれます。

### Loader クラスと YamlDefinitionStore

`StatsLoader` / `ItemsLoader` / `EnemyLoader` / `EffectsLoader` / `TrapsLoader` / `SkillsLoader` / `ItemModifiersLoader` はシングルトンパターンを持つクラスで、固有のバリデーションとドメイン固有ゲッターのみを実装します。fetch・YAMLパース・格納・基本ゲッターの共通処理は `YamlDefinitionStore<T>`（`src/lib/YamlDefinitionStore.ts`）に委譲されます（コンポジション）。

`BaseLoader` は単一スカラー/フォーマット混在の構造（`floors[]` 配列、複数 formula、スカラー定数）のため `YamlDefinitionStore` に乗らず独自に fetch/parse する。

```text
StatsLoader ──────────┐
ItemsLoader ──────────┤
EnemyLoader ──────────┼─── YamlDefinitionStore<T>（fetch / parse / store / getAll / getByName）
EffectsLoader ────────┤
TrapsLoader ──────────┤
SkillsLoader ─────────┤
ItemModifiersLoader ──┘

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
| `playerInitialStats` | 任意 | 全ステータス `0` | `stats.yml` で定義した各ステータスの開始値（例: `life: 100`）。未記載ステータスは `0` |
| `defaultDamageStat` | **必須** | — | プレイヤー死亡判定・トラップダメージ等のデフォルト対象ステータス名（通常 `life`） |
| `defaultEnemyDamageStat` | 任意 | `defaultDamageStat` | 敵側のダメージ対象 |
| `regenerate` | 任意 | `[]`（自動回復なし） | 一定ターンごとの自動回復ルール配列。各要素 `{ target, turn, formula }`。後述「自動回復 (`regenerate`)」参照 |
| `longStay` | 任意 | `null`（機構無効） | フロア長居時の警告/強制移動メッセージ配列。3要素以上のとき先頭3要素を `[50%警告, 75%警告, 100%強制]` として採用。後述「フロア長居警告/強制移動」参照 |
| `longStayFactor` | 任意 | `4` | 規定ターン数の倍率。`floors[].longStayTurns` 未指定時に `width * height * longStayFactor` で算出 |

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

### 自動回復 (`regenerate`)

配列。各エントリは `{ target, turn, formula }`：

- `target`: 回復対象のステータス名
- `turn`: 回復周期（正の整数ターン）。`turnCount % turn === 0` のターンで発火
- `formula`: 回復量。`Math.floor(...)` で整数化され、正の値のみ `addStat()` 経由で加算（`fluctuation` 許可ステータスは最大値でクランプ）

formula 内ではプレイヤーの実効ステータス値と、`<stat>_max` 形式の最大値（例: `life_max`）を参照可能。

```yaml
regenerate:
  - target: life
    turn: 10
    formula: "floor(life_max * 0.01) <= 0 ? 1 : floor(life_max * 0.01)"
  - target: magic
    turn: 30
    formula: "floor(magic_max * 0.01) <= 0 ? 1 : floor(magic_max * 0.01)"
```

`MapGenerator.dispatchObjectEvent()` が `_turnCount` インクリメント前に評価する。未定義/空配列なら自動回復は発生しない。回復時に message-log は発行されない。

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
      itemModifierChance: 0.15  # 任意。床配置アイテムに modifier を付与する確率 (0..1)
      itemModifierPool:         # 任意。modifier 名 → 追加重み（item_modifiers.yml の weight と乗算）
        power_reinforced: 3
        cursed: 1
      enemyDropPool:            # 任意。フロア共通の敵ドロップ追加プール
        - item: potion          # items.yml のアイテム名
          rate: 0.05            # ドロップ確率 (0..1) 独立判定
          modifierChance: 0.5   # 任意。当該ドロップの modifier 付与確率上書き
      secretRoom: yes           # 任意。true/'yes' で 50%、数値ならその確率で隠し部屋を生成
      secretRoomDoorVariants:   # 任意。隠し部屋扉のバリアント重み（後述）
        plain: 1                # 壁偽装のみ（従来）
        locked: 1               # 施錠のみ
        lockedDisguised: 1      # 偽装＋施錠
      extraDoorRate: 0.3        # 任意。MST 連結後に冗長隣接へ扉を追加する確率 (0..1)。未指定で 0.3
      respawnCycle: 20          # 任意。敵リスポーン間隔ターン数。未指定で 20
      longStayTurns: 1500       # 任意。長居警告/強制移動の規定ターン数（絶対値）。指定時は longStayFactor より優先
      eventCount: { min: 1, max: 2 }  # 任意。配置するイベント数（trapCount と同形：数値単独 or { min, max }）
      events:                   # 任意。出現イベントプール（events.yml 参照）
        - healing_fountain      # 文字列で重み 1
        - { name: heavy_rock, weight: 2 }  # オブジェクトで重み指定
      treasure:                 # 任意。隠し部屋に出現する宝箱の設定（secretRoom 有効時のみ機能）
        rate: 0.5               # 各隠し部屋ごとの宝箱出現確率 (0..1)
        trapRate: 0.5           # 開封時にトラップ発動する確率 (0..1)
        items:                  # 中身候補。bias を重みとして 1 つ抽選
          - name: iron sword    # items.yml のアイテム名
            modifiers:          # 任意。抽選後に必ず付与される modifier
              - name: power_reinforced
                count: 2
            bias: 3
          - name: round shield
            bias: 2
```

`enemies` 内で `enemies.yml` に存在しない名前は warn + スキップ。`traps` も同様。`trapCount > 0` で `traps` が空の場合は warn のみ。

**`itemModifierChance` / `itemModifierPool`:**

- `itemModifierChance` (0..1) はフロア床配置時の modifier 付与確率。未指定または 0 なら付与なし。`ItemFactory.createItem(name, { rollModifiers: true, floor })` 経由で生成された Item にのみ適用される
- `itemModifierPool` を指定すると **列挙された modifier 名のみが候補** となり、抽選重みは `item_modifiers.yml` の `weight` × pool の値で決まる（積算）
- `itemModifierPool` を省略すると `item_modifiers.yml` の全 modifier が候補となり、各 `weight` のみで抽選される
- `itemModifierPool` 内に存在しない modifier 名や負の重みがあれば `YamlCrossValidator` がエラーを返す

**`extraDoorRate`:**

- 値域 (0..1)。範囲外の値は clamp、未指定/非数値なら既定 `0.3` が採用される
- `MapBuilder.setWall` の扉配置フェーズで `Phase A の壁開放 + 通路同士接続` 後の連結性をセル単位 Union-Find で判定し、両側セルが別コンポーネントなら必ず扉を設置（MST により全非進入禁止部屋の連結を保証）。同一コンポーネントの冗長な隣接ペアに対しては `extraDoorRate` の確率で追加扉を生やす
- `0` に近いほど一本道寄りの迷路、`1` で従来通り全隣接ペアに扉が生える状態となる
- 既存ロジックの「ランダム y/x 抽選で扉位置を決定」は維持しつつ、境界上の有効セルを全列挙してから抽選する形に変更されているため、抽選失敗による扉欠落が発生しない

**`respawnCycle`:**

- 値域は正の整数。0以下や非数値・未指定なら既定 `20` が採用される
- `DungeonMap.dispatchObjectEvent()` 内、ターンカウントを増やす直前に `_tryRespawnEnemy()` が走り、`getFloorTurnCount() % respawnCycle === 0` のとき判定する
- 生存敵数 `aliveCount` が `enemyCount` 未満なら `(enemyCount - aliveCount) / enemyCount` の確率で抽選 → `randomEnemyPool`（`count` 未指定エントリ）からランダムに1体を選び、`getRespawnCandidatePositions()` の候補セルに配置する。固定敵 (`fixedEnemies`) はリスポーン対象外
- 配置候補の除外条件：プレイヤーのいる部屋ゾーン（接続通路含む）、プレイヤー部屋に8方向隣接する部屋ゾーン、隠し部屋、通路セル全般、`StairsObject` / `TrapObject` / `ItemObject` / `TreasureObject` の真上、`isCellBlocked` が真のセル、プレイヤーセル。候補が0個の場合はリスポーンしない
- 8方向隣接判定：プレイヤーゾーンを構成する全矩形（部屋＋接続通路）を1セル分外側に拡張し、いずれかが他部屋矩形と重なれば隣接とみなす。プレイヤーが通路に立っているとき、通路1セルを挟んで壁越しに隣接する部屋へリスポーンしてしまうのを防ぐため
- リスポーン成功時はメッセージログを発行しない（探索の緊張感を保つため）

**フロア長居警告/強制移動 (`longStay` / `longStayFactor` / `longStayTurns`):**

- 同一フロアに留まりすぎてレベル上げが無限に成立するのを抑制するための機構。`base.yml` トップレベルに `longStay`（メッセージ3要素配列）を定義しないと機構自体が無効
- 規定ターン数の解決順：フロアの `longStayTurns`（絶対値）> トップレベル `longStayFactor` × `floor.width × floor.height`（既定倍率 4）
- `DungeonMap.dispatchObjectEvent()` 内、`_turnCount++` 直後に `_checkLongStay()` が走り、`getFloorTurnCount()` が規定ターン数の 50% / 75% / 100% を **初めて超えた1ターン** で `EventBus.emit('long-stay-warning', stage, message, turn)` を発火する（各 stage は1度のみ）
- Game シーン側のリスナーは `message-log` にメッセージを流し、`stage === 1` / `stage === 2`（50% / 75% 警告）のときは `enterLongStayWarningMode()` で「確認」ボタンのみのシーンアクションに切り替える。これにより `isModalMode` が真となり、移動・攻撃・カニ歩きなどすべてのキー入力がブロックされる。「確認」押下で `exitLongStayWarningMode()` がデフォルトシーンアクションへ復帰させる（ユーザーがログを見逃さないための注意喚起モーダル）
- `stage === 3`（100% 強制移動）のときは確認モーダル無しで `floor++` & `go-to-next-floor` イベント発火（強制フロア遷移）。フェイルセーフとして直前に `exitStairMode()` を呼びシーンアクションをデフォルトへ戻す
- 最終フロア（`floor >= goalFloor`）では機構が完全に無効化される（警告も強制移動も発動しない）
- フロア遷移時に `resetFloorTurnCount()` 内で `_longStayStage` が 0 にリセットされる

**`secretRoom`:**

- `true` / `'yes'` → 確率 0.5、`number`（0..1）ならその確率、`false` / 未指定 → 無効
- マップ生成完了後、出入口（扉）が **1 つしかない部屋** を全部屋から走査し、候補から 1 部屋だけランダム抽選 → 上記確率で「扉を壁に偽装」した隠し部屋に変換する
- 候補抽出時、外周境界に「壁も扉も無い開放セル」を持つ部屋（`_addConnected` 等で隣接部屋／通路と直結された部屋）は `MapGenerator._hasOpenBoundary` で除外する。扉以外の侵入経路があると秘密の扉を経由せず入れてしまうため
- 隠し部屋には階段・アイテム・トラップ・敵・プレイヤー初期位置を配置しない（`DungeonMap.getRandomPos({ withoutSecretRoom: true })`）。ただし非隠し部屋に置けない場合は `setPlayerRandom` が隠し部屋へのフォールバック配置を許可する
- 偽装中の扉は MainView / MiniMapView の両方で壁として描画され、フォグ可視判定でも壁扱いされる。プレイヤーが隣接して「調べる」（C キー → `trySearch`）で正しい方向を選ぶと `PlayerActions.searchAt` が `dungeon.revealDisguisedDoor` を呼び `「隠し扉を発見した！」` を message-log に流して通常扉に戻す
- 偽装状態は `DungeonSaveData.disguisedDoors` / `secretRoomRects` でセーブ/ロードに永続化される

**`secretRoomDoorVariants`:**

- 隠し部屋の入口扉のバリアントを重み付き抽選で決定する。各キーは非負の数値で抽選重みを表す
- フォーマット：`{ plain: <weight>, locked: <weight>, lockedDisguised: <weight> }`
- 未指定または全 0 のとき `{ plain: 1, locked: 1, lockedDisguised: 1 }`（均等 3 分）にフォールバックする
- 各バリアントの挙動：

  | 名前 | 偽装 | 施錠 | 解除方法 | 視覚 |
  | --- | :-: | :-: | --- | --- |
  | `plain` | ○ | ─ | C キー調査で偽装解除 | 偽装中は壁、解除後は通常扉 |
  | `locked` | ─ | ○ | 対応する鍵 EventObject を調査 | 取っ手の代わりに黄黒警告ストライプ帯付きの扉 |
  | `lockedDisguised` | ○ | ○ | C キーで偽装解除 + 鍵で施錠解除（順不同・独立） | 偽装中は壁、偽装解除後は警告帯付きの施錠扉 |

- 施錠扉は `DungeonMap._lockedDoors: Set<string>` で管理。`isDoorPassable` が壁扱いし、プレイヤー/敵の通行・攻撃・経路探索・扉開放描画をすべてブロックする
- プレイヤーが施錠扉に向かって移動を試みると `movePlayer` が `「鍵が掛かっている。」` を message-log に流す（ターンは消費しない）。C キー調査でも同じメッセージが出る
- 施錠扉ごとに 1 個ずつ、`events.yml` の `secret_room_key` 定義から `EventObject` を生成しフロアのランダム位置に配置する（`FloorPopulator` 内で `dungeon.getLockedDoors()` を参照）。`EventObject.linkedDoor` に対応扉の座標を注入し、調査時に `EventExecutor` の `unlock_door: self` action が `dungeon.unlockDoor(...)` を呼ぶ
- 施錠状態は `DungeonSaveData.lockedDoors` で永続化。鍵 EventObject の linkedDoor は `MapObjectSaveData.event.linkedDoor` で永続化される
- **可用性チェック**: `events.yml` に `secret_room_key` が未定義の場合、`YamlCrossValidator` が起動時に `BaseLoader.setLockedDoorsAvailable(false)` を呼び、全フロアの `secretRoomDoorVariants` を `{ plain: max(配置値, 1), locked: 0, lockedDisguised: 0 }` に強制する。解錠手段が無いまま入れない部屋が生成されるのを防ぐためのフェイルセーフ（カスタムデータで events.yml を最小化した場合などに有効）

**`treasure`:**

- 隠し部屋ごとに `rate` で配置抽選。配置先は **扉前以外の通行可能セル**（`DungeonMap.findDoorsInRoom` で扉セルを除外し、敵/階段/トラップ等の `excludePositionList` 上のセルも除外）
- 中身は `items[].bias` を重みとした重み付き抽選で 1 アイテム決定（`Game.pickTreasureItem`）。`ItemFactory.createItem(name)` で modifier ロール無しでインスタンス化したうえで、`items[].modifiers[].name`/`count` をそのまま `setModifierCount` で適用する（フロアの `itemModifierChance` とは独立）
- 宝箱セルは敵と同様に進入禁止（`DungeonMap.isCellBlocked` が `TreasureObject` を判定）
- 開封操作: C キー → `trySearch` の方向選択 → 対象セルに `TreasureObject` があれば `Game.openTreasure` が起動。`trapRate` で判定し、当該フロアの `trapPool` からランダム 1 つ選んで `applyTrapEffects` を呼出（trapPool 空なら何も起こらない）。その後 `TreasureObject` を削除し抽選アイテムを `ItemObject` として同セルに配置 → `dispatchObjectEvent()` でターン進行
- セーブ/ロードは `MapObjectSaveData` の `type: 'treasure'` ケース（item / trapRate / trapPool）で永続化される

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

## traps.yml — トラップ定義

`traps.yml` の各エントリは `TrapDefinition`（`src/lib/TrapsLoader.ts`）にマップされ、`base.yml.floors[].traps` で参照されてフロアごとの `trapPool` に格納される。

```yaml
- name: spike                # 識別子
  label: トゲの床             # 表示名
  description: トゲが生えた床  # 説明
  effect:                    # 踏み発動時に順次適用される効果
    - type: stat             # ステータス変動（target / value 必須）
      target: life
      value: -10
    - type: addEffect        # 状態異常付与（value=effects.yml の名前）
      value: poison
    - type: unequip          # 装備強制解除（target / value 不要、cannot_unequip も無視）

# 拡張: 最初から見えるトラップ + 表示カスタマイズ
- name: healing_pad
  label: 回復パッド
  description: 踏むと淡く光るパッド。意図して起動すると体力が回復する
  visible: true              # 既定 false（隠れ罠）。true で最初から見える
  appearance:                # 既定: 赤×ピラミッド（X_CROSS / 0xFF0000 / PYRAMID）
    mark: o                  # MapMark の値: 'o' / '*' / '<>' / '+' / 'x' / '[]'
    color: 0x66CCFF          # 0xRRGGBB 数値 or '#RRGGBB' / '#RGB' / '0xRRGGBB' 文字列
    shape: cylinder          # フレンドリ名: none / sphere / cube / box / cylinder / pyramid
    concentric_circle: true  # 床マーカーを同心円で描画（既定 false）
  effect:
    - type: stat
      target: life
      value: 30
```

**`visible` フィールドの挙動：**

- `visible: false`（既定）: 従来通りの隠れ罠。プレイヤーが踏むと自動発動 + 同時に可視化される
- `visible: true`: 最初から見える。**踏んでも自動発動しない**（既存の「探索済み罠は踏み無効化」ロジック `buildTrapObject` 内 `if (object.visible) return true` に従う）。プレイヤーは可視マーカーを避けるか、`足下`（around-0-self）ボタンで `enterTrapConfirmMode` を出して意図的に発動する。回復パッドや祭壇のような「踏むかどうかプレイヤーが選べるオブジェクト」として機能

**`appearance` フィールド：**

- 全フィールド省略可。指定したフィールドのみ既定値を上書き
- `mark` / `shape` は文字列正規化済み（`TrapsLoader.parseAppearance`）。不正値は起動時 `alert` + throw で停止
- `color` は数値 (integer) に正規化済み。`'#RGB'` は `'#RRGGBB'` に展開される
- `concentric_circle` は MapObject の `concentricCircle` プロパティに対応（YAML では snake_case、JS では camelCase）

## YAML 横断バリデーション

`YamlCrossValidator.validate()`（`src/lib/YamlCrossValidator.ts`）は `GameDataLoader.loadAll()`（`src/lib/GameDataLoader.ts`）で全 Loader の `load()` を完了させた直後に走り、以下のクロス参照を検証する：

- `base.yml` の `floors[].enemies` / `floors[].traps` / `floors[].events` 名が `enemies.yml` / `traps.yml` / `events.yml` に存在するか
- `traps.yml` の `effect[].type === 'addEffect'` の `value` が `effects.yml` に存在するか
- `items.yml` の `effect.immediate.learnSkill` が `skills.yml` に存在するか
- `events.yml` action 内のクロス参照（`give_item` / `consume_item` → items / `spawn_enemy` → enemies / `learn_skill` / `execute_skill` → skills / `add_modifier` → item_modifiers / `apply_effect.effect` → effects 等）
- `enemies.yml` / `effects.yml` / `items.yml` の各 `resist[]` 要素が `effects.yml` に存在するか
- `base.yml` のオプションフィールド欠落（フォールバック適用のお知らせ）

`{ errors: string[], infos: string[] }` を返し、`errors.length > 0` のとき `EventBus.emit('yaml-cross-validation-errors', errors)` で `YamlErrorDialog` を表示。INFO レベルは現状コンソール出力のみ。

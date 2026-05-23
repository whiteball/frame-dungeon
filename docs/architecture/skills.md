# スキルシステム

[← 索引へ戻る](../architecture.md)

`skills.yml` で定義された data-driven なスキルを管理します。Phase 2 時点ではデータ基盤と永続化のみを実装しており、実発動・コスト評価・mastery 抽選・action 実行は後続フェーズで実装予定です。

## スキル定義（skills.yml）

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
| `hit` | 攻撃した相手（`on_attack` パッシブ専用）。`EnemySkillExecutor` が自動解決する |

`trigger` フィールド（省略時は `'active'`）：

| 値 | 意味 |
| --- | --- |
| `active`（省略可） | プレイヤーが能動的に使用するスキル（既存の全スキル） |
| `on_attack` | 通常攻撃後に自動発動するパッシブスキル。現在は敵専用（将来: 装備効果等） |

`on_attack` スキルはプレイヤーのスキルリストで `disabled: true`（表示名「パッシブスキル」）として表示され、手動発動はできない。`PlayerActions.useSkill` にもガードがある。

`mastery` の各エントリは `exact: N`（`{ least: N, rate: 1 }` のシュガー）または `least: N, rate: R`（0〜1）の形式。複数エントリがある場合、レベルアップ抽選時は post-level >= `least` を満たすうち `least` が最大のエントリのレートを使用する。

## Player.learnedSkills

`Player` に習得済みスキル名の `Set<string>` を保持。関連 API：

- `learnSkill(name)`：未習得・既定義スキルなら習得して `true`。未定義 or 既習得は `false`
- `hasSkill(name)`：習得済みかを判定
- `getLearnedSkillNames()`：習得済みスキル名の配列を取得
- `forgetSkill(name)`：習得を取り消す（デバッグ・テスト用）

セーブデータ（`PlayerSaveData.learnedSkills: string[]`）として永続化される。ロード時に `skills.yml` に存在しないスキル名は警告ログ + スキップ。

## スキル習得経路

スキルは以下の経路で習得できます：

- **レベルアップ抽選**：`skills.yml` の `mastery` 配列に基づき、`Player.levelUp()` 末尾で未習得スキルそれぞれを抽選。post-level >= `least` を満たすエントリのうち `least` が最大のものを採用し、その `rate` で抽選成功時に習得。`exact: N` は `{ least: N, rate: 1 }` の省略表記。`addExp` の複数レベルアップ時は各 `levelUp` ごとに走るため、レベル飛ばしでも各段階で抽選が発生する
- **アイテム使用**：消耗品の `effect.immediate.learnSkill: <skillName>` で習得。既習得スキルでもアイテムは消費され、ログ「習得済み」を表示する。同 `immediate` 内に `life: 30` 等の他効果を併記すると両方適用される
- **デバッグ用 `window.learnSkill(name)`**：DevTools コンソールから直接付与

## コスト評価・支払いフロー

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

## target 解決と方向選択 UI

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

## アクション実行

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

- **`reveal_trap`**（`src/lib/skills/actions/RevealTrapAction.ts`）：target スコープ内のセルにある未発見の `TrapObject` を `visible = true` にする。既に visible なトラップは無視。発見毎に「{label} を発見した！」ログを出す。caster ステータスは参照しない（パラメータシグネチャ統一のため受け取るのみ）

- **`apply_effect`**（`src/lib/skills/actions/ApplyEffectAction.ts`）：target スコープ内の各対象（プレイヤー or 敵）に状態異常を付与する。param 形式は以下の 2 通り：
  - 文字列：`apply_effect: poison`（rate=1.0 固定）
  - オブジェクト：`apply_effect: { effect: poison, rate: 0.6 }`（rate は数値リテラルまたは caster 実効値を変数とする数式文字列）
  
  `rate` が数式の場合は `expr-eval-fork` で実行時評価し [0,1] にクランプする。付与結果は `applyStatusEffect()` の戻り値（`'applied'` / `'resisted'` / `'unknown'`）に従ってログを出力する。effect 名の存在チェックは `YamlCrossValidator` が起動時に実施する。

- **`analyze`**（`src/lib/skills/actions/AnalyzeAction.ts`）：target スコープ内の生存敵について、ラベル・説明・ステータス・経験値・保有スキルを `--` で囲ったブロック形式でメッセージログに出力する。表示対象のステータスは `stats.yml` の各 stat について `getMaxStat > 0` のもののみ（未定義の 0/0 スロットは省略）。`fluctuation: true` のステータスは `current/max`、それ以外は実効値のみを表示。`description` ラベルは `StatsLoader.getDescription` を使用する。保有スキルは `enemies.yml` の `skills[]` を参照し、`skills.yml` の `label` と `description` を `ラベル（説明）` 形式で出力。複数敵が範囲内にいる場合は敵ごとに独立したブロックが発行される。caster ステータスは参照しない。

未知の action 名は警告ログのみで継続する。

## 敵のパッシブスキル（on_attack trigger）

敵は `enemies.yml` の `skills` フィールドでパッシブスキルを保有できる。

```yaml
# enemies.yml の例
- name: orc
  skills:
    - name: stun_strike   # skills.yml に trigger: on_attack で定義
      rate: 0.1           # 攻撃時の発動確率 (0–1)
```

`skills.yml` 側では `trigger: on_attack` + `target: hit` で定義する：

```yaml
- name: stun_strike
  trigger: on_attack
  target: hit
  action:
    - apply_effect: { effect: stun, rate: 1.0 }
```

**発動フロー**（`Enemy.attackPlayer()` 末尾）：

```text
通常攻撃ダメージ適用
  → プレイヤー生存チェック
  → skills[] をループ
     → Math.random() < entry.rate → executeEnemyOnAttackSkill()
        → SkillsLoader でスキル定義取得
        → action 配列を順次実行
           → apply_effect → player.applyStatusEffect() + ログ
```

複数スキルは独立した rate で並行評価される（同一ターンに複数発動しうる）。

`EnemySkillExecutor`（`src/lib/skills/EnemySkillExecutor.ts`）は
プレイヤー向け `SkillExecutor` とは別実装。理由：`apply_effect` の対象が
「キャスター（敵）に隣接するプレイヤー」であり、プレイヤー向け実装の
「キャスター自身がプレイヤーセルにいるなら caster に適用」という意味論と逆転するため。

クロスバリデーション（`YamlCrossValidator`）：`enemies.yml` の `skills[].name` が
`skills.yml` に存在し、かつ `trigger: on_attack` であることを起動時に確認する。

## 状態異常との相互作用

プレイヤーが `_action: skip` ディレクティブを持つ状態異常（麻痺・睡眠等）にかかっている間はスキル発動も封じられる。W/Space キーの既存挙動と整合させた「動けない！」+ 1 ターン消費の扱いで、防御を 2 段で構成する：

- **UI 側ガード**：`Game.buildSkillListPayload` がスタンを検出してスキル一覧の全項目を `disabled = true, disabledReason: '動けない'` に設定する。スタンはコスト不足判定より優先（ツールチップ上も「動けない」が表示）。プレイヤーは項目を見られるが click / dblclick / Enter で発動できない（`confirmSelect` の `it.disabled` 早期 return）
- **ライブラリ側ガード**：`PlayerActions.useSkill` の冒頭でも `Player.getPlayerActionDirective()` を検査し、スタン中は「動けない！」ログ発行 + `dispatchObjectEvent` でターン消費して return する。DevTools 等から直接 `dungeon.useSkill` を呼んだ場合も同じく無効化される

スタン解除は既存の状態異常システム（`Player.tickStatusEffects` / `effects.yml` の `clear.formula`）に従う。

## スキル発動 UI フロー

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

## スキルのデバッグ用付与

`Game.create()` で以下のグローバルヘルパーを公開：

- `window.learnSkill(name)`：スキルを習得
- `window.forgetSkill(name)`：習得を取り消し
- `window.listSkills()`：習得済みスキル一覧を取得
- `window.addExp(n)`：経験値を `n` 加算（敵討伐と同じ経路で levelUp + mastery 抽選が走る）
- `window.levelUpN(n=1)`：経験値計算を介さず直接 `n` 回 `levelUp` を呼ぶ（純粋な mastery 抽選確認用）

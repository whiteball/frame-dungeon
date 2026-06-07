# 遠距離攻撃の設計メモ

[← アーキテクチャ索引へ](architecture.md)

通常攻撃（隣接マス）との差別化として「コストを伴う遠距離攻撃」を追加するための設計メモ。
3 つのアプローチを検討し、**方法3（スキルの `straight` target）を実装済み**。方法1・方法2 は
将来実装するため、本メモに調査結果・要点・実装時の注意を残す。

関連 TODO: [TODO.md](../TODO.md) の「アイテムの多様化 → 追加武器・防具 → アイテム投擲と遠距離武器」。

## 全体方針と共有資産

遠距離攻撃は「指定方向へ飛ばし、視界の通る一直線上の最初の敵に効果を発揮する」挙動が共通する。
これを支える基盤は既に揃っており、3 手法はこれらを再利用する：

| 基盤 | 場所 | 役割 |
| --- | --- | --- |
| 直線飛び道具の経路判定 | `src/lib/map/Projectile.ts` | `canProjectileStep`（壁・扉で停止）/ `isAnyWall` / `firstEnemyAlongRay`（射線上の最初の生存敵セルを副作用なしで返す） |
| アイテム投擲 | `src/lib/map/ThrowResolver.ts` | `resolveThrow`：直線走査して着弾/命中、効果適用。`canProjectileStep` を `Projectile.ts` から利用 |
| 遠距離スキル | `src/lib/skills/TargetResolver.ts` の `straight` | `firstEnemyAlongRay` で対象セルを決め、既存の `damage` / `apply_effect` / `attack` action がそのまま遠距離化 |
| 方向選択 UI | `Game.enterSkillTargetSelectMode` / `SceneModeController.enterSkillTargetSelectMode` / `getFrontCandidates` | 前方3方向（左/中央/右）の選択。`front` と `straight` で共有 |
| 視線判定（参考） | `src/lib/map/Pathfinding.ts` の `hasLineOfSight`（DDA） | 敵 AI 用。扉・壁を遮蔽とみなす点は `canProjectileStep` と同じ思想 |

**ポイント**：飛び道具の「方向選択 → 直線走査 → 最初の敵」という骨格は `Projectile.ts` に集約済み。
方法1・方法2 の遠距離判定はこれを呼ぶだけでよく、新規に経路探索を書く必要はない。

---

## 方法3: スキルの `straight` target（実装済み）

「視界の通る一直線上の最初の敵」を対象にする skill target。MP 等を `cost` に取る。

### 実装箇所

- `src/lib/SkillsLoader.ts`：`SkillTarget` 型と `VALID_TARGETS` に `'straight'` を追加
- `src/lib/skills/TargetResolver.ts`：
  - `resolveTarget` に `straight` ケース（`preSelectedCell` から単位ベクトルを導き `firstEnemyAlongRay` で対象決定）
  - `formatTargetSummary` に `'straight' → '直線'`
- `src/lib/map/Projectile.ts`：`firstEnemyAlongRay`（新規）。`canProjectileStep` を `ThrowResolver` から移設して共有
- `src/lib/map/PlayerActions.ts` `useSkill`：`front`/`straight` の「対象なし」差し戻し（straight は射線上に敵がいなければコスト・ターン非消費で空振り）
- `src/lib/skills/SkillExecutor.ts` `executeSkillFromItem`：同様に `straight` を「対象なし＝false」扱いに（将来の杖アイテム対応）
- `src/game/scenes/game/ItemListController.ts`：`use-skill` ハンドラと `findDirectionalExecuteSkill`（旧 `findFrontExecuteSkill`）を `front || straight` に拡張
- `public/data/skills.yml`：`toxic_dart`（毒矢、`apply_effect`）を `straight` 化、`magic_arrow`（魔法の矢、`damage`）を追加

### 仕様メモ

- 方向選択 UI は `front` と完全共有。`front` は選んだ隣接セルがそのまま対象、`straight` はその方向の射線を走査して対象を決める。
- 射線は壁・扉（`canProjectileStep`）と進入不可オブジェクト（`isCellBlocked`：宝箱・blocking イベント）で止まる。
- 射程は現状無制限（視界＝壁まで）。必要なら `firstEnemyAlongRay` の `maxRange` 引数でスキル別射程を導入可能（`SkillsLoader` に `range` フィールドを足して渡す）。
- 射線上に敵がいない場合はコスト・ターン非消費（寛容な挙動。`front` の未選択時と同じ扱い）。

---

## 方法2: 魔法の杖（道具＋使用回数）— 将来実装

装備せず「道具として使う」遠距離攻撃。使用回数（ランダム初期値）を持ち、0 で使用不可・投擲転用も可。

### 推奨アプローチ（既存資産の再利用）

- **遠距離効果は方法3に乗せる**：杖は「`straight` スキルを `executeSkill` で発動する消耗品」として定義すれば、
  遠距離ロジックは方法3で完結する。`executeSkill: magic_arrow` のような巻物と同形（方向選択 UI も
  既に `straight` 対応済み）。
- **使用回数は modifier システムを流用**：`item_modifiers.yml` の `countable: true` + `initial: {min, max}` が
  「インスタンス固有のランダムな初期カウント」をそのまま提供する（`ItemModifiersLoader.rollInitialCount`）。
  残回数を modifier の count で表現すれば、suffix ラベル表示（`[残3]` 等、`ItemLabelFormatter`）も流用できる。

### 実装ステップ（想定）

1. `item_modifiers.yml` に「チャージ」modifier を定義（`countable`, `max`, `initial`）。target は `consumable`
   （現状 modifier は装備系 type 想定なので、`Item.setModifierCount` / `addModifier` の `def.target.includes(type)`
   チェックが consumable を許すか要確認・調整）。
2. 杖アイテムを `consumable` + `executeSkill: <straight skill>` + チャージ modifier で定義。
3. **使用フローの分岐**：`PlayerActions.useConsumableItem` は使用後に必ず `removeItemById` する。
   チャージ式アイテムは「残回数 > 1 なら消さずに count を 1 減らす／1 で最後の使用後に消す or 投擲専用化」へ分岐が必要。
4. 残回数 0 で投擲転用したい場合は `throwEffect` を定義しておけば投擲フロー（`ThrowResolver`）に乗る。
5. UI：残回数を suffix ラベルで表示（modifier 流用なら自動）。

### 注意点

- modifier は現状「装備中のみ effect 発動」「target が装備系 type」を前提にしている箇所がある
  （`Item.setModifierCount` の `def.target.includes(this.definition.type)`、`getModifierStatBonuses` は装備時のみ
  呼ばれる）。チャージを modifier で表すなら「effect を持たない・count だけ使う modifier」として扱い、
  consumable を target に許す調整が要る。新規の per-instance フィールド（例 `Item.charges`）を足す案もあるが、
  セーブ往復（`Item.serialize`/`deserialize`）の追加が必要になる。modifier 流用ならセーブは既存の
  `modifiers` フィールドで賄える。
- 「装備して撃つ」設計にする場合は通常攻撃フロー（`tryAttackOrShowDirections`）に杖分岐が必要になり、
  方法1 と同様の重さが出る。**道具として使う設計が軽い**。

実装コスト見積り: **中**（遠距離は方法3再利用、回数管理は modifier 流用で軽量化可能。使用フロー分岐が主作業）。

---

## 方法1: 弓＋矢（武器種＋弾薬）— 将来実装・優先度低

装備したまま攻撃ボタンで遠距離攻撃する武器種。弾薬（矢）を消費する。
**最大の重量物はインベントリの「個数スタック」概念の新規実装**。優先度は低い。

### なぜ重いか（個数スタックの不在）

- `src/lib/Inventory.ts` は `Item[]` を **1 スロット 1 個** で保持する。`Item.quantity` フィールドと
  `serialize`/`deserialize` は存在するが、**容量計算・一覧表示・UI のいずれもスタックに使っていない**。
- 矢を 1 本 1 スロットで持つのは非現実的なので、以下すべてにスタック対応が波及する：
  - `Inventory.addItem`：同一定義（+同一 modifier 状態）のスタックへマージ、容量は 1 スロット計上
  - 一覧 UI（`src/components/PhaserGame.vue` のリスト、`ItemListController.buildItemListPayload`）：`矢 ×15` 表示
  - 取得・設置（`ItemObject`、拾得フロー、`drop-item`）：個数の分割/結合
  - 投擲（`ThrowResolver`）：スタックから 1 個だけ投げる
  - セーブ/ロード（`Inventory.serialize` は既に quantity を持つが消費ロジックが要る）

### 実装ステップ（想定）

1. **個数スタック基盤を先に作る**（これ単独で独立タスク。矢以外の消耗品にも恩恵）。
2. 弓を武器種として定義。`weapon` に `ranged: true` + 射程等のフラグを足すか、新 `ItemType` を足す。
3. **攻撃フロー分岐**：`Game.tryAttackOrShowDirections`（`src/game/scenes/Game.ts`）は現状隣接セルしか見ない。
   弓装備時は「隣接攻撃ではなく方向選択 → 直線走査（`firstEnemyAlongRay`）→ ダメージ」へ分岐。
   ダメージ計算は `enemy.takeDamageFromPlayer(player.getEffectiveFormulaVars())` を流用できる。
4. 矢の保持先を決める：
   - 案A: インベントリから直接消費（スタック前提）。装備スロット追加なし。**軽い**。
   - 案B: 専用の弾薬スロットを追加 → `Player` の装備スロット（`equippedWeapon` 等）・`serialize`/`deserialize`・
     装備 UI・ステータス表示すべてに波及。**重い**。
5. 矢が尽きたときの挙動（素手攻撃にフォールバック等）。

### 注意点

- 遠距離の「方向選択 → 直線走査 → 最初の敵」は方法3/投擲と同じく `Projectile.firstEnemyAlongRay` を再利用できる。
  **重いのは弾薬管理（個数スタック）であって、飛び道具判定ではない**。
- 「攻撃ボタンで撃てる直感性」が利点だが、装備切り替えの手間という欠点も伴う。

実装コスト見積り: **高**（個数スタック基盤が横断的。飛び道具自体は方法3再利用で軽い）。
個数スタックを本当に資源管理させたいかが固まってから着手するのが安全。

---

## まとめ

| 観点 | 方法1（弓＋矢） | 方法2（杖＋回数） | 方法3（straight skill） |
| --- | --- | --- | --- |
| 直感性・武器らしさ | ◎ | ○ | △（スキル扱い） |
| 操作のスムーズさ | ◎（攻撃ボタン） | ○（道具使用） | ○（スキル発動） |
| バリエーション展開 | △（弾種ごとに資源） | ○ | ◎（YAML だけ） |
| 新規基盤の重さ | 個数スタック（重） | 回数管理（modifier 流用で軽） | ほぼ無し |
| 実装コスト | 高 | 中 | 低（**実装済み**） |

方法3 を中核に据えると、方法2 は「`straight` スキルを発動する回数付き道具」、方法1 は「`straight` 判定を
攻撃ボタンに繋いだ武器（＋個数スタック）」として薄く乗る。

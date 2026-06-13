# マップオブジェクト / 敵 / 戦闘システム

[← 索引へ戻る](../architecture.md)

マップ上のオブジェクト管理、敵 AI、ターン制戦闘の流れを扱います。

## マップオブジェクトシステム

マップ上に配置されるオブジェクト（階段、トラップ、敵など）は`MapObject`基底クラスで統一管理されます：

- **MapObject**（`src/lib/MapObject.ts`）: 全オブジェクトの基底クラス。座標、表示マーク、色、イベントハンドラなどを保持
- **MapMark定数**: オブジェクトの表示形状を定義（`CIRCLE`, `STAR`, `DIAMOND`, `CROSS`, `X_CROSS`, `SQUARE`）
- **MapShape定数**: `MainView` でブロック中心に重ねて描画する立体形状を排他選択（`NONE` / `SPHERE` / `CUBE` / `BOX` / `CYLINDER` / `PYRAMID`）。`MapObject.shape` に設定すると `MainView.render()` が `object.color` で陰影付き描画する。`BOX`・`CYLINDER`・`PYRAMID` は床接地型（高さ = セル高さ/4、底面一辺または直径 = セル辺長/2）で、浮遊型の `SPHERE`・`CUBE` と異なり下部が床面に接する
- **MapObject.concentricCircle**: `MainView` の床マーカー描画形状フラグ。`true` で内側2層（`inner1` / `inner2`）を同心円（透視トラペゾイドにインスクライブした回転楕円）で描画し、X 字対角線も省略する。最外層（alpha 0.3）はセルからはみ出さないよう常に polygon。床に置かれた静的オブジェクトの表現に使う。楕円は `drawInscribedEllipse()` が多角形の対辺中点を結ぶ2本のベクトルを共役半直径 `a`, `b` として扱い、`M = [a b]` の `M·Mᵀ` の固有分解から主軸長と回転角度を計算し、`translateCanvas`+`rotateCanvas`+`fillEllipse` で描画する。平行四辺形なら4辺の中点が楕円上に厳密に乗る
- **MapObjectStore**（`src/lib/map/MapObjectStore.ts`）: 全オブジェクトを `Map<integer, MapObject>` で一元管理。`instanceof` で型別のフィルタリングが可能。`DungeonMap` は同名の薄い委譲メソッド（`addEnemy`、`getEnemy`、`removeEnemy` など）を公開する

## 敵システム

敵システムの構成：

- **EnemyLoader**: `enemies.yml`から敵データを読み込み、フロアに応じた敵を提供
- **Enemy**: `MapObject`を継承した敵クラス。座標は`MapObject`のプロパティとして自身が保持するため、敵の移動時にキーの差し替えが不要。`target` フィールド（プライベート）でターゲット座標を保持し、ターン間で持続する
- **DungeonMap / MapObjectStore**: 敵を他のオブジェクトと統一管理（`addEnemy`、`getEnemy`、`removeEnemy` などを `DungeonMap` 経由で呼び出すと `MapObjectStore` に委譲。`instanceof Enemy` によるフィルタリングを内部で実施）
- **Game Scene**: フロアごとに敵を自動生成・配置（フロア数に応じて難易度調整）

敵は3Dビュー上で球体（ダイアモンド形マーク）として表示され、各敵は`enemies.yml`で定義された色で描画されます。

敵を倒したときのアイテムドロップは `enemies.yml` の `drop: [{ item, rate, modifierChance? }]` と `base.yml` floor の `enemyDropPool` を additive に合成した結果に基づき、`src/lib/map/EnemyDropResolver.tryEnemyDrop` が処理する。詳細は [items.md](./items.md) の「アイテム修飾状態（modifier）」節を参照。

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
3. `hasLineOfSight(敵, プレイヤー)` が真 → ターゲットをプレイヤー位置に更新（`targetIsPlayerPos = true`）
4. `hasLineOfSight(敵, プレイヤー)` が偽で **`targetIsPlayerPos` が真**（プレイヤー追跡中）かつ現在のターゲットへの視線がある → ターゲット地点の扉の先をターゲットに更新（追跡中のみ。ウェイポイント追従時は発動しない）
5. ターゲットなし → `getDoorTargetsInZone(敵位置)` で扉出口候補を取得し、Mooreネイバーフッド（チェビシェフ距離1）外からランダム選択。さらに `lastEnteredFrom`（直前に越えた扉の出発セル）と一致する候補を除外して逆行を防ぐ（`targetIsPlayerPos = false`）
6. ターゲット設定不能 → ランダムウォーク（フォールバック）。`randomWalkCount` をインクリメントし、10ターン連続でランダムウォークしたら `lastEnteredFrom` をリセットして行き止まりからの脱出を許可
7. `findPath(現在地, ターゲット)` で経路取得 → 先頭方向へ1歩移動。到達不能時はターゲットをクリアしてランダムウォーク
8. 移動時に扉を越えた場合は `lastEnteredFrom` に出発セルを記録し `randomWalkCount` をリセット
9. **`targetIsPlayerPos` が真**で、移動後の新位置からプレイヤーへの視線が通る場合 → ターゲットをプレイヤー現在地に即時更新（追尾遅れを防ぐ）
10. ターゲット到達 → ターゲットをクリア

関連する `DungeonMap` の公開メソッド：

- `hasLineOfSight(x1, y1, x2, y2)`: 2点間に壁・扉がなく視線が通るかを直線走査（DDA）で判定
- `getDoorTargetsInZone(enemyX, enemyY)`: 敵位置から壁・扉のない境界を BFS で展開し、視覚的に繋がった開放空間内の全扉から1マス外側の座標リストを返す

### 敵リスポーン

フロア滞在中の緊張感を維持するため、`DungeonMap.dispatchObjectEvent()` の末尾（`_turnCount++` の直前）で `_tryRespawnEnemy()` が走り、一定ターンごとに敵を補充します：

- 発火条件: `getFloorTurnCount() % floorConfig.respawnCycle === 0`（`respawnCycle` は `base.yml` floor 設定、未指定で 20）
- 抽選確率: `(enemyCount - 現在の生存敵数) / enemyCount`。生存敵数が `enemyCount` 以上のときは何もしない
- 対象プール: `randomEnemyPool`（`enemies` の文字列エントリ＝`count` 未指定）のみ。`fixedEnemies` はリスポーン対象外
- 配置候補: `DungeonMap.getRespawnCandidatePositions()` が列挙する。除外領域は「プレイヤーのいる部屋（接続通路含むゾーン全体）」「プレイヤーゾーンに8方向隣接する部屋（接続通路含むゾーン全体）」「隠し部屋」「通路セル全般」「`StairsObject` / `TrapObject` / `ItemObject` / `TreasureObject` の真上」「`isCellBlocked` が真のセル」「プレイヤーセル」。8方向隣接判定はプレイヤーゾーン側の全矩形（部屋＋接続通路）を1セル外側に拡張し、いずれかが他部屋矩形と重なれば隣接とみなす（プレイヤーが通路に立っているとき壁越しの近距離リスポーンを防ぐため）
- 候補が0個ならリスポーンしない（通知も発行しない）
- 成功時のメッセージログは発行せず、プレイヤーに気付かれずに「奥の部屋に敵が湧いている」演出とする

`fixedEnemies`（固定敵）は初期スポーン時のみ配置され、リスポーンによる補充では再出現しません。

## 戦闘システム

### ターンの流れ

1. プレイヤーがスペースキーを押す → `Game.tryAttackOrShowDirections()`。前方斜めに攻撃可能な敵がいれば 3 択ボタンを提示、正面のみに敵がいれば即時攻撃（`DungeonMap.attackPlayer()`）、敵が一体もいなければ正面を調査（`MapInteractionHandler.searchFront()` = C キー→中央選択と同等。手軽な調査・1 ターンスキップ手段）
2. 攻撃時は正面座標の敵を取得し、`canAttack()` で壁チェックを行う
3. ダメージ計算: `BaseLoader.calculateDamageFromPlayer(playerVars, enemyVars)` が `base.yml` の `damageFromPlayer.formula` を評価（`Math.max(1, Math.floor(...))` クランプ）
4. 敵が死亡した場合（`BaseLoader.isEnemyDead` 判定）: マップから除去し、`player.addExp()` で経験値付与
5. `dispatchObjectEvent()` を呼び出し、隣接する敵の反撃ターンを処理
6. 敵の反撃: `around-1` イベントが `canAttack()` を通過した場合のみ攻撃。ダメージは `BaseLoader.calculateDamageToPlayer` を経由
7. プレイヤー死亡時（`BaseLoader.isDead`）: `EventBus.emit('game-over')` → GameOver シーンへ遷移

### 壁越し攻撃の判定（`DungeonMap.canAttack()`）

隣接する2セル間の攻撃可否を判定します（実装は `src/lib/map/PlayerActions.ts` の `canAttack`、`DungeonMap.canAttack()` から委譲）：

- **縦横方向**: 出発点からその方向に「扉のない壁（solid wall）」があれば攻撃不可。**扉があれば通過可**（プレイヤー・敵が扉を挟んで隣接している場合は攻撃可能）
- **斜め方向**: 角を回る2本のL字経路（横→縦 / 縦→横）のうち、**少なくとも1本が完全に開いた通路（壁ビットなし）であれば攻撃可**。扉ビットが立っているセルは壁として扱うため、扉経由の斜め攻撃は不可

```text
例1: 縦壁越し → 攻撃不可      例2: L字（1本通れる）→ 攻撃可
　プ                            プ壁
壁壁壁                          　　敵
　敵

例3: 扉越し直線 → 攻撃可      例4: 扉経由L字 → 攻撃不可
プ扉敵                          プ扉□
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

## アイテム投擲システム

「アイテム」一覧（統合インベントリ、[gameplay.md](./gameplay.md) 参照）のコンテキストバーで「投げる」を選ぶと、装備していない所持アイテムを直線方向へ投擲します。`PhaserGame.vue` が `throw-item` を発火 → `ItemListController` のハンドラが一覧を閉じて `Game.enterThrowTargetSelectMode` へ移行します。攻撃と同じ 左/中央/右 の3択方向選択（`SceneModeController.enterThrowDirectionMode` → `Game.enterThrowTargetSelectMode`）を経て `DungeonMap.throwItem(instanceId, dirCell)` → `PlayerActions.throwItem` が実行します。命中・着弾の解決は `src/lib/map/ThrowResolver.ts` の `resolveThrow()` に集約します。

### 直線走査と停止条件

プレイヤー位置を起点に、選択セルへの単位ベクトル（cardinal または diagonal）で1セルずつ前進します（`canProjectileStep`）。

直線飛び道具の経路判定（`isAnyWall` / `canProjectileStep`）は `src/lib/map/Projectile.ts` に集約され、投擲と遠距離スキル（skills の `straight` target）の双方が共有します。`Projectile.firstEnemyAlongRay()` は副作用なしに「射線上の最初の生存敵セル」を返すヘルパーで、`straight` target の解決（`TargetResolver`）が利用します。詳細は [skills.md](./skills.md) の `straight` 節を参照。

- **境界判定**: `canAttack` と同じ論理だが **扉も壁として遮蔽**（`isAnyWall` = 生の壁ビット参照）。斜めは2本のL字経路 pathA/pathB のいずれかが開いていれば通過可。
- **敵に命中** → 効果を発揮しアイテム消滅（「{敵名}に当たった！」を効果出力前にログ）。
- **壁・扉 / 進入不可オブジェクト（`isCellBlocked`：宝箱・blocking イベント）/ 射程到達** → 手前セルで停止し床にドロップ（「○が床に落ちた」）。着地は `EnemyDropResolver.findDropTarget`（ItemObject・敵・**トラップ可視不問**・プレイヤーを回避）で空きセルを探す。
- **射程**: `base.yml` の `throwRange`（0=無制限）に `Player.getEffectiveStat('throwRange')`（装備 `effect.throwRange` / passive `add_stats.throwRange` を自動合算）を加えた値（無制限時は加算しない）。

### 命中時の効果優先順位（`applyThrowHit`）

1. アイテムに `throwEffect` 定義あり → `executeDamageAction` / `executeApplyEffectAction`（スキル action 実行器）を単一セル対象で再利用、`clear_effect` は `enemy.clearStatusEffect`
2. 武器（throwEffect 無し）→ **仮装備ダメージ**: `Player.getThrownWeaponFormulaVars(item)` で武器スロットだけを投擲武器に差し替えた実効ステータスを構築し、`enemy.takeDamageFromPlayer()` に渡す（現装備武器の寄与は除外、投擲武器自身の modifier は反映、passive/continuous/permanent は維持）
3. 消費アイテム（throwEffect 無し）→ `immediate` の `applyEffect` / `clearEffect` / 数値 stat を敵へ転用（利敵も許容）。加えて `continuous`（数ターンの能力値変動／耐性）も `Enemy.applyContinuousEffect` で敵に付与し、`MapGenerator.tickEnemies()` でターン進行する（`弱体の薬` 等で敵をデバフ可能）
4. 防具・その他 → 投げ損（消滅のみ）

敵撃破時はマップ除去・撃破数・経験値・レベルアップ・ドロップ（`tryEnemyDrop`）を AttackAction / DamageAction と同等に処理します（`awardEnemyDefeat`）。投擲は `_action` の force（skip など）/ forbid（`not_action` 等で `item` カテゴリ封鎖）中は `throw-item` ハンドラの `blockByDirective('item')` で弾かれます（`_action` 全般は [items.md](./items.md) 参照）。

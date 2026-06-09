# Frame Dungeon - 実装TODO

このファイルは、ゲームを完成させるために必要な実装項目をまとめたものです。

## 優先度: 高（ゲームとして最低限必要）

### 戦闘システム

- [x] 敵キャラクターの実装
  - [x] Enemyクラスの作成（HP、攻撃力、防御力など）
  - [x] 敵データ定義ファイル（public/data/enemies.yml）
  - [x] EnemyLoaderクラスの実装
  - [x] 敵のマップ配置システム（MapObject継承による_objects統一管理）
  - [x] 敵の表示（MainView上での描画）

- [x] 戦闘システムの実装
  - [x] ターン制戦闘ロジック（スペースキーで正面の敵を攻撃）
  - [x] ダメージ計算システム（攻撃力・防御力の反映）
  - [x] 戦闘ログをはじめとしたログ表示システムの追加（PhaserGame.vue の textarea）
  - [x] 経験値とレベルアップシステム

### ゲームオーバー条件

- [ ] プレイヤーHP管理
  - [x] HPが0になった時のゲームオーバー処理
  - [x] GameOverシーンへの遷移
  - [x] GameOverシーンからのリスタート機能

### アイテムシステムの拡張

- [x] アイテム使用機能
  - [x] 消耗品（薬など）の使用実装
  - [x] 即座効果の適用
  - [x] 持続効果の管理システム

- [x] 装備変更UI
  - [x] インベントリ画面の実装
  - [x] 装備スロット表示
  - [x] アイテムの装備/解除操作

- [x] アイテムドロップ
  - [x] マップ上のアイテム配置
  - [x] アイテム取得処理
  - [x] アイテム取得UI/フィードバック（`message-log` + 拾えないとき `open-drop-list-for-pickup` フロー）
  - [x] 敵を倒した時のドロップ（`enemies.yml.drop` + `base.yml.enemyDropPool` の additive、`EnemyDropResolver`）

### UIの改善

- [x] ステータス表示の充実
  - [x] 装備ボーナスの表示
  - [x] 現在HP/最大HPの明示
  - [x] 装備中のアイテム表示

- [x] メッセージログ
  - [x] 戦闘ログの表示
  - [x] アイテム取得メッセージ
  - [x] イベント発生メッセージ

## 優先度: 中（ゲームの面白さ向上）

### ダンジョン探索

- [x] 階層システムの拡張
  - [x] フロアごとの難易度調整（`base.yml` の `floors[]` でフロア毎に size / 敵プール / 固定敵 / トラップ数を設定）
  - [x] フロア数の表示改善
  - [x] 1フロアの長居警告と強制移動

- [ ] マップギミック
  - [x] トラップの効果実装（traps.yml + TrapsLoader、damage / addEffect / unequip 対応）
  - [x] 宝箱の配置と開封システム
  - [x] 隠し扉/隠し部屋（`base.yml.secretRoom` で有効化、出入口 1 つの部屋を抽選し扉を壁偽装、`調べる`(C) で発見）
  - [x] 回復ポイント（泉など）— 汎用イベントオブジェクトとして実装。`events.yml` で定義（`heal` / `damage` / `apply_effect` / `give_item` / `spawn_enemy` / `learn_skill` / `add_modifier` / `remove_modifier_kind` / `execute_skill` / `message` / `self_destruct` 等の action）、選択肢メニュー（最大 10）/ ランダム抽選 / 即時実行の 3 結末パターン、`rate` + `on_success` / `on_fail` で能力依存判定可能。フロア配置は `base.yml.floors[].eventCount` + `events`。詳細は [docs/architecture/events.md](docs/architecture/events.md)
  - [x] イベントの選択肢条件付き表示（`choices[].condition` formula）— 真のとき表示・偽のとき非表示。イベント formula 内で `has_item("name")` / `item_count("name")` / `has_skill("name")` クエリ関数が使える（共有 `eventParser`：`src/lib/events/eventFormula.ts`）。アイテムを対価に渡す `consume_item` action も追加（例: `wounded_animal`「薬を与える→巻物」、`ancient_inscription`「analyze 習得時のみ解読」）
  - [ ] トラップの `visible: true` + `appearance` を活用したマップギミックの拡充（罠以外の床ギミック例）

### アイテムの多様化

- [ ] 追加武器・防具
  - [ ] アイテム投擲と遠距離武器
    - [x] アイテム投擲（直線投擲・壁/扉/障害物で停止し床ドロップ・敵命中で効果発揮）。効果優先順位は `throwEffect` ＞ 武器の仮装備ダメージ（`Player.getThrownWeaponFormulaVars`）＞ 消費アイテムの `applyEffect`/`clearEffect`/数値stat 転用 ＞ 投げ損。射程は `base.yml` の `throwRange`＋装備/パッシブ `throwRange` ボーナス。実装は `src/lib/map/ThrowResolver.ts`
    - [x] 投擲で消費アイテムの `continuous`（持続効果）を敵に適用する（`ContinuousEffectManager` を共有マネージャとして抽出し Player / Enemy が委譲。`Enemy.applyContinuousEffect` / `tickContinuousEffects` を追加、`MapGenerator.tickEnemies` でターン進行。`ThrowResolver.applyConsumableToEnemy` が `spec.continuous` を敵に付与。サンプル `弱体の薬` を追加）
    - [x] 遠距離攻撃スキル（**方法3**：skill の `target: straight` ＝射線上の最初の敵を対象、MP コスト）。直線判定は `src/lib/map/Projectile.ts`（`canProjectileStep` / `firstEnemyAlongRay`）に集約し投擲と共有。サンプル `toxic_dart`（毒矢）/ `magic_arrow`（魔法の矢）。設計・実装メモは [docs/ranged-attack.md](docs/ranged-attack.md)
    - [ ] 遠距離武器（**方法2**：魔法の杖＝使用回数つきの道具。撃ちたいときだけ道具使用、回数0で投擲転用も可）。遠距離効果は方法3の `straight` スキルに乗せ、使用回数は modifier システム流用が有力。実装メモ・注意点は [docs/ranged-attack.md](docs/ranged-attack.md)
    - [ ] 遠距離武器（**方法1・優先度低**：弓＋矢＝装備したまま攻撃ボタンで遠距離攻撃）。飛び道具判定は方法3再利用で軽いが、**インベントリの個数スタック概念の新規実装が必要で重い**ため優先度低。実装メモ・注意点は [docs/ranged-attack.md](docs/ranged-attack.md)
  - [ ] レアリティシステム
  - [x] ランダム生成アイテム（接頭辞・接尾辞）
    - [x] 修飾状態（modifier）システム: `item_modifiers.yml` + `ItemModifiersLoader`。`add_stats` / `cannot_unequip` 効果を装備中のみ発動
    - [x] suffix 形式の表示ラベル（例: `鉄の剣 [攻+2/呪]`、`ItemLabelFormatter` 経由）
    - [x] フロア床配置時の自動抽選（`base.yml` の `itemModifierChance` / `itemModifierPool` + modifier 側 `weight`）
    - [x] 巻物による付与/解除（`add_modifier` / `remove_modifier_kind` immediate 効果）
    - [x] 敵ドロップ時の付与（`base.yml.enemyDropPool` + `enemies.yml.drop` の additive 合成、空きセル探索付き）
  - [ ] セット装備ボーナス

- [ ] 特殊アイテム
  - [x] 鍵とドアのシステム — 隠し部屋扉のバリエーション拡張（`secretRoomDoorVariants: { plain, locked, lockedDisguised }` で重み抽選）。施錠扉は壁同等（通行・攻撃・扉開放描画すべて遮断）、視覚は取っ手の代わりに黄黒警告ストライプ帯。鍵は `events.yml` の `secret_room_key`（実体は「どこかの扉に繋がるレバー」）として配置され、調査で `unlock_door: self` action 経由で対応扉を解錠。詳細は [docs/architecture/data.md](docs/architecture/data.md) の `secretRoomDoorVariants` 節と [docs/architecture/events.md](docs/architecture/events.md) の `unlock_door` 項を参照
  - [x] 魔法の巻物（スキルが発動するアイテム）: `items.yml` の `effect.immediate.executeSkill: <skill>` でアクティブスキルをコスト無し・未習得不問で発動。`target: front` のスキルは方向選択後にアイテム消費、キャンセル時は非消費。パッシブ系は `YamlCrossValidator` でエラー
  - [ ] 永続効果アイテム

### 敵のバリエーション

- [ ] 敵の種類追加
  - [ ] 通常敵の多様化
  - [ ] ボス敵の実装
  - [x] 敵の特殊能力（毒、麻痺など）
    - [x] 状態異常システム本体（`effects.yml` / `EffectsLoader` / `Player.applyStatusEffect` 等のフレームワーク）
    - [x] 敵攻撃から状態異常を発動させるトリガ実装

- [ ] 敵のAI
  - [x] 巡回パターン
  - [x] プレイヤー追跡
  - [ ] 逃走行動

### セーブ/ロード機能

- [x] セーブシステム
  - [x] プレイヤーデータの保存
  - [x] ダンジョン状態の保存
  - [x] LocalStorageへの保存

- [x] ロードシステム
  - [x] セーブデータの読み込み
  - [x] タイトル画面にコンティニュー追加

## 優先度: 低（完成度向上）

### グラフィック/サウンド

- [ ] 効果音の追加
  - [ ] 移動音
  - [ ] 戦闘効果音
  - [ ] アイテム取得音
  - [ ] メニュー操作音

- [ ] ビジュアルエフェクト
  - [ ] パーティクルエフェクト
  - [ ] ダメージ表示アニメーション
  - [ ] レベルアップエフェクト

- [ ] ダンジョン描画
  - [x] 扉の表示を扉っぽくする（不透明部分を増やして、窓のみ半透明にする）
  - [x] 単色になっているオブジェクトがある床を同心状のグラデーションにする
  - [x] 敵がアイテムや階段に重なっている場合に、その下にオブジェクトがあることを分かりやすくする
  - [x] 装備と消費アイテムで色を変更
  - [x] 球体以外のオブジェクト表示を追加

### UI/UX改善

- [ ] チュートリアル
  - [ ] 操作説明
  - [ ] 初回プレイ時のガイド

- [ ] 設定画面
  - [ ] 音量調整
  - [ ] キーコンフィグ
  - [ ] 画質設定

- [ ] 統計情報
  - [ ] プレイ時間
  - [x] 倒した敵の数
  - [x] 到達フロア
  - [x] 経過ターン数

- [ ] 操作性改善
  - [x] カニ歩き（1方向を向いたまま、左右または後方に移動）
    - [x] Q/E で左右カニ歩き、Shift+S で後退カニ歩き（デフォルト）
    - [x] 設定ダイアログに「Q/EとA/Dを入れ替え」「SとShift+Sを入れ替え」オプションを追加
  - [x] アクションボタンのサイズ調整
    - [x] アイテム系（使用/投擲/装備）を「アイテム」1ボタンに集約し既定を7→5個に削減（折り返し解消）。一覧表示中は画面下部を専用コンテキストバー（使用/装備/投げる/置く/説明/閉じる）に差し替え。詳細は [docs/architecture/gameplay.md](docs/architecture/gameplay.md)
    - [x] 数字キー番号を右上隅バッジ化してラベル幅を確保。折り返さない文字数目安をドキュメント化（標準ボタンで全角約6文字）
  - [x] アクションボタンが7個以上必要になった場合の対策（`PhaserGame.vue` の `actionPages` で貪欲ページ分割＝1ページ最大6ボタン・先頭5+次/中間4+前+次/最終残り+前・隠れボタンは `v-show`。ナビに数字キーは割り当てず `6〜0` キーは全ページのアクションに直結、`PageUp/PageDown` でページ閲覧。イベント選択肢モーダルの11個溢れにも対応。あわせて `Escape` でモーダルをキャンセル可能に。詳細は [docs/architecture/gameplay.md](docs/architecture/gameplay.md)）
  - [x] アイテムを使用したり装備した後は、WASDで移動できる状態（標準のアクションボタン）に戻す（設定「アイテム/スキルリストを毎回閉じる」=`gameSettings.closeListAfterAction`、UI設定でセーブ非保存。有効時は使用・装備・スキル発動/toggle 後に `reopenCurrentList` / `continueOrCloseSkillList` が `closeList` する）
  - [x] 操作感の統一のため、スキルやドロップも、アイテムと同様にアクションボタン（コンテキストバー）を使うようにして、リスト下の234pxフッターを廃止した（`ctxButtons` を `listMode` で出し分け：`skill`=発動/説明/閉じる、`drop`=置く/説明/閉じる、`inventory`=従来の6個）。詳細は [docs/architecture/gameplay.md](docs/architecture/gameplay.md)
  - [ ] マウス主体操作のために、攻撃や調べる、移動もクリック操作できるようにする。実現方法は要検討

### バランス調整

- [ ] ゲームバランス
  - [ ] 敵の強さ調整
  - [ ] アイテムドロップ率
  - [ ] 経験値テーブル
  - [ ] ダンジョンサイズとフロア数

### その他の機能

- [ ] ミニマップの機能拡張
  - [x] アイコン表示（敵、アイテム、階段など）
  - [x] ズーム機能
  - [x] プレイヤー周囲以外の任意の箇所のズーム
  - [x] ズームのトグルをマップクリックで切り替え

- [ ] 実績システム
  - [ ] 実績の定義
  - [ ] 実績達成判定
  - [ ] 実績一覧画面

- [x] スキルシステム
  - [x] skills.yml + SkillsLoader（コスト・target・action・mastery のフォーマット）
  - [x] レベルアップ抽選による習得（mastery：exact / least+rate、複数 least 評価）
  - [x] アイテム使用による習得（`effect.immediate.learnSkill` 効果、既習得時もアイテム消費）
  - [x] スキル一覧 UI（mode='skill'、disabled / costSummary / targetSummary 表示）
  - [x] target 解決（front / straight / around / room / map / self）と front/straight 方向選択 UI（`straight` ＝射線上の最初の敵を対象にする遠距離スキル。[docs/ranged-attack.md](docs/ranged-attack.md)）
  - [x] コスト評価・支払い・差し戻し（`<stat>_max` 露出、formula 評価、原子適用）
  - [x] action: attack / damage / heal / reveal_trap
  - [x] スタン (`_action: skip`) 連携（UI/ライブラリ 2 段ガード）
  - [x] 敵のパッシブスキル（`trigger: on_attack`）：`enemies.yml` の `skills[]` から `EnemySkillExecutor` 経由で発動
  - [x] パッシブスキルの拡張
    - [x] `trigger: on_turn` — 毎ターン終了時に自動発動するパッシブ
    - [x] `trigger: on_damage` — ダメージを受けた際に発動するリアクション（`incoming_damage` 変数を露出、target=hit で攻撃元へ反撃可能）
    - [x] プレイヤーの装備・アイテムから `on_attack` パッシブを付与する機能（`items.yml` の `passive_skills: [{name, rate}]`、`on_turn` / `on_damage` / `passive` も同フィールドで付与可能）
    - [x] `EnemySkillExecutor` への `damage` アクション対応（`target_<stat>` 変数で player ステータス参照可）
    - [x] `trigger: passive` — 常時 stat 修飾のパッシブ（`add_stats: { stat: formula }`、`<stat>_max` も対応、空 add_stats でラベル用途も可）（追加ダメージ型スキル）
  - [ ] スキル定義のクロスバリデーション強化（YamlCrossValidator で skills.yml 内の cost / damage / heal formula の変数や効果参照を事前検証）

## 技術的改善

### コード品質

- [ ] TypeScript型定義の整備
- [ ] エラーハンドリングの強化
- [ ] パフォーマンス最適化
- [ ] テストコードの作成
- [ ] `src/lib/Player.ts` の更なる分割（武器・防具周りの機能追加が一段落した後に着手）
  - [ ] 装備管理（`equippedWeapon` / `equippedMainArmor` / `equippedSubArmor1/2` スロットと `equipItem` / `unequipItem` / `predictEquipSlot` / `getEquippedSlotOf` 等）を `PlayerEquipment` に分離。`getEffectiveStat` / `applyAddModifierEffect` / `applyRemoveModifierKindEffect` が装備スロットに直接アクセスしているので、事前に `getAllEquippedItems()` / `getItemInSlot(slot)` 経由へ統一するリファクタリングが必要
  - [ ] 状態異常・持続効果・実効値計算（`applyImmediateEffect` / `applyContinuousEffect` / `tickStatusEffects` / `notifyDamageTaken` / `getEffectiveStat` / `getEffectiveResists` などの約 460 行）を `PlayerEffectManager` に分離。`activeContinuousEffects` / `activeStatusEffects` の所有を移し、Player からは委譲する形にする

### ドキュメント

- [ ] README.mdの充実
- [ ] ゲームルールの説明
- [ ] 開発者向けドキュメント

## バグ修正/既知の問題

- [x] E/Qキーの機能実装（現在コメントアウト中）
- [x] トラップの効果実装（現在は発見のみ）
- [x] フォグ表示の最適化（視覚的改善・コード整理）
- [ ] ミニマップの RenderTexture 化（毎ターン全マス再描画をやめ、差分のみ更新する）
- [x] GameOverシーンからのリスタート機能

## 注意事項

- 各項目は独立して実装可能ですが、戦闘システムは他の多くの機能の前提となります
- 優先度「高」の項目を先に実装することで、プレイ可能な最小限のゲームが完成します
- items.ymlとstats.ymlにデータを追加する際は、既存の形式に従ってください

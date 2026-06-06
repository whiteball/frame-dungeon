# シーンアクション / セーブ・ロード / カスタムデータ

[← 索引へ戻る](../architecture.md)

画面下部のシーンアクションボタン、モーダルモード、セーブ/ロード、ZIP カスタムデータの仕組みを扱います。

## シーンアクションボタン

シーンごとの操作ボタン（画面下部の「アイテム」「ステータス」等）は `EventBus.emit('scene-actions', [{ label, onClick }, ...])` で発行します。`PhaserGame.vue` が受け取り、ボタン列として左寄せで表示します。各ボタンの数字キー番号は右上隅の小バッジで表示します（ラベル本文の横幅を圧迫しないよう、インライン文字ではなく絶対配置の `<span>` にしている）。

Game シーンのデフォルト SceneActions は `[スキル, アイテム, ステータス, 足下, セーブ]` の 5 ボタンで、数字キー `1`〜`5` に対応します。数字キー `1〜0`（10 個まで）を左から順に割り当てます（`Phaser.Input.Keyboard.KeyCodes.ONE`〜`ZERO` を `addKey` で登録し、`down` イベントで該当 `onClick` を呼び出す）。アイテム一覧表示中は `keyboard.enabled = false` によりこれらのショートカットも自動的に無効化されます。

### アイテム集約（統合インベントリ）とコンテキストバー

かつての `アイテム使用 / 投げる / 装備変更` の 3 ボタンは「アイテム」1 ボタン（`ItemListController.toggleList('inventory')`）に集約しています。`'inventory'` モードは**全アイテム**（`Inventory.getItems()`、消耗品を先頭に安定ソート）を一覧表示し、操作は**画面下部の 1024px 幅のアクション列を専用コンテキストバーに差し替えて**選ばせます（234px のリストフッターには詰め込まない）。

- コンテキストバーは `PhaserGame.vue` の Vue 側ボタンとして描画され（`ctxButtons` computed）、選択中項目（`selectedIndex`）を直読して `use-item` / `use-skill` / `equip-item` / `throw-item` / `drop-item` を発火します。`SceneModeController` には触れず、`isModalMode` は変えません（リスト中の入力ブロックは従来どおり `keyboard.enabled=false` が担う）。
- 操作感統一のため **`inventory` / `skill` / `drop` のいずれの一覧もこのコンテキストバーを使う**（リスト下の 234px フッターは廃止）。`ctxButtons` は `listMode` で内容を出し分けます：
  - `inventory`：`使用 / 装備 / 投げる / 置く / 説明 / 閉じる` の 6 個。選択項目の `consumable` / `equippable` / `isEquipped` で個別に活殺。
  - `skill`：`発動 / 説明 / 閉じる` の 3 個。`発動` は選択スキルの `disabled`（スタン・コスト不足・toggle 非対応パッシブ）で無効化。
  - `drop`：`置く / 説明 / 閉じる` の 3 個（設置フロー）。
- 番号キーは表示中の `ctxButtons` の個数に合わせ、`onListKeyDown` が `action-button-N` へ DOM クリック転送する既存経路で対応します（skill / drop は `1〜3`、inventory は `1〜6`）。コンテキストバーは常に 6 個以下なのでページ送りは発生しません。
- Enter / スペース（`confirmSelect`）は各モードの既定アクション（`inventory`：消耗品→使用 / 装備可→装備、`skill`：発動、`drop`：置く）を実行し、頻用操作の手数を保ちます。
- アイテム使用 / 装備変更の後は `ItemListController.reopenCurrentList()` が現在の `listMode` に応じて一覧を再構築し（`'inventory'` なら統合リスト）、対象が空になった場合のみ閉じます。

### ボタンラベルの折り返し許容文字数（目安）

`.button` は `width:140px` ＋ `padding:10px`（内寸約 120px）、フォントは未指定で UA 既定の約 16px。全角 1 文字 ≈ 16px のため、**標準ボタン（≤6 個でフレックス圧縮が起きない状態）では全角約 6 文字**がラベルの折り返さない上限の目安です。番号をインラインのサフィックス（`[n]` を空白付きで後置）で描いていた頃は約 2 全角分を消費して実質 4〜5 文字でしたが、番号のバッジ化でこの分を回収しています。**ボタンが 7 個以上になると各ボタンが 140px 未満に縮みラベルが折り返す**（実効幅約 1012px に 7 個で約 1168px 必要）ため、7 個以上は下記のページ送りで分割表示します。

### アクションボタンのページ送り

`actions.length` が `ACTIONS_PER_ROW`（= 6）を超えたとき、`PhaserGame.vue` の `actionPages` computed が**貪欲レイアウト**でページ分割します（ナビボタンもボタン数に数え、1 ページ最大 6 ボタン）。

- `n <= 6`：単一ページ（ナビなし）。
- 先頭ページ＝アクション 5 個＋「次ページ＞」。中間ページ＝アクション 4 個＋「＜前ページ」＋「次ページ＞」。最終ページ＝残り（最大 5 個）＋「＜前ページ」。残り 1 個で次ページを作らない（最終ページのアクション数は常に 2〜5）。例：N=6 → 1 ページ、N=11 → 5/4/2 の 3 ページ。
- **ナビボタンは `actions` 配列に入れず**テンプレート上の独立要素にする（インデックスずれで数字キー/バッジ/id が崩れるのを防ぐ）。ナビボタンに数字キーは割り当てない。
- 数字キー `1〜0` は [Game.ts](../../src/game/scenes/Game.ts) の `mode.current[i]` 直結なので、**1 ページ目表示中でも `6〜0` で 2 ページ目以降のアクションを実行できる**（ページ送りは見た目だけの Vue 層機能）。id・バッジはグローバル index 基準（`(i+1)%10`）。11 個目（`i >= 10`）は数字キー対象外なのでバッジ非表示。
- 隠れページのボタンは `v-if` ではなく **`v-show`（display:none）** で DOM に残す。リスト表示中の `onListKeyDown` が `action-button-N` へ `dispatchEvent('click')` する経路を全ページで生かすため。
- アクション集合が差し替わる（`scene-actions` 受信）たびに `actionPage` を 0 にリセット。**PageUp / PageDown** でもページを前後できる（`window` keydown を Vue が購読、`actionPages.length > 1` のときのみ作用）。

### 足下アクション

「足下」ボタン（または `4` キー）は `DungeonMap.dispatchSelfEvent()` を呼び出します。プレイヤーの現在マスに `around-0-self` イベントを持つオブジェクトがあればそのイベントを発火します。対応オブジェクトがない場合は `openDropList()`（アイテム設置フロー）を起動します。足下アクションはターン非消費です。

### モーダルモードとキーブロック（`isModalMode`）

モーダル状態は `SceneModeController`（`src/game/scenes/game/SceneModeController.ts`）が管理します。`isModalMode` ゲッターは `currentSceneActions !== defaultSceneActions` で判定され、`Game` シーン側はキー入力ハンドラで `this.mode.isModalMode` を見て W/A/S/D/スペースキーの入力を一律ブロックします。以下の状態が該当します：

- **攻撃方向選択**: 正面斜め方向に複数敵がいるとき「左/中央/右/キャンセル」を表示
- **スキル方向選択**: `target: front` のスキル発動時に「左/中央/右/キャンセル」を表示
- **階段確認**: 階段マスを踏む（`around-0`）または足下アクション（`around-0-self`）で `enterStairMode` → 「進む/やめる」
- **トラップ確認**: 既知のトラップで足下アクションを使用したとき `enterTrapConfirmMode` → 「起動/やめる」
- **長居警告**: フロアの規定ターン数を 50% / 75% 超過時に「確認」のみを表示
- **ミニマップズーム移動**: 「キャンセル」のみを表示し、WASD でミニマップをスクロール
- **調査方向選択**: C キーで「左/中央/右/キャンセル」を表示（`MapInteractionHandler.trySearch()`）
- **セーブダイアログ表示中**: シーンアクション列を空に差し替えてキー入力をブロック

各モードの終了（「やめる」「キャンセル」含む）で `SceneModeController.enterDefaultMode()` を呼び、`isModalMode` が偽に戻ります。

**Escape キー**でもモーダルをキャンセルできます（`Game` の `keyEsc` ハンドラ：ミニマップ移動モードを優先処理し、それ以外で `isModalMode && current.length > 0` なら `enterDefaultMode()` を呼ぶ）。各モーダルのキャンセル動作は実装上すべて `enterDefaultMode()` のみ（`onExecute` / `onSelect` 不呼び出し＝副作用なし）なので安全です。`current.length === 0` のセーブダイアログ（キー入力もブロック中）は対象外。リスト表示中は `keyboard.enabled=false` で本ハンドラが発火せず、Escape は `onListKeyDown`→`close-item-list-request` が担います。

### `around-0-self` イベント

`'around-0'`（プレイヤーが踏んだとき自動発火）とは別に、`'around-0-self'` を登録すると「足下アクション」による明示的な発火が可能です。`MapObjectStore.dispatchSelfEvent()` / `DungeonMap.dispatchSelfEvent()` がプレイヤー位置のオブジェクトを走査して呼び出します。階段とトラップはどちらのイベントも持ち、踏む・足下どちらからでも同じダイアログを起動します。

## セーブ/ロード

`SaveManager`（`src/lib/SaveManager.ts`）が LocalStorage にスロット単位でセーブデータを保存・読込します。

### データ構造

`SaveData` は以下のサブ構造から構成：

- `meta`: `savedAt` / `memo` / `gameName` / `yamlDigest`
- `floor`: 現在フロア
- `player`: `PlayerSaveData`（レベル・経験値・stats/maxStats・インベントリ・装備 ID・持続効果・状態異常・習得スキル・無効化中トグルスキル（`disabledSkills`）・プレイ統計（`enemiesDefeated` / `itemsUsed`））
- `dungeon`: `DungeonSaveData`（マップ・フォグ・歩行済み・プレイヤー位置/向き・総ターン数 `turnCount`・階層開始時ターン数 `floorStartTurnCount`・部屋構造・全オブジェクト・全敵）

### yamlDigest による整合性チェック

セーブ時に `calculateDigest()` で現在ロード中の YAML 全体のハッシュを計算して `meta.yamlDigest` に保存。ロード時に `LoadDialog` 内で再計算し、不一致なら確認パネルを表示（強行ロードか中止を選択させる）。

### スロット運用

複数スロット + メモ機能で `SaveDialog` / `LoadDialog` がスロット一覧を表示する。

## カスタムデータ機能 (ZIP インポート)

タイトル画面（`MainMenu` / `PhaserGame.vue` 側 UI）から ZIP ファイルを選択すると、`JSZip` でデコードして `CustomDataStore.set(key, text)` に格納。各 Loader の `load(customText?)` メソッドが優先採用します。

- 対応キー: `base`, `stats`, `items`, `enemies`, `effects`, `traps`, `skills`（`CustomDataStore.YAML_KEYS`）
- 1つでもカスタムが入っていれば `CustomDataStore.isCustom() === true`
- セーブデータの `gameName` に `BaseLoader.getName()` を埋め込むため、カスタム作品ごとにセーブが識別される

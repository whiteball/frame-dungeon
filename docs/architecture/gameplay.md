# シーンアクション / セーブ・ロード / カスタムデータ

[← 索引へ戻る](../architecture.md)

画面下部のシーンアクションボタン、モーダルモード、セーブ/ロード、ZIP カスタムデータの仕組みを扱います。

## シーンアクションボタン

シーンごとの操作ボタン（画面下部の「アイテム使用」「ステータス」等）は `EventBus.emit('scene-actions', [{ label, onClick }, ...])` で発行します。`PhaserGame.vue` が受け取り、ボタン列として左寄せで表示します。

Game シーンのデフォルト SceneActions は `[スキル, アイテム使用, 装備変更, ステータス, 足下, セーブ]` の 6 ボタンで、数字キー `1`〜`6` に対応します。数字キー `1〜0`（10 個まで）を左から順に割り当てます（`Phaser.Input.Keyboard.KeyCodes.ONE`〜`ZERO` を `addKey` で登録し、`down` イベントで該当 `onClick` を呼び出す）。アイテム一覧表示中は `keyboard.enabled = false` によりこれらのショートカットも自動的に無効化されます。

### 足下アクション

「足下」ボタン（または `4` キー）は `DungeonMap.dispatchSelfEvent()` を呼び出します。プレイヤーの現在マスに `around-0-self` イベントを持つオブジェクトがあればそのイベントを発火します。対応オブジェクトがない場合は `openDropList()`（アイテム設置フロー）を起動します。足下アクションはターン非消費です。

### モーダルモードとキーブロック（`isModalMode`）

`Game` シーンは `isModalMode` ゲッター（`currentSceneActions !== defaultSceneActions`）でモーダル状態を判定し、W/A/S/D/スペースキーの入力を一律ブロックします。以下の状態が該当します：

- **攻撃方向選択**: 正面斜め方向に複数敵がいるとき「左/中央/右/キャンセル」を表示
- **階段確認**: 階段マスを踏む（`around-0`）または足下アクション（`around-0-self`）で `enterStairMode` → 「進む/やめる」
- **トラップ確認**: 既知のトラップで足下アクションを使用したとき `enterTrapConfirmMode` → 「起動/やめる」

各モードの終了（「やめる」「キャンセル」含む）で `setSceneActions(defaultSceneActions)` を呼び、`isModalMode` が偽に戻ります。

### `around-0-self` イベント

`'around-0'`（プレイヤーが踏んだとき自動発火）とは別に、`'around-0-self'` を登録すると「足下アクション」による明示的な発火が可能です。`MapObjectStore.dispatchSelfEvent()` / `DungeonMap.dispatchSelfEvent()` がプレイヤー位置のオブジェクトを走査して呼び出します。階段とトラップはどちらのイベントも持ち、踏む・足下どちらからでも同じダイアログを起動します。

## セーブ/ロード

`SaveManager`（`src/lib/SaveManager.ts`）が LocalStorage にスロット単位でセーブデータを保存・読込します。

### データ構造

`SaveData` は以下のサブ構造から構成：

- `meta`: `savedAt` / `memo` / `gameName` / `yamlDigest`
- `floor`: 現在フロア
- `player`: `PlayerSaveData`（レベル・経験値・stats/maxStats・インベントリ・装備 ID・持続効果・状態異常・習得スキル）
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

# Frame-Dungeon

Phaser3を使ったワイヤフレーム風のダンジョン探索ゲームの実装です。

**サンプル公開URL:** [https://whiteball.github.io/frame-dungeon/](https://whiteball.github.io/frame-dungeon/)

## キーボード操作

### 移動・視点

| キー | 動作（デフォルト設定） |
| --- | --- |
| W | 前進 |
| S | 180°回転 |
| A | 左回転 |
| D | 右回転 |
| Q | カニ歩き（左） |
| E | カニ歩き（右） |
| Shift+S | カニ歩き（後退） |

> A/D と Q/E の動作（回転 / カニ歩き）は設定ダイアログで入れ替え可能です。
> 回転はターン消費なし、カニ歩き移動はターン消費します。

### 戦闘・アクション

| キー | 動作 |
| --- | --- |
| スペース | 正面の敵を攻撃 |
| C | 前方を調べる |
| 1 | スキル |
| 2 | アイテム使用 |
| 3 | 装備変更 |
| 4 | ステータス表示 |
| 5 | 足下アクション |
| 6 | セーブ |

### UI

| キー | 動作 |
| --- | --- |
| M | ミニマップ ズーム/全体 切り替え |

## 開発

```bash
yarn install   # 依存関係のインストール
yarn run dev   # 開発サーバー起動 (localhost:8081)
yarn run build # プロダクションビルド
```

## クレジット

このプロジェクトではPhaser3のVue-TSテンプレートを使用しています。

Copyright (c) 2024 Phaser Studio Inc  
[https://github.com/phaserjs/template-vue-ts](https://github.com/phaserjs/template-vue-ts)

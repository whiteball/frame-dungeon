# Frame-Dungeon

Phaser3を使ったワイヤフレーム風のダンジョン探索ゲームの実装です。

**サンプル公開URL:** [https://whiteball.github.io/frame-dungeon/](https://whiteball.github.io/frame-dungeon/)

## 操作方法

キーボード・マウスでの操作方法は [MANUAL.md](MANUAL.md) を参照してください。

## データの作成・改造

敵・アイテム・スキル・トラップ・イベント・フロア構成などは、ソースコードを書き換えずに `public/data/` 以下の YAML ファイル（データセット）だけで変更・追加できます。タイトル画面から自作データの ZIP を読み込んでプレイすることも可能です。

各ファイルのフォーマット・使用可能なキー・記述サンプル・数式で使える変数のリファレンスは [MANUAL_DEV.md](MANUAL_DEV.md) を参照してください。

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

# MANUAL_DEV.md — データセット製作者向けマニュアル

このドキュメントは、`public/data/` 配下の YAML ファイル群（**データセット**）を編集・新規作成して、独自のダンジョン・敵・アイテム・スキル・イベントを作りたい人向けのリファレンスです。

ソースコードを書き換えずに、データファイルだけでゲームの挙動・バランス・コンテンツの大半を変更できます。

- ゲームの内部実装・アーキテクチャの詳細は [docs/architecture.md](docs/architecture.md) を起点とした各ドキュメントを参照してください。本マニュアルからも該当箇所へ随時リンクします。
- プレイヤー向けの操作方法は [MANUAL.md](MANUAL.md) を参照してください。

---

## 目次

- [1. はじめに](#1-はじめに)
  - [1.1 データファイルの場所と一覧](#11-データファイルの場所と一覧)
  - [1.2 共通ルール](#12-共通ルール)
  - [1.3 数式（formula）について](#13-数式formulaについて)
  - [1.4 動作確認・型チェック](#14-動作確認型チェック)
- [2. クイックスタート](#2-クイックスタート)
- [3. 数式変数リファレンス（まとめ）](#3-数式変数リファレンスまとめ)
- [4. 共有要素](#4-共有要素)
  - [4.1 appearance（見た目）](#41-appearance見た目)
- [5. ファイル別リファレンス](#5-ファイル別リファレンス)
  - [5.1 stats.yml — ステータス定義](#51-statsyml--ステータス定義)
  - [5.2 base.yml — ゲーム全体設定](#52-baseyml--ゲーム全体設定)
  - [5.3 items.yml — アイテム定義](#53-itemsyml--アイテム定義)
  - [5.4 enemies.yml — 敵定義](#54-enemiesyml--敵定義)
  - [5.5 effects.yml — 状態異常/強化定義](#55-effectsyml--状態異常強化定義)
  - [5.6 traps.yml — トラップ定義](#56-trapsyml--トラップ定義)
  - [5.7 skills.yml — スキル定義](#57-skillsyml--スキル定義)
  - [5.8 item_modifiers.yml — アイテム修飾状態定義](#58-item_modifiersyml--アイテム修飾状態定義)
  - [5.9 events.yml — 汎用イベント定義](#59-eventsyml--汎用イベント定義)
- [6. 起動時バリデーションとエラーの読み方](#6-起動時バリデーションとエラーの読み方)
- [7. カスタムデータ（ZIP）での差し替え手順](#7-カスタムデータzipでの差し替え手順)

---

## 1. はじめに

### 1.1 データファイルの場所と一覧

すべてのデータファイルは `public/data/` に置かれた YAML（`.yml`）です。各ファイルは対応する Loader クラスが起動時に読み込みます。

| ファイル | 内容 | 必須 | トップレベル構造 |
| --- | --- | :-: | --- |
| `base.yml` | ゲーム全体の中核設定（戦闘式・成長式・フロア構成） | ✅ | マップ（オブジェクト） |
| `stats.yml` | プレイヤー/敵のステータス定義（HP・MP・攻撃力…） | ✅ | 配列 |
| `items.yml` | アイテム定義（武器・防具・消耗品） | — | 配列 |
| `enemies.yml` | 敵定義 | — | 配列 |
| `effects.yml` | 状態異常・強化効果の定義 | — | 配列 |
| `traps.yml` | トラップ定義 | — | 配列 |
| `skills.yml` | スキル定義 | — | 配列 |
| `item_modifiers.yml` | アイテム修飾状態（呪い・強化…）の定義 | — | 配列 |
| `events.yml` | 汎用イベントオブジェクト定義 | — | 配列 |

**「必須」列について：**

- `base.yml` と `stats.yml` は存在しない・空だと起動できません（`alert` を出して停止）。
- それ以外のファイルは**存在しなくても・空でも起動可能**です（敵なし・アイテムなしのダンジョンも作れます）。ファイルが無い場合はコンソールにログを出して、その要素抜きで続行します。
- ただしファイルが存在して中身が**不正**（必須キー欠落・型違反など）な場合は、必須・任意に関わらず常に `alert` + 停止します。

### 1.2 共通ルール

配列形式のファイル（`base.yml` 以外すべて）は、以下の共通ルールに従います。

- **`name` は内部 ID（識別子）**。英数字想定で、他ファイルからの参照キーやセーブデータのキーになります。**ファイル内・ゲーム内で一意**にしてください。
- **`label` は画面に出る表示名**（日本語可）。
- 各エントリは `name` をキーとして Map に格納されます。`name` が重複した場合、**後勝ち**（後のエントリが先のエントリを上書き）になります。
- トップレベルが「配列でない」「null」だとエラーになります。空配列 `[]` は「定義なし」として扱われます。

> **命名のヒント:** `name` を変更すると、それを参照している他ファイル（例: `base.yml` の `floors[].enemies`、`items.yml` の `learnSkill`）との対応が切れて起動時エラーになります。リネーム時は参照側もまとめて変更してください。参照関係は起動時に[横断バリデーション](#6-起動時バリデーションとエラーの読み方)で検査されます。

### 1.3 数式（formula）について

多くの項目で、数値の代わりに**数式の文字列**を書けます（例: `"power * 2 - target_defense / 2"`）。数式は [`expr-eval-fork`](https://github.com/jorenbroekema/expr-eval#documentation) というライブラリで評価されます。

- **使える演算子・関数（`+ - * / ^`、`floor` / `ceil` / `min` / `max` / `abs`、三項演算子 `cond ? a : b` など）の文法は、必ず上記ライブラリのドキュメントを参照してください。** 本マニュアルでは文法そのものは説明しません。
- 各項目で**どの変数が使えるか**は、本マニュアルの [3. 数式変数リファレンス](#3-数式変数リファレンスまとめ) にまとめた「変数リスト」を、各キーの説明欄で名前参照する形で示します。
- 数式は起動時にパース（コンパイル）されます。文法エラーのある数式は、項目によって「起動時 `alert` + 停止」または「コンソール警告 + その式を無視」のいずれかになります（各ファイルの節に明記）。
- YAML の都合で、`:` や `?` を含む数式は**ダブルクォートで囲む**のが安全です（例: `formula: "life <= 0 ? 1 : 0"`）。

### 1.4 動作確認・型チェック

- データを編集したら、開発サーバー（`yarn run dev`、`http://localhost:8081`）でゲームを起動して確認します。データの不正は起動直後に `alert` または専用ダイアログで表示されます（[6 章](#6-起動時バリデーションとエラーの読み方)）。
- YAML はソースコードではないため `vue-tsc` の型チェック対象外です。**バリデーションは実行（ブラウザ起動）でしか走りません。**

---

## 2. クイックスタート

最小構成のデータセットは「`base.yml` と `stats.yml` だけ」です。この 2 つさえあれば、敵もアイテムも無い空のダンジョンを歩けます。そこへ段階的にファイルを足していくのが基本の作り方です。

**手順の例（剣で殴れる最小ダンジョン）：**

1. **`stats.yml`** — まず使うステータスを宣言します。少なくとも HP に当たるステータスが要ります。

   ```yaml
   - name: life
     abbreviation: HP
     fluctuation: yes     # 現在値/最大値を持つ変動値
     description: HP
     order: 1
   - name: power
     abbreviation: POW
     description: 攻撃力
     order: 2
   - name: defense
     abbreviation: DEF
     description: 防御力
     order: 3
   ```

2. **`base.yml`** — 戦闘式・経験値式・初期ステータス・フロア構成を書きます。`defaultDamageStat` / `requiredExp` / `damageToPlayer` / `damageFromPlayer` と `floors` は**必須**です。

   ```yaml
   name: My Dungeon
   goalFloor: 3
   playerInitialStats: { life: 100, power: 10, defense: 5 }
   defaultDamageStat: life

   damageFromPlayer:
     formula: "player_power - enemy_defense / 2"
   damageToPlayer:
     formula: "enemy_power - player_defense / 2"
   requiredExp:
     formula: "level * 50"
   levelUpBonus:
     - { target: life, formula: 10, reset: yes }
     - { target: power, formula: 2 }

   floors:
     - 1:
         size: 15
         enemyCount: 3
         enemies: [slime]
         trapCount: 0
         traps:
   ```

3. **`enemies.yml`** を足して敵を出す、**`items.yml`** を足して武器や回復薬を出す……と、必要なファイルを順に追加していきます。各ファイルの書き方は [5 章](#5-ファイル別リファレンス) を参照してください。

> `base.yml` の `floors[].enemies` に書いた敵名（例 `slime`）は `enemies.yml` に存在しないと起動時エラーになります。空のダンジョンを試すだけなら `enemies:` を空にしておけば OK です。

---

## 3. 数式変数リファレンス（まとめ）

数式で使える変数の組み合わせは限られた数パターンに集約されます。ここでパターンごとに**名前**を付けておき、以降の各キー説明ではこの名前で参照します。

> いずれのリストでも、`<stat>` は `stats.yml` で定義したステータス名（`life` / `power` / `defense` …）を指します。`<stat>_max` はそのステータスの最大値です（例: `life_max`）。`level` は現在レベル、`exp` は現在経験値です。

| リスト名 | 含まれる変数 | 主な使用箇所 |
| --- | --- | --- |
| **`基本変数`** | 各 `<stat>` の **base 値**（装備・効果を含まない素の値）、`level`、`exp` | `base.yml` の `requiredExp` / `levelUpBonus`、`skills.yml` の passive `add_stats` |
| **`実効変数`** | 各 `<stat>` の **実効値**（装備・modifier・持続効果・状態異常・パッシブを全合算）、`level`、`exp` | `events.yml` の `apply_effect` rate ほか（実効値が要る箇所） |
| **`実効＋最大変数`** | `実効変数` ＋ 各 `<stat>_max`（実効最大値） | `base.yml` の `regenerate`、`skills.yml` の `cost`、`events.yml` の `cost`/`rate`/`condition`/`heal`/`damage`/`mod_stat` |
| **`ダメージ変数`** | `player_<stat>`（プレイヤーの実効値）＋ `enemy_<stat>`（敵の生ステータス） | `base.yml` の `damageToPlayer` / `damageFromPlayer` |
| **`術者/対象変数`** | 術者側 `<stat>` / `<stat>_max` / `level` / `exp`（接頭辞なし・実効値）＋ 対象側 `target_<stat>` / `target_<stat>_max`（対象＝敵の生ステータス） | `skills.yml` の action `damage` / `heal`、`items.yml` の `throwEffect.damage` |
| **`状態異常変数`** | `x`（効果の対象ステータスの現在値）、`count`（付与からの経過ターン数） | `effects.yml` の `timing.*.formula` |
| **`解除確率変数`** | `count`（付与からの経過ターン数） | `effects.yml` の `clear.formula` |
| **`敵出現判定変数`** | 敵の各 `<stat>`（生値）、`currentFloor`、`maxFloor`、`rank`、`minRank`、`maxRank` | `base.yml` の `autoSpawner` |
| **`階層表示変数`** | `currentFloor`（内部フロア値 1,2,…）、`goalFloor`、`maxFloor`（=`goalFloor` の別名） | `base.yml` の `floorDisplayFormula` |
| **`修飾状態変数`** | `count`（重ねがけ数）、対象ステータス名（`= 装備込みの素値`）、プレイヤーの各 base `<stat>`・`level`・`exp` | `item_modifiers.yml` の `add_stats` の `formula` |
| **`イベント関数`** | （add-on）`has_item("名前")`、`item_count("名前")`、`has_skill("名前")` | `events.yml` の各 formula に**追加で**使える |

**補足：**

- **`基本変数` と `実効変数` の違い** … `基本変数` は装備・状態異常・パッシブを含まない「素のステータス」です。`実効変数` は実際の戦闘などで使われる「装備・効果込みの実際の値」です。
- **`術者/対象変数` の「対象側」** … `target_<stat>` は攻撃を受ける敵の**生ステータス**（実効値）を指します。プレイヤーが術者のスキル/投擲で使います。
- **`イベント関数`** … `events.yml` の数式では、上表のいずれかのリストに加えて、これらの関数を呼べます。所持していれば `has_item("potion")` が `1`、なければ `0` を返します。

---

## 4. 共有要素

### 4.1 appearance（見た目）

`traps.yml` と `events.yml` の各エントリは、マップ上での見た目を `appearance:` で指定できます（任意。省略時は各ファイルの既定見た目）。フォーマットは共通です。

```yaml
appearance:
  mark: o                  # 床マーカーの形（下表）
  color: 0x66CCFF          # 色
  shape: cylinder          # 立体形状（下表）
  concentric_circle: true  # 床マーカーを同心円で描く（既定 false）
```

| フィールド | 型 / 指定可能値 | 説明 |
| --- | --- | --- |
| `mark` | `'o'` / `'*'` / `'<>'` / `'+'` / `'x'` / `'[]'` のいずれか | 床マーカーの形。それ以外の値は起動時エラー |
| `color` | `0xRRGGBB`（数値）または `'#RRGGBB'` / `'#RGB'` / `'0xRRGGBB'`（文字列） | 表示色。`'#RGB'` は `'#RRGGBB'` に展開される |
| `shape` | `none` / `sphere` / `cube` / `box` / `cylinder` / `pyramid` | ブロック中心に重ねる立体形状。`box` / `cylinder` / `pyramid` は床接地型、`sphere` / `cube` は浮遊型 |
| `concentric_circle` | boolean | `true` で床マーカーを同心円で描画（祭壇・回復ポイント等の静的オブジェクト向け） |

- 全フィールド省略可。指定したフィールドのみ既定値を上書きします。
- 不正な `mark` / `shape` / `color` は起動時 `alert` + 停止です。

---

## 5. ファイル別リファレンス

各節は「概要 → キー一覧 → サンプル」の順です。数式を取る項目には、使える変数リスト名（[3 章](#3-数式変数リファレンスまとめ)）を記載します。

### 5.1 stats.yml — ステータス定義

プレイヤーと敵が共有する「ステータス（能力値）」を定義します。ここで定義した `name` が、他のすべてのファイル・数式でステータス名として使えるようになります。

**必須ファイル**（存在しない・空だと起動不可）。配列形式。

| キー | 型 | 必須 | 説明 |
| --- | --- | :-: | --- |
| `name` | string | ✅ | ステータス内部 ID（`life` / `power` 等）。数式や他ファイルでこの名前を使う |
| `abbreviation` | string | 推奨 | 画面表示用の略称（`HP` / `POW` 等） |
| `description` | string | 推奨 | 説明文（分析スキルやステータス画面のラベルに使われる） |
| `fluctuation` | boolean | 任意 | `yes` で「現在値/最大値」を持つ変動値（HP・MP 等）になる。省略時は `false`（最大値の概念を持たない単一値） |
| `order` | number | 任意 | ステータス画面（InfoView）の表示順。**未指定のステータスは画面に表示されない**（内部計算には使われる） |
| `default` | number | 任意 | base 値がこの値と一致するとき、ステータス画面に表示しない（初期値と同じ間は隠す用途） |

> このファイルだけ、各フィールドの厳密な型チェックは行われません（最低限 `name` がキーとして使われるのみ）。とはいえ `abbreviation` / `description` は UI 表示に使われるため記載を推奨します。

**`fluctuation` の意味:** `yes` のステータスは「現在値と最大値」を持ちます。`base.yml` の `levelUpBonus` で `reset: yes` を付けると最大値増加時に全回復、`regenerate` で自動回復対象にできます。`no`（既定）のステータスは単一値で、`addStat` がそのまま base に加算されます。

**サンプル:**

```yaml
- name: life
  abbreviation: HP
  fluctuation: yes
  description: HP
  order: 1
- name: magic
  abbreviation: MP
  fluctuation: yes
  description: MP
  order: 2
- name: power
  abbreviation: POW
  description: 攻撃力
  order: 3
- name: karma
  abbreviation: カルマ
  description: KAR
  order: 5
  default: 50          # base が 50 の間はステータス画面に出さない
```

各ステータスの**初期値**は `base.yml` の `playerInitialStats` で設定します（未記載は 0）。

---

### 5.2 base.yml — ゲーム全体設定

ゲームの根幹（戦闘式・成長式・フロア構成）を定義する**必須**ファイルです。他のファイルと違い、トップレベルは**配列ではなくマップ（オブジェクト）**です。

base.yml は項目数が多く、特にマップ生成系（隠し部屋・宝箱・敵リスポーン・長居警告・扉バリアントなど）の挙動は [docs/architecture/data.md](docs/architecture/data.md) に詳述されています。**本節では全キーを一覧で押さえ、深い挙動はそちらへリンクします。**

#### スカラー設定

| キー | 型 | 必須 | 説明 |
| --- | --- | :-: | --- |
| `name` | string | 任意 | ゲーム名（タイトル・セーブメタ）。既定 `'Dungeon Game'` |
| `goalFloor` | number | 任意 | このフロアの階段でゲームクリア。既定 `10` |
| `titleColor` | string | 任意 | タイトル文字の色（CSS カラー文字列 例 `"#ffd966"`）。未指定なら白 `#ffffff` |
| `titleStrokeColor` | string | 任意 | タイトル文字の縁取り色（CSS カラー文字列）。未指定なら黒 `#000000` |
| `backgroundColor` | string | 任意 | タイトル画面の背景色（CSS カラー文字列）。指定すると `bg.png` の代わりに単色で塗りつぶす（タイトル画面のみ） |
| `story` | string | 任意 | あらすじ/バックストーリー。指定するとタイトル画面に「あらすじ」ボタンが出てダイアログで全文表示。複数行はブロックスカラー `\|` で記述可 |
| `author` | string | 任意 | 作者名。指定するとあらすじダイアログのタイトルとストーリーの間に「作者：{author}」を右寄せ表示 |
| `floorLabelFormat` | string | 任意 | 階層表示の書式。`{floor}` を表示用フロア数値で置換。既定 `'{floor}F'`。例 `'B{floor}F'` → `B1F, B2F…`。情報パネル・移動/階段メッセージ・ステータス/リザルト・セーブ一覧すべてに適用。`{floor}` が無いと起動時に warn |
| `floorDisplayFormula` | string\|formula | 任意 | 表示用フロア数値を求める数式（[`階層表示変数`](#3-数式変数リファレンスまとめ)）。未指定なら内部フロア値（1,2,…）をそのまま表示。例 `'goalFloor - currentFloor + 1'` → `10F,9F,…1F`（脱出テーマの降順）。結果は `Math.floor` で整数化のみ（下限クランプ無し＝負値もそのまま表示）。**表示専用でゲーム進行には影響しない** |
| `clearMessage` | string | 任意 | ゴール到達メッセージ。`{floor}` を整形済みフロアラベルで置換。既定 `'{floor}の階段を登り切った！クリア！'`。降下/脱出テーマで「登り切った」が不適切なとき差し替える |
| `playerInitialStats` | map | 任意 | 各ステータスの開始値（例 `{ life: 100, power: 10 }`）。未記載は 0 |
| `defaultDamageStat` | string | ✅ | プレイヤーの死亡判定・トラップダメージ等の既定対象ステータス（通常 `life`） |
| `defaultEnemyDamageStat` | string | 任意 | 敵側のダメージ対象。既定は `defaultDamageStat` |
| `longStayFactor` | number | 任意 | フロア長居警告の規定ターン算出倍率。既定 `4`。詳細は data.md |
| `throwRange` | number | 任意 | アイテム投擲の基準射程（セル数）。`0` 以下で無制限。装備/パッシブの `throwRange` ボーナスが加算される |

#### 数式・配列設定

| キー | 必須 | 内容 | 使う数式変数 |
| --- | :-: | --- | --- |
| `damageFromPlayer.formula` | ✅ | プレイヤー→敵のダメージ。結果は `max(1, floor(...))` でクランプ | [`ダメージ変数`](#3-数式変数リファレンスまとめ) |
| `damageToPlayer.formula` | ✅ | 敵→プレイヤーのダメージ。同上 | [`ダメージ変数`](#3-数式変数リファレンスまとめ) |
| `requiredExp.formula` | ✅ | 次レベルまでの必要経験値 | [`基本変数`](#3-数式変数リファレンスまとめ) |
| `dead.formula` | 任意 | プレイヤー死亡条件（真で死亡）。省略時は「`defaultDamageStat` <= 0」 | 判定対象（プレイヤー）の各 `<stat>` |
| `enemyDead.formula` | 任意 | 敵死亡条件。省略時は `dead.formula`、それも無ければ「`defaultEnemyDamageStat` <= 0」 | 判定対象（敵）の各 `<stat>` |
| `levelUpBonus` | 任意 | レベルアップ時の上昇量。配列 `[{ target, formula, reset? }]` | [`基本変数`](#3-数式変数リファレンスまとめ)（`level` は上昇後の値） |
| `regenerate` | 任意 | 一定ターンごとの自動回復。配列 `[{ target, turn, formula }]` | [`実効＋最大変数`](#3-数式変数リファレンスまとめ) |
| `autoSpawner.formula` | 任意 | ランダム敵が当該フロアに出現可能か（真で出現可）。省略時は既定式 | [`敵出現判定変数`](#3-数式変数リファレンスまとめ) |
| `scheduledEvents` | 任意 | ターン経過で `events.yml` を発火する時限イベント。配列 `[{ event, turn, repeat?, scope? }]` | （数式なし） |
| `longStay` | 任意 | フロア長居の警告/強制移動メッセージ（3 要素の文字列配列） | （数式なし） |

- `damageFromPlayer` / `damageToPlayer` には `player: { use: [...] }` / `enemy: { use: [...] }` という宣言を書けますが、これは**ドキュメント目的**で実装では参照されません（数式内の変数名で動的に解決されます）。`use` も同様にドキュメント用です。
- `levelUpBonus` の `reset: yes`（または `true`）は、`fluctuation: yes` のステータスで最大値を増やした後に現在値を最大値へ揃えます（HP 全回復など）。
- 数式のパース失敗時：必須式（damage 系・requiredExp）と `dead`/`enemyDead`/`autoSpawner` は**起動時 `alert` + 停止**、`levelUpBonus`/`regenerate` は**コンソール警告 + その行を無視**します。

#### フロア毎構成（`floors`）

`floors` は `{ <フロア番号>: { ...設定... } }` のマップを要素に持つ配列です。`getFloorConfig(floor)` は **指定フロア以下で最大のキー**を採用します（例: キー `1` と `4` があるとき、フロア 2・3 は `1` の設定を使う）。

主なフロア設定キー（**太字は使用頻度が高いもの**）：

| キー | 型 | 説明 |
| --- | --- | --- |
| **`size`** | number または `{ w, h }` | マップサイズ。数値で正方形、`{ w, h }` で長方形 |
| **`enemyCount`** | number | ランダム敵の湧き目標数 |
| **`enemies`** | 配列 | 敵プール。文字列 `slime` でランダムプール、`{ name, count }` で固定配置。`enemies.yml` に存在しない名前はエラー |
| **`trapCount`** | number または `{ min, max }` | トラップ設置数 |
| **`traps`** | 文字列配列 | トラップ候補プール（空可）。`traps.yml` 参照 |
| `itemModifierChance` | number (0..1) | 床配置アイテムに modifier を付与する確率 |
| `itemModifierPool` | map | modifier 名 → 追加重み（[item_modifiers.yml](#58-item_modifiersyml--アイテム修飾状態定義) の `weight` と乗算）。省略時は全 modifier が候補 |
| `enemyDropPool` | 配列 | フロア共通の敵ドロップ追加プール `[{ item, rate, modifierChance? }]` |
| `eventCount` | number または `{ min, max }` | 配置するイベント数 |
| `events` | 配列 | イベントプール。文字列で重み 1、`{ name, weight }` で重み指定。`events.yml` 参照 |
| `secretRoom` | boolean / number | 隠し部屋の生成。`true`/`yes` で確率 0.5、数値でその確率 |
| `secretRoomDoorVariants` | map | 隠し部屋扉のバリアント重み `{ plain, locked, lockedDisguised }` |
| `treasure` | map | 隠し部屋の宝箱設定 `{ rate, trapRate, items[] }`（`secretRoom` 有効時のみ） |
| `extraDoorRate` | number (0..1) | 余分な扉を生やす確率。既定 0.3 |
| `respawnCycle` | number | 敵リスポーン間隔ターン。既定 20 |
| `longStayTurns` | number | このフロアの長居規定ターン（絶対値、`longStayFactor` より優先） |

> **マップ生成系キーの詳細挙動**（隠し部屋の判定・扉バリアント別の解除方法・宝箱の開封リスク・敵リスポーンの配置条件・長居警告の段階・`itemModifierPool` の抽選など）は、いずれも [docs/architecture/data.md](docs/architecture/data.md) の「フロア毎構成 (`floors`)」節に網羅されています。新しいマップ系の挙動を細かく制御したいときはそちらを参照してください。

**最小サンプル:**

```yaml
floors:
  - 1:
      size: 15
      enemyCount: 4
      enemies:
        - slime                  # ランダムプール
        - { name: ogre, count: 1 }   # 固定で 1 体配置
      trapCount: { min: 2, max: 4 }
      traps: [spike, swamp]
      itemModifierChance: 0.15
      secretRoom: yes
  - 5:                            # フロア 5 以降の設定（2〜4 は上の「1」を使う）
      size: { w: 20, h: 25 }
      enemyCount: 8
      enemies: [orc, { name: dragon, count: 1 }]
      trapCount: 6
      traps: [spike, swamp, strip]
```

---

### 5.3 items.yml — アイテム定義

武器・防具・消耗品を定義します。配列形式。

| キー | 型 | 必須 | 説明 |
| --- | --- | :-: | --- |
| `name` | string | ✅ | 内部 ID |
| `label` | string | ✅ | 表示名 |
| `type` | `weapon` / `main_armor` / `sub_armor` / `consumable` | ✅ | 種別。`sub_armor` は 2 スロット（指輪など） |
| `effect` | object または配列 | ✅ | 効果（後述）。装備系・消耗品で書き方が変わる |
| `description` | string | ✅ | 説明文 |
| `passive_skills` | 配列 | 任意 | 装備中に付与するパッシブスキル `[{ name, rate }]`（`skills.yml` 参照、`rate` は 0..1） |
| `throwEffect` | 配列 | 任意 | 投げて敵に当てたときの効果（後述） |

#### 装備系（weapon / main_armor / sub_armor）の `effect`

装備系は `effect` の**トップレベルに数値のステータスボーナス**を書きます。装備中のみ有効です。

```yaml
- name: iron sword
  label: 鉄の剣
  type: weapon
  effect:
    power: 15            # 装備中 power +15
  description: 一般的な鉄の剣

- name: anti-poison ring
  label: 解毒の指輪
  type: sub_armor
  effect:
    defense: 2
    resist: [poison]     # 装備中は poison 状態にならない
  description: 装備中は毒状態にならない指輪

- name: throwing glove
  label: 投擲手袋
  type: sub_armor
  effect:
    defense: 1
    throwRange: 2        # 投擲射程 +2（派生ステータス）
  description: アイテムを少し遠くまで投げられる手袋
```

- `<stat>: number` … 装備中のステータスボーナス。
- `resist: [<effect名>...]` … 装備中、それらの状態異常の新規付与を阻止します。
- `throwRange: number` … 投擲射程ボーナス（`stats.yml` に無い派生キー）。

#### 消耗品（consumable）の `effect`

消耗品は `immediate`（即座効果）と `continuous`（持続効果）を持ちます。`effect` は単一オブジェクトでも、複数効果を持つ**配列**でも構いません。

```yaml
- name: potion
  label: 薬
  type: consumable
  effect:
    immediate:
      life: 30           # HP +30
  description: 傷を治す薬

- name: power potion
  label: 力の薬
  type: consumable
  effect:
    continuous:
      turns: 5           # 5 ターン持続
      power: 10          # その間 power +10
  description: 一時的に力を高める薬

- name: antidote
  label: 毒消し
  type: consumable
  effect:                # 配列で複数効果
    - immediate: { clearEffect: poison }
    - immediate: { life: 10 }
  description: 毒を消し、わずかに回復する
```

**`immediate`（即座効果）で使える特殊キー：**

| キー | 内容 |
| --- | --- |
| `<stat>: number` | ステータス変動（`fluctuation` 上限でクランプ） |
| `applyEffect: <effect名>` | 状態異常を付与（`effects.yml` 参照）。耐性があると付与されない |
| `clearEffect: <effect名>` | 状態異常を解除 |
| `learnSkill: <skill名>` | スキルを習得（`skills.yml` 参照）。既習得でもアイテムは消費 |
| `executeSkill: <skill名>` | アクティブスキルを即時発動（コスト無し・未習得不問）。パッシブ系を指定するとエラー |
| `add_modifier: <modifier名>` | 装備中の対象 type のアイテムへ modifier 付与（[item_modifiers.yml](#58-item_modifiersyml--アイテム修飾状態定義) 参照） |
| `remove_modifier_kind: { kind, target }` | 指定スロットの装備から `kind` タグ一致の modifier を一括除去。`target` は `all_equipped` / `weapon` / `main_armor` / `sub_armor` |

**`continuous`（持続効果）のキー：**

| キー | 内容 |
| --- | --- |
| `turns: number` | **必須**。持続ターン数 |
| `<stat>: number` | 持続中のステータスボーナス |
| `resist: [<effect名>...]` | 持続中の耐性 |

#### `throwEffect`（投擲して命中したときの効果）

「投げる」で装備外アイテムを直線投擲し、敵に命中したときの効果です。指定があると、武器の仮装備ダメージや消費アイテムの効果転用より**優先**されます。各エントリは 1 種別、配列で複数列挙可。

| キー | 内容 | 使う数式変数 |
| --- | --- | --- |
| `damage: number \| formula` | ダメージを与える | [`術者/対象変数`](#3-数式変数リファレンスまとめ) |
| `apply_effect: <effect名> \| { effect, rate }` | 状態異常を付与（`rate` は数値 or 数式、術者の[`実効変数`](#3-数式変数リファレンスまとめ)） | — |
| `clear_effect: <effect名>` | 命中した敵の状態異常を解除 | — |

```yaml
- name: spiked shield
  label: トゲ付きの盾
  type: main_armor
  effect:
    defense: 8
  throwEffect:
    - damage: "15 + power - target_defense / 2"
    - apply_effect: { effect: poison, rate: 0.3 }
  description: 投げても相手を傷つけ、毒を与えることがある
```

> `throwEffect` を持たないアイテムを投げた場合の既定挙動（武器＝仮装備ダメージ、消費＝効果転用、防具＝投げ損）や射程の詳細は [docs/architecture/combat.md](docs/architecture/combat.md) の「アイテム投擲システム」を参照してください。

---

### 5.4 enemies.yml — 敵定義

敵を定義します。配列形式。ステータスは `stats.yml` で定義した名前をキーに数値で書きます。

| キー | 型 | 必須 | 説明 |
| --- | --- | :-: | --- |
| `name` | string | ✅ | 内部 ID |
| `label` | string | ✅ | 表示名 |
| `exp` | number | ✅ | 倒したときの経験値（0 以上） |
| `description` | string | ✅ | 説明文 |
| `<stat>` | number | 任意 | 各ステータス値（`life` / `power` / `defense` 等）。`stats.yml` のステータス名をキーにする |
| `color` | number | 任意 | 表示色（`0xRRGGBB`） |
| `walk` | `default` / `random` / `none` | 任意 | 移動 AI。既定 `default`（扉巡回＋追跡）、`random`（ランダムウォーク）、`none`（定位置・隣接時のみ攻撃） |
| `resist` | 文字列配列 | 任意 | 新規付与を阻止する状態異常名 |
| `skills` | 配列 | 任意 | 保有パッシブスキル `[{ name, rate }]`。`skills.yml` 側で `trigger: on_attack` 定義が必要、`rate` は攻撃時発動率 0..1 |
| `drop` | 配列 | 任意 | ドロップ `[{ item, rate, modifierChance? }]`。`rate` は 0..1、`modifierChance` で当該ドロップの modifier 付与率を上書き |

> **`rank` について:** 敵の「強さの目安」`rank` は、予約フィールド（`name` / `label` / `description` / `walk` / `color` / `resist` / `skills` / `drop`）を除く**全数値フィールドの合計**として自動計算されます。`base.yml` の `autoSpawner`（[`敵出現判定変数`](#3-数式変数リファレンスまとめ)）で `rank` / `minRank` / `maxRank` として参照され、フロアごとの出現可否判定に使われます。

**サンプル:**

```yaml
- name: slime
  label: スライム
  life: 20
  power: 5
  defense: 2
  exp: 10
  color: 0x00FF00
  description: 最も弱い魔物
  walk: random
  drop:
    - item: potion
      rate: 0.3

- name: orc
  label: オーク
  life: 60
  power: 15
  defense: 8
  exp: 50
  color: 0x884444
  description: 攻撃力が高い
  skills:
    - name: stun_strike    # skills.yml に trigger: on_attack で定義
      rate: 0.1

- name: ogre
  label: オーガ
  life: 80
  power: 20
  defense: 10
  exp: 80
  color: 0xAA4444
  description: 非常に危険
  drop:
    - item: iron sword
      rate: 0.15
      modifierChance: 0.8   # このドロップは高確率で modifier 付き
```

---

### 5.5 effects.yml — 状態異常/強化定義

毒・麻痺・睡眠・強化などの状態異常/強化効果を定義します。配列形式。

| キー | 型 | 必須 | 説明 |
| --- | --- | :-: | --- |
| `name` | string | ✅ | 内部 ID |
| `label` | string | ✅ | 表示名 |
| `description` | string | 推奨 | 説明文 |
| `timing` | object | ✅ | 発動タイミング別の効果（後述） |
| `clear` | object | ✅ | 解除条件（後述） |
| `resist` | 文字列配列 | 任意 | この効果が付与中に阻止する他の状態異常名 |
| `onExpire` | string | 任意 | **満了時に 1 回だけ**発火する `events.yml` のイベント名（後述） |

#### `timing`

3 つのタイミングを持ち、それぞれ `{ target, formula? , value? }` または その配列を取ります。

| タイミング | 発動時点 |
| --- | --- |
| `onTurnEnd` | ターン終了時（毒ダメージ・MP 減少など） |
| `onAction` | 行動入力の受付時（行動の強制／禁止。麻痺・睡眠・混乱・拘束など。下記 `_action` 参照） |
| `permanent` | 常時（実効ステータス計算時に適用。攻撃力ダウンなど） |

各 `target` 仕様：

- `target: <stat>` … 変化対象のステータス名。`formula` で新しい値を計算します（[`状態異常変数`](#3-数式変数リファレンスまとめ)：`x` = 現在値、`count` = 経過ターン）。
- `target: _action` … 特殊指定。主体（プレイヤー/敵）の行動を**強制**または**禁止**します。`value` にアクション（ツリー）を与えます。詳細は次節。

##### `target: _action`（行動の強制・禁止）

`value` は **アクションノード単体、またはノードのリスト**です。リストの場合、状態異常ごとの専用カウンタ `actionIndex`（付与時 0・0 起点。`clear` 等で使う共有 `count` とは別管理）で要素を順に選びます。`actionIndex` がリスト長を超えると**末尾要素を繰り返し**ます。`actionIndex` は「その効果が行動を支配した手番」ごとに 1 進み、付与した手番そのものでは進まないため、先頭要素 `value[0]` が必ず最初に使われます。

ノードの書き方：

- 引数なし: `skip` のような文字列。
- 引数あり: `[verb, arg]`（例 `[skip, "メッセージ"]` / `[use_item, "ポーション"]` / `[move, "forward"]`）。
- 組み合わせ: `[random, [サブ...]]`（毎ターン一様抽選）/ `[repeat, [サブ...]]`（サブリストを `(actionIndex − 開始位置) mod サブ長` で巡回。**top-level 末尾のみ**・入れ子不可）。

> **注意**: 引数付きの単一アクションを `value` 直下に書くときは、配列リテラル誤読を避けるため必ず**リスト要素**にします（`value:` の下に `- [skip, "..."]`）。`value: [skip, "..."]` は「`skip` と `"..."` の 2 要素リスト」と解釈されエラーになります。

**force 系（行動を強制・ターン消費）**:

| verb | 動作 | 引数 |
| --- | --- | --- |
| `skip` | 何もせずターン消費 | 任意: 表示メッセージ |
| `attack` | 正面の敵を自動攻撃（不在ならメッセージ＋空ターン） | — |
| `attack_self` | 自分自身を攻撃（被弾扱い＝`clear.onDamage` 発火、パッシブ非発動） | — |
| `move` | 指定/ランダム方向へ移動（壁でも消費） | 任意: `forward`/`back`/`left`/`right` |
| `use_item` | 指定/ランダムな消耗品を使用（未所持なら空費） | 任意: アイテム名 |
| `equip` | 指定/ランダムな装備を装備（未所持なら空費） | 任意: アイテム名 |
| `unequip` | 指定スロットの装備を外す（**ターン消費**） | 必須: `weapon`/`main_armor`/`sub_armor1`/`sub_armor2` |
| `use_skill` | 指定/ランダムな active スキルを発動（不能なら空費） | 任意: スキル名 |
| `random` / `repeat` | 子配列の組み合わせ（子は **force 系のみ**） | 必須: アクション配列 |

**forbid 系（一部入力を禁止・ターン非消費。`not_*` は top-level のみ）**:

| verb | 禁止カテゴリ | 引数 |
| --- | --- | --- |
| `not_move` | 移動 | 任意: 表示メッセージ |
| `not_skill` | スキル | 任意: 表示メッセージ |
| `not_attack` | 攻撃・調べる・足下・スキル | 任意: 表示メッセージ |
| `not_action` | 攻撃・調べる・足下・スキル・アイテム使用/装備 | 任意: 表示メッセージ |

複数効果が同時に `_action` を持つ場合：forbid は**和集合**、force は付与順で**最初の 1 つ**。force のカテゴリが forbid 集合に入ると `skip` に降格します。**敵**には `use_item`/`equip`/`unequip`/`use_skill` は無効（skip 扱い）、`not_skill` も無効です。引数（アイテム名・スキル名・スロット名・方向トークン）は起動時 `YamlCrossValidator` で照合され、不正ならエラーになります。

#### `clear`

| キー | 内容 | 使う数式変数 |
| --- | --- | --- |
| `formula` | ターン終了時に評価する **0〜1 の解除確率**。`1` で確実解除 | [`解除確率変数`](#3-数式変数リファレンスまとめ)（`count`） |
| `onDamage` | `true` で被弾時にも即解除（睡眠など） | — |

> `clear.formula` は確率式のほか、**閾値式**としても使えます。例えば `"count >= 30 ? 1 : 0"` にすると「30 ターン後に必ず解除」というカウントダウンになります。これと `onExpire` を組み合わせると「時限爆弾」型の効果を作れます。

#### `onExpire`（満了時イベント）

`clear.formula` 由来の**自然解除（満了）の瞬間に 1 回だけ** `events.yml` のイベントを発火します。治療（`clearEffect`）や被弾解除（`clear.onDamage`）では発火しません。「何もしなければ N ターン後に発動／治療すれば回避」型の遅延効果に使います。参照先イベントは `action` / `random_outcome` 形式のみ（`choices` 不可）。

**サンプル:**

```yaml
- name: poison
  label: 毒
  description: 徐々にダメージを受ける
  timing:
    onTurnEnd:
      target: life
      formula: "(x - 5) <= 0 ? 1 : (x - 5)"   # x = 現在 HP
  clear:
    formula: "(count ^ 2) * 0.01"             # 経過とともに解除されやすく

- name: stun
  label: 麻痺
  description: 1ターン動けない
  timing:
    onAction:
      target: _action
      value: skip
  clear:
    formula: "count > 1 ? 1 : 0"

- name: fear
  label: 恐怖
  description: 攻撃力が下がる
  timing:
    permanent:
      target: power
      formula: "x * 0.6"                       # 実効 power を 0.6 倍
  clear:
    formula: "(count ^ 2) * 0.01"

# 時限爆弾型（30 ターン後に onExpire を発火）
- name: death_curse
  label: 死の呪い
  description: 解けないと約30ターン後に生命力を奪われる
  timing: {}
  clear:
    formula: "count >= 30 ? 1 : 0"
  onExpire: death_curse_payload                # events.yml のイベント
```

---

### 5.6 traps.yml — トラップ定義

踏むと発動するトラップを定義します。配列形式。配置は `base.yml` の `floors[].traps` プールで参照されます。

| キー | 型 | 必須 | 説明 |
| --- | --- | :-: | --- |
| `name` | string | ✅ | 内部 ID |
| `label` | string | ✅ | 表示名 |
| `description` | string | ✅ | 説明文 |
| `effect` | 配列 | ✅ | 発動時に順次適用される効果（後述） |
| `visible` | boolean | 任意 | `true` で最初から見える。既定 `false`（隠れ罠） |
| `appearance` | object | 任意 | 見た目（[4.1 appearance](#41-appearance見た目)）。既定は赤×ピラミッド |

#### `effect`（配列、順次適用）

| `type` | 必要キー | 内容 |
| --- | --- | --- |
| `stat` | `target`（stat 名）、`value`（数値） | ステータス変動。`target: life` で `value < 0` ならダメージ扱い |
| `addEffect` | `value`（`effects.yml` の effect 名） | 状態異常を付与 |
| `unequip` | （なし） | 全装備スロットを強制解除（呪い `cannot_unequip` も無視） |

> `stat` の `value` は数値リテラルのみで、数式は使えません。

**`visible` の挙動:** `false`（既定）は踏むと自動発動して可視化される隠れ罠。`true` は最初から見えて、**踏んでも自動発動しません**。プレイヤーが避けるか、「足下」ボタンで意図的に起動します（回復パッド・祭壇のような選択式オブジェクトを作れる）。

**サンプル:**

```yaml
- name: spike
  label: トゲの床
  description: トゲが生えた床
  effect:
    - type: stat
      target: life
      value: -10

- name: swamp
  label: 毒の沼
  description: 怪しく濁った毒の沼
  effect:
    - type: addEffect
      value: poison        # effects.yml の effect 名

- name: healing_pad
  label: 回復パッド
  description: 意図して起動すると体力が回復する
  visible: true            # 最初から見える＝踏んでも自動発動しない
  appearance:
    mark: o
    color: 0x66CCFF
    shape: cylinder
    concentric_circle: true
  effect:
    - type: stat
      target: life
      value: 30
```

---

### 5.7 skills.yml — スキル定義

アクティブスキル・パッシブスキルを定義します。配列形式。プレイヤー・敵の双方が参照します。

| キー | 型 | 必須 | 説明 |
| --- | --- | :-: | --- |
| `name` | string | ✅ | 内部 ID |
| `label` | string | ✅ | 表示名 |
| `description` | string | ✅ | 説明文 |
| `trigger` | enum | 任意 | 発動契機（下表）。省略時 `active` |
| `target` | enum | ※ | 対象スコープ（下表）。`trigger: passive` 以外では**必須** |
| `cost` | map | 任意 | 発動コスト `{ <stat>: number \| formula }`。数式は[`実効＋最大変数`](#3-数式変数リファレンスまとめ) |
| `action` | 配列 | ※ | 実行するアクション列（下表）。`passive` 以外では**必須・非空** |
| `mastery` | 配列 | 任意 | レベルアップでの習得条件（後述） |
| `add_stats` | map | ※ | `trigger: passive` 専用の常時ステータス加算 `{ <stat\|stat_max>: number \| formula }`。数式は[`基本変数`](#3-数式変数リファレンスまとめ) |
| `toggle` | `yes`/`no` | 任意 | パッシブ専用。有効/無効を手動切替可能にする（`active` には付けられない） |

#### `trigger`（発動契機）

| 値 | 意味 | 許可される `target` |
| --- | --- | --- |
| `active`（既定） | プレイヤーが能動使用 | `front` / `straight` / `around` / `room` / `map` / `self` |
| `on_attack` | 通常攻撃後に自動発動（プレイヤー/敵） | `hit` のみ |
| `on_turn` | プレイヤーのターン終了時に自動発動 | `self` のみ |
| `on_damage` | 被弾直後に自動発動 | `self` または `hit` |
| `passive` | 常時ステータス修飾（`add_stats` で記述） | （省略可） |

#### `target`（対象スコープ）

| 値 | 意味 |
| --- | --- |
| `front` | UI で前方 3 方向から 1 セル選択 |
| `straight` | 前方 3 方向から 1 つ選び、その射線上の**最初の敵**を狙う（遠距離。壁・扉で遮蔽、敵がいなければコスト未消費の空振り） |
| `around` | 発動者の隣接 8 マス |
| `room` | 発動者と視覚的に繋がった範囲（部屋＋通路） |
| `map` | マップ全体 |
| `self` | 発動者自身 |
| `hit` | 攻撃した相手（`on_attack` / `on_damage` パッシブ専用） |

#### `action`（アクション列）

各要素は「文字列（パラメータなし）」か「単一キーのオブジェクト」です。target スコープ内の各対象に順次適用されます。

| アクション | 形式 | 内容 | 使う数式変数 |
| --- | --- | --- | --- |
| `attack` | 文字列 | `damageFromPlayer` 式でダメージ | — |
| `damage` | `{ damage: number\|formula }` | 独自式でダメージ | [`術者/対象変数`](#3-数式変数リファレンスまとめ) |
| `heal` | `{ heal: number\|formula }` | `defaultDamageStat`（HP）を回復 | [`術者/対象変数`](#3-数式変数リファレンスまとめ) |
| `apply_effect` | `{ apply_effect: <名前> \| { effect, rate } }` | 状態異常を付与（`rate` は数値 or 術者[`実効変数`](#3-数式変数リファレンスまとめ)の数式） | — |
| `reveal_trap` | 文字列 | スコープ内の未発見トラップを可視化 | — |
| `analyze` | 文字列 | スコープ内の敵の詳細を表示 | — |

#### `mastery`（習得条件）

レベルアップ時に未習得スキルを抽選で習得させます。各エントリは以下のいずれか：

- `{ exact: N }` … レベル `N` 到達で確実習得（`{ least: N, rate: 1 }` の糖衣）
- `{ least: N, rate: R }` … レベル `N` 以上のレベルアップで確率 `R`（0..1）習得

複数エントリがある場合、`least` を満たすうち最大の `least` を持つエントリの `rate` を使います。

**サンプル:**

```yaml
# アクティブ：前方の敵を 2 回攻撃。MP2 消費。レベル 2 で習得
- name: double_attack
  label: 2回攻撃
  description: 1ターンで2回攻撃する
  target: front
  cost: { magic: 2 }
  action: [attack, attack]
  mastery:
    - exact: 2

# アクティブ：遠距離ダメージ
- name: magic_arrow
  label: 魔法の矢
  description: 射線上の最初の敵を射抜く
  target: straight
  cost: { magic: 4 }
  action:
    - damage: "power - target_defense / 2"

# 敵パッシブ：攻撃時に毒付与（enemies.yml の skills から参照）
- name: poison_bite
  label: 毒噛み
  description: 攻撃時に毒状態にすることがある
  trigger: on_attack
  target: hit
  action:
    - apply_effect: { effect: poison, rate: 1.0 }

# トグル可能パッシブ：毎ターン MP1 で HP3 回復
- name: meditate
  label: 瞑想
  description: 毎ターン魔力を1消費して体力を3回復する
  trigger: on_turn
  target: self
  toggle: yes
  cost: { magic: 1 }
  action: [{ heal: 3 }]

# 常時ステータス修飾パッシブ
- name: vigor
  label: 活力
  description: 攻撃力・体力上限が常時上昇する
  trigger: passive
  add_stats:
    power: 3
    life_max: "level * 2"
```

> スキルの target 解決ルール・コスト評価・パッシブの発動経路など、踏み込んだ挙動は [docs/architecture/skills.md](docs/architecture/skills.md) を参照してください。

---

### 5.8 item_modifiers.yml — アイテム修飾状態定義

「攻撃強化」「呪い」など、装備個体ごとに付く修飾状態を定義します。配列形式。装備中のみ効果が発動します。

| キー | 型 | 必須 | 説明 |
| --- | --- | :-: | --- |
| `name` | string | ✅ | 内部 ID |
| `label` | string | ✅ | 表示名 |
| `shortLabel` | string | 任意 | アイテム名 suffix 用の短縮表示（`攻+` 等）。未指定時は `label` |
| `description` | string | 任意 | 説明文 |
| `target` | 配列 | ✅ | 適用可能なアイテム type の配列（`weapon` / `main_armor` / `sub_armor` / `consumable`） |
| `effect` | 配列 | ✅ | 効果（後述、非空） |
| `countable` | boolean | 任意 | `true` で重ねがけ可能。`max` が必須になる |
| `max` | number | ※ | `countable: true` 時必須。重ねがけ上限（1 以上） |
| `initial` | `{ min, max }` | 任意 | 床配置時の初期 count 抽選範囲（`1 <= min <= max <= max`） |
| `kind` | string | 任意 | 一括除去用のタグ（解呪の `curse` 等） |
| `weight` | number | 任意 | 床配置・敵ドロップ時の抽選重み（0 以上、既定 1） |

#### `effect`

| `name` | 必要キー | 内容 |
| --- | --- | --- |
| `add_stats` | `target`（stat 名）、`formula` | 装備中、target ステータスに数式評価値を加算。数式は[`修飾状態変数`](#3-数式変数リファレンスまとめ) |
| `cannot_unequip` | （なし） | 装備解除をブロック（呪い用） |

**サンプル:**

```yaml
- name: power_reinforced
  label: 攻撃強化
  shortLabel: 攻+
  description: 装備中、武器の攻撃力が上昇する
  target: [weapon]
  countable: true
  max: 5
  initial: { min: 1, max: 1 }
  weight: 10
  effect:
    - name: add_stats
      target: power
      formula: power * (0.05 * count)   # count 段でそれぞれ +5%

- name: cursed
  label: 呪い
  shortLabel: 呪
  description: 装備すると外せなくなる
  target: [weapon, main_armor, sub_armor]
  countable: false
  kind: curse                           # 解呪の巻物が kind: curse を一括除去
  weight: 3
  effect:
    - name: cannot_unequip
```

> modifier の合算順序や付与経路（巻物・敵ドロップ・宝箱）の詳細は [docs/architecture/items.md](docs/architecture/items.md) の「アイテム修飾状態（modifier）」節を参照してください。

---

### 5.9 events.yml — 汎用イベント定義

回復ポイント・祭壇・能力判定・選択肢メニューなどの汎用イベントオブジェクトを定義します。配列形式。プレイヤーが**調査（C キー）**したときに起動します。配置は `base.yml` の `floors[].events` で参照します。

| キー | 型 | 必須 | 説明 |
| --- | --- | :-: | --- |
| `name` | string | ✅ | 内部 ID |
| `label` | string | ✅ | 表示名 |
| `flavor` | string | ✅ | 調査時に必ずログ出力するフレーバー文 |
| `description` | string | 任意 | 説明文 |
| `appearance` | object | 任意 | 見た目（[4.1 appearance](#41-appearance見た目)）。既定は `*` + `0x88CCFF` + sphere |
| `blocking` | boolean | 任意 | `true`（既定）で進入禁止セル化（宝箱と同じ）。`false` で進入可能 |
| **結末** | — | ✅ | `action` / `random_outcome` / `choices` の**ちょうど 1 つ**（後述） |

#### 結末（3 種のうち 1 つ）

| キー | 形式 | 用途 |
| --- | --- | --- |
| `action` | アクション配列 | 選択肢なしで即実行 |
| `random_outcome` | `[{ weight, label?, action }]` | 重み付き抽選で 1 件実行（ランダム祭壇など） |
| `choices` | `[{ label, ... }]`（最大 10） | 選択肢メニューを表示 |

`choices` の各エントリ：

| キー | 内容 | 使う数式変数 |
| --- | --- | --- |
| `label` | 選択肢の表示名（必須） | — |
| `cost` | コスト `{ <stat>: number\|formula }` | [`実効＋最大変数`](#3-数式変数リファレンスまとめ) ＋ [`イベント関数`](#3-数式変数リファレンスまとめ) |
| `condition` | 表示条件（真のときだけ表示） | 同上 |
| `rate` | 成功確率（0..1）。指定時は `action` でなく `on_success` / `on_fail` 両方が必須 | 同上 |
| `action` | `rate` 無し時の実行内容（空配列 `[]` で「何もしない」） | — |
| `on_success` / `on_fail` | `rate` 指定時の成功/失敗分岐 | — |

#### `action` のアクション種別

| アクション | 形式 | 内容 | 使う数式変数 |
| --- | --- | --- | --- |
| `heal` | `{ heal: number\|formula }` | HP を回復 | [`実効＋最大変数`](#3-数式変数リファレンスまとめ) ＋ [`イベント関数`](#3-数式変数リファレンスまとめ) |
| `damage` | `{ damage: number\|formula }` | HP を減少（死亡で game-over） | 同上 |
| `mod_stat` | `{ mod_stat: { stat, formula } }` | 任意ステータスを数式評価値に**設定**（MP を特定値にする等） | 同上 |
| `apply_effect` | `<名前> \| { effect, rate }` | 状態異常を付与 | — |
| `learn_skill` | `{ learn_skill: <名前> }` | スキル習得 | — |
| `execute_skill` | `{ execute_skill: <名前> }` | コスト無しでスキル発動（`target: front` 不可） | — |
| `add_modifier` | `{ add_modifier: <名前> }` | 装備に modifier 付与 | — |
| `remove_modifier_kind` | `{ remove_modifier_kind: { kind, target? } }` | kind 一致の modifier 除去 | — |
| `give_item` | `<名前> \| { name, count?, modifiers? }` | アイテム入手（満杯時は足下に落とす） | — |
| `consume_item` | `<名前> \| { name, count? }` | 所持アイテムを除去（対価イベント用） | — |
| `spawn_enemy` | `<名前> \| { name, count?, near? }` | 敵を生成（`near: around` / `room`） | — |
| `message` | `{ message: <text> }` | 任意ログ出力（演出用） | — |
| `self_destruct` | 文字列 | このイベントを消す（1 回限りのイベント用） | — |

> `action` 内のアイテム名・敵名・スキル名・effect 名は、起動時に[横断バリデーション](#6-起動時バリデーションとエラーの読み方)で対応ファイルとの存在チェックを受けます。

**サンプル:**

```yaml
# 回復ポイント（繰り返し可、コスト MP2）
- name: healing_fountain
  label: 癒しの泉
  description: 清らかな水が湧き出ている
  flavor: 透き通った水が傷を癒してくれそうだ。
  appearance: { mark: o, color: 0x66CCFF, shape: cylinder, concentric_circle: true }
  blocking: true
  choices:
    - label: 飲む
      cost: { magic: 2 }
      action:
        - heal: "life_max * 0.5"
        - message: 心地よい水が体を満たした
    - label: 立ち去る
      action: []

# 能力依存判定（成功/失敗分岐、成功で自壊）
- name: heavy_rock
  label: 大岩
  description: 大きな岩
  flavor: 大岩の陰に何かが見える。動かせるだろうか？
  appearance: { mark: '[]', color: 0x888888, shape: cube }
  choices:
    - label: 退かす
      cost: { life: "ceil(life_max * 0.05)" }
      rate: "min(1, power / 30)"
      on_success:
        - give_item: { name: potion }
        - message: 岩を退かすと薬が転がり出た！
        - self_destruct
      on_fail:
        - damage: 10
        - message: 岩はびくともしなかった……。
    - label: 諦める
      action: []

# 条件付き選択肢（薬を所持しているときだけ表示）
- name: wounded_animal
  label: 傷ついた動物
  flavor: 傷ついた動物が横たわっている。苦しそうだ。
  appearance: { mark: o, color: 0x66AA44, shape: sphere }
  choices:
    - label: 薬を与える
      condition: 'has_item("potion")'
      action:
        - consume_item: { name: potion, count: 1 }
        - give_item: { name: power scroll }
        - message: 動物は回復し、お礼に巻物をくれた！
        - self_destruct
    - label: そっとしておく
      action: []
```

> 結末 3 種の使い分け、`condition` の評価タイミング、時限イベント（`scheduledEvents`）・満了イベント（`onExpire`）からの起動など、踏み込んだ仕様は [docs/architecture/events.md](docs/architecture/events.md) を参照してください。

---

## 6. 起動時バリデーションとエラーの読み方

データの不正は、ゲーム起動（ブラウザでの読み込み）時に検出されます。検出は 2 段階あります。

### 6.1 ファイル単体のバリデーション（パース時）

各ファイルの読み込み時に、必須キーの有無・型・数式の文法を検査します。問題があると **ブラウザの `alert` ダイアログ**でファイル名とエラー詳細を表示し、ゲームを停止します。

- メッセージ例: `アイテムデータの読み込みに失敗しました。... エラー詳細: Invalid item 'iron sword': missing or invalid 'type' field`
- `alert` の `エラー詳細:` 部分が原因です。`Invalid <種別> '<name>': <理由>` の形なので、**どのエントリのどのキーが問題か**が分かります。
- ファイル不存在・空の扱い: `base.yml` / `stats.yml` 以外は不存在・空でも `alert` は出さず、コンソールにログを出して続行します（その要素抜きで起動）。`base.yml` / `stats.yml` は必須なので `alert` + 停止です。
- 数式の文法エラーも、項目により `alert` + 停止（必須式）か、コンソール警告 + 無視（`levelUpBonus` / `regenerate` 等）になります。

### 6.2 横断バリデーション（ファイル間の参照チェック）

全ファイルの読み込み後、`YamlCrossValidator` が**ファイルをまたぐ参照**を検査します。エラーがあると専用の **`YamlErrorDialog`**（ゲーム内ダイアログ）にエラー一覧を表示します。主な検査内容：

- `base.yml` の `floors[].enemies` / `traps` / `events` 名が、それぞれ `enemies.yml` / `traps.yml` / `events.yml` に存在するか
- `traps.yml` の `addEffect` の値が `effects.yml` に存在するか
- `items.yml` の `learnSkill` / `executeSkill` が `skills.yml` に存在するか（`executeSkill` はアクティブのみ）
- `events.yml` の action 内参照（`give_item`/`consume_item`→items、`spawn_enemy`→enemies、`learn_skill`/`execute_skill`→skills、`add_modifier`→item_modifiers、`apply_effect`→effects、`mod_stat.stat`→stats 等）
- `base.yml` の `scheduledEvents[].event` と `effects.yml` の `onExpire` が `events.yml` に存在し、かつ `action` / `random_outcome` 形式（`choices` 不可）か
- `enemies.yml` / `effects.yml` / `items.yml` の各 `resist[]` が `effects.yml` に存在するか

> ステータス名は `stats.yml` を基準に検査されます。`base.yml` の `throwRange` のような stats.yml 非登録の派生キーは、検査対象から除外されています（装備の `throwRange` 等）。

### 6.3 つまずきやすい点

- **`name` のタイプミス / リネーム漏れ** … 横断バリデーションで「存在しません」エラーになります。参照側（`base.yml` など）も一緒に直してください。
- **数式変数の取り違え** … 例えば `base.yml` の `damageFromPlayer` で `power`（接頭辞なし）と書くと未定義変数になります。ここは [`ダメージ変数`](#3-数式変数リファレンスまとめ) なので `player_power` / `enemy_defense` のように接頭辞が必要です。各キーの「使う数式変数」欄を確認してください。
- **結末の同時指定** … `events.yml` で `action` と `choices` を両方書くとエラーです。ちょうど 1 つにしてください。
- **`countable` modifier の `max` 漏れ** … `countable: true` には `max` が必須です。

---

## 7. カスタムデータ（ZIP）での差し替え手順

`public/data/` を書き換えずに、**ローカルの ZIP ファイル**から YAML 群を差し込んでプレイできます。配布や試遊に便利です。

### 7.1 ZIP の作り方

1. 9 ファイルの YAML を用意します（`item_modifiers.yml` のみ任意）。
2. それらを ZIP に固めます。ファイルは **ZIP のルート直下**、または **`data/` フォルダ直下**のどちらでも認識されます（例: `base.yml` または `data/base.yml`）。

   ```text
   mydata.zip
   ├ base.yml          （必須）
   ├ stats.yml         （必須）
   ├ items.yml         （必須）
   ├ enemies.yml       （必須）
   ├ effects.yml       （必須）
   ├ traps.yml         （必須）
   ├ skills.yml        （必須）
   ├ events.yml        （必須）
   └ item_modifiers.yml （任意：無ければ public/data/ の既定を使用）
   ```

   > `item_modifiers.yml` 以外が ZIP に欠けていると「以下のファイルが見つかりません」エラーになり、読み込みは中止されます。

### 7.2 読み込み手順

1. タイトル画面の「ZIP ファイルからカスタムデータを読み込む」欄で「ZIP を選択」を押し、作成した ZIP を選びます。
2. 全必須ファイルが揃っていれば、その場でゲームが起動します。以降は `public/data/` の代わりに ZIP の内容が使われます。
3. ZIP 内のデータが不正な場合は、[6 章](#6-起動時バリデーションとエラーの読み方)と同じバリデーションが走り、`alert` / `YamlErrorDialog` でエラーを表示します。

> カスタムデータは ZIP 内容の `yamlDigest`（ダイジェスト）でセーブデータとの互換性が管理されます。データを変更すると、過去のセーブデータが互換性なしと判定される場合があります。

---

*このマニュアルは `public/data/` の各 YAML を読み込む Loader 群（`src/lib/*Loader.ts`）の実装に基づいています。データ仕様を変更したら、本マニュアルと [docs/architecture/](docs/architecture/) の該当ドキュメントも更新してください。*

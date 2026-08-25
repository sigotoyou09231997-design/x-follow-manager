# レイアウト（位置）の地図

「この要素を別の場所へ動かしたい」と言われたときに、**どのファイルの何行目を触れば
その位置が決まるのか**を引けるようにした一覧。デザインの見直しをするときは、まず
ここで当たりを付けてから `src/App.css` を開く。

行番号は目安。ずれていたらセレクタ名で検索する（セレクタ名は動かさない限り不変）。

現状の見た目は `node scripts/design-shots.mjs` で撮れる（撮り方は末尾）。

---

## 1. 画面の骨格

DOMの並び順は `src/App.tsx` の JSX がそのまま。上から下へ:

```
.app-shell                      App.tsx:202 / App.css:5
├─ .update-banner               UpdateBanner.tsx  … 画面最上部に固定で降ってくる
├─ .app-header                  App.tsx:205 / App.css:13
│   ├─ .app-header__logo        左端。ホームへ戻る唯一の入口（PCの下部バーは無い）
│   ├─ .app-header__search      PC(≥1024px)だけ表示。中央寄せ
│   ├─ .privacy-badge           ≥768px だけ表示
│   └─ .app-header__avatar      右端。設定へ
├─ .app-body                    App.css:94   … 中央寄せの外枠（max-width 1320px）
│   ├─ .side-nav                App.tsx:240 / App.css:103  … PCのみ・左220px
│   └─ .main-content            App.tsx:262 / App.css:145  … 各画面の中身
│       └─ .app-footer          App.css:155  … 本文の最後にぶら下がる
└─ .bottom-nav                  App.tsx:370 / App.css:168  … 狭い画面のみ・下端固定
```

位置を決めている主な指定:

| 要素 | 位置の決まり方 | 場所 |
| --- | --- | --- |
| `.app-header` | `position: sticky; top: 0; z-index: 40` | App.css:13 |
| `.app-header__logo` | `margin-right: auto` で左端に寄せ、以降を右へ押す | App.css:28 |
| `.app-header__search` | `flex: 1 / max-width: 460px / margin: 0 auto` で中央 | App.css:41 |
| `.app-body` | `max-width: 1320px; margin: 0 auto` の中で横並び | App.css:94 |
| `.side-nav` | `width: 220px` 固定 + `position: sticky; top: 68px` | App.css:103 |
| `.main-content` | `flex: 1` で残り全部。`padding: 20px 20px 0` | App.css:145 |
| `.bottom-nav` | `position: fixed; bottom: 0; z-index: 70` | App.css:168 |
| 下部バーのぶんの余白 | `.app-shell { padding-bottom: 84px + safe-bottom }` | App.css:5 |
| `.bottom-nav__fab`（中央の＋） | 下部バーの3番目の子として中央に並ぶ（`justify-content: space-around`） | App.tsx:385 / App.css:214 |

**ナビの項目そのものを増減・並べ替えするのは CSS ではなく `src/App.tsx` の
`BOTTOM_NAV`(34行目) と `SIDE_NAV`(42行目) の配列。** 順番＝表示順。
中央の＋はナビ項目ではなく操作なので配列には入っていない（App.tsx:33 のコメント）。

---

## 2. 折り返し（ブレークポイント）

| 幅 | 起きること | 場所 |
| --- | --- | --- |
| `≤380px` | 統計の文字だけ小さくする | App.css:2686 |
| `≤640px` | ヘッダー・本文の余白を詰める / サマリを3列×2段に | App.css:2575, 2806 |
| `≥768px` | `.privacy-badge`（端末内で処理）が出る | App.css:1281 |
| `≤1023px` | 本文を780px幅で中央寄せ / **確認カードが一覧の上に全画面で被さる** / 日付ストリップを出す | App.css:1287 |
| `≥1024px` | 下部バーを消して左サイドバーを出す / ヘッダー検索を出す / **確認カードが右カラム（sticky, 340px）に常駐** / 一覧以外の画面を720px幅で止める | App.css:1326 |
| `≥900px`（コンポーザーのみ） | 下から出るシートを画面中央のダイアログに変える | App.css:2051 |

「PC / モバイル」の境目は **1024px** ひとつだけ、と考えてよい。
640px と 768px は余白と小物の出し入れだけで、骨格は変わらない。

---

## 3. 重なり順（z-index）

上にあるものほど手前。位置を動かすときは、この順番も一緒に見る。

| z-index | 要素 | 場所 |
| --- | --- | --- |
| 200 | `.update-banner`（アップデート通知） | App.css:1627 |
| 150 | `.composer-sheet`（投稿作成シート） | App.css:1927 |
| 90 | 狭い画面の確認カード全画面表示 | App.css:1296 |
| 70 | `.bottom-nav` | App.css:168 |
| 40 | `.app-header` | App.css:13 |

`.side-nav`(top:68px) と PC の確認カード(`top: 86px`, App.css:1349) は、
ヘッダーの高さを見込んだ数字が直接書いてある。**ヘッダーの高さを変えるなら
この2つも一緒に直す**（ずらすとヘッダーの下に潜り込む・不自然に空く）。

---

## 4. 画面ごとの中身の並び

### ホーム（`tab === 'home'`）

`src/components/HomeView.tsx` の並び順そのまま。上から:

1. `.home-greeting`（Hey, tidy!） … App.tsx:315 / App.css:585
2. `.home-search`（検索ボタン） … App.css:601
3. `.home-section` フォロー整理 → `.home-cards` に `.entry-card` 2枚（未確認 / 残す） … App.css:620, 631, 637
4. `.home-section` 今日のタスク → `.task-list` … App.css:685
5. `.summary-bar`（6項目のグリッド） … App.css:746
6. 最近のうごき（`HistoryView` を limit=5 で埋め込み） … App.css:1154

`.home-cards` は2列グリッド、`.summary-bar` は6列（≤640pxで3列×2段）。

### フォロー整理 / 残すリスト（`tab === 'tidy' | 'protected'`）

`src/components/FollowTidyView.tsx`。上から:

1. `.view-head`（READY TO REVIEW / 見出し） … App.css:430
2. `.tidy-toolbar` … App.css:798
   - 左: `.filter-bar__tabs`（すべて/未確認/残す） App.css:817
   - 右: `.tidy-toolbar__end` に バッチ人数(`.batch-controls__size` App.css:866) / 次のN人を選択 / CSV書き出し
3. `.tidy-layout`（App.css:896）
   - `.tidy-layout__list` … `.account-table` + `.pagination`
   - `.tidy-layout__detail` … `.review-panel`（App.css:1033）
     - **≤1023px**: 全画面で被せる（App.css:1296）
     - **≥1024px**: 右カラムに sticky で常駐、幅340px（App.css:1349）

一覧の1行は `src/components/AccountRow.tsx` / `.account-row`（App.css:921）。
アバター・名前・時刻・シェブロンの横並びはここ。

### 履歴（PCのサイドバーからのみ / モバイルはホーム内に埋め込み）

`.timeline`（App.css:1154）。点(`.timeline__dot`)は `position: absolute` で
左の縦線に乗せている（App.css:1172）。

### 予約投稿（`tab === 'schedule'`）

`src/components/schedule/ScheduleView.tsx`。`.schedule-view`（App.css:1393）が縦並び。
`.stat-strip`(1522) → `.stat-hero`(1528) + `.stat-grid`(1581)、
`.schedule-view__toolbar`(1451)、`.post-list`(2351)。
作成シートは `.composer-sheet`(1927) で、下から出る（≥900pxでは中央）。

### 設定 / 読み込み前

`.settings-view`(792)、`.onboarding`(525) + `.file-drop`(547)。
どちらも `.main-content` の中で、PCでは720px幅で止まる。

---

## 5. 現状を撮って見比べる

```bash
npm run build
npm run preview -- --port 4173 --strictPort   # 別ターミナルで動かしておく

node scripts/design-shots.mjs                       # .design-shots/ に保存
node scripts/design-shots.mjs --out .design-shots/after   # 変更後を別名で
```

- PC(1440) / タブレット(900) / モバイル(390) × ライト・ダーク × 各画面。
- 1画面につき2枚。`◯◯.png` が画面ぴったり、`◯◯-full.png` が下まで伸ばしたもの。
  **位置の判断はぴったりの方でする**（`-full` は固定表示の下部バーがページの
  途中に写り込むので、実際の見え方とは違う）。
- E2Eと同じ合成アーカイブを読ませてから撮るので、一覧も確認カードも中身が入る。
- `.design-shots/` はコミットしない（`.gitignore` 済み）。

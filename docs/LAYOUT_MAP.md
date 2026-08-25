# レイアウト（位置）の地図

「この要素を別の場所へ動かしたい」と言われたときに、**どのファイルの何行目を触れば
その位置が決まるのか**を引けるようにした一覧。デザインの見直しをするときは、まず
ここで当たりを付けてから `src/App.css` を開く。

行番号は目安。ずれていたらセレクタ名で検索する（セレクタ名は動かさない限り不変）。

現状の見た目は `npm run design:shots` で撮れる（撮り方は末尾）。
色・角丸・影・写真の扱いは `docs/REDESIGN_INSTRUCTIONS_UI.md` の要件に沿っている。

---

## 0. まず知っておくこと

- **色・余白・角丸・影・動きは `src/index.css` のトークンで決まる。** 個別の画面で
  色を直に書かない（ダークテーマが崩れる）。
- **ライトの背景は白。** 要件定義書は「純白にしない（ウォームアイボリー）」だが、
  依頼で白にしている。温度感は枠線・沈んだ面・文字のグレーの暖色で持たせているので、
  そこを純グレーに直すと写真とネイビーだけが浮く。
- **写真は `src/assets/photos.ts` が唯一の入口。** いま入っているのはレイアウト確認用の
  仮素材（ウォームグラデーションのSVG）で、実写に差し替えるときもここだけを直す。
- **写真の上に文字を置くときは必ず `--photo-scrim` を敷く。** 素材を明るいものに
  差し替えた瞬間に白文字が読めなくなるのを防ぐため。

---

## 1. 画面の骨格

DOMの並び順は `src/App.tsx` の JSX がそのまま。上から下へ:

```
.app-shell                      App.tsx:202 / App.css:5
├─ .update-banner               UpdateBanner.tsx  … 画面最上部に固定で降ってくる
├─ .app-header                  App.tsx:205 / App.css:13
│   ├─ .app-header__logo        左端。ホームへ戻る唯一の入口
│   ├─ .app-header__search      PC(≥1024px)だけ表示。中央寄せ
│   └─ .app-header__avatar      右端。設定へ
├─ .app-body                    App.css:94   … 中央寄せの外枠（max-width 1320px）
│   ├─ .side-nav                App.css:103  … PCのみ・左220px
│   └─ .main-content            App.css:145  … 各画面の中身
│       └─ .app-footer          App.css:155  … 本文の最後にぶら下がる
└─ .bottom-nav                  App.css:168  … 狭い画面のみ・下端固定（72px＋安全領域）
```

位置を決めている主な指定:

| 要素 | 位置の決まり方 | 場所 |
| --- | --- | --- |
| `.app-header` | `position: sticky; top: 0; z-index: 40` | App.css:13 |
| `.app-header__logo` | `margin-right: auto` で左端に寄せ、以降を右へ押す | App.css:28 |
| `.app-header__search` | `flex: 1 / max-width: 460px / margin: 0 auto` で中央 | App.css:41 |
| `.app-body` | `max-width: 1320px; margin: 0 auto` の中で横並び | App.css:94 |
| `.side-nav` | `width: 220px` 固定 + `position: sticky; top: 68px` | App.css:103 |
| `.main-content` | `flex: 1` で残り全部 | App.css:145 |
| `.bottom-nav` | `position: fixed; bottom: 0; z-index: 70` | App.css:168 |
| 下部バーのぶんの余白 | `.app-shell { padding-bottom: 96px + safe-bottom }`（バー72px＋24px） | App.css:5 |
| `.bottom-nav__fab`（中央の＋） | 下部バーの3番目の子。56px・`margin-top: -12px` で浮かせる | App.tsx:385 / App.css:218 |

**ナビの項目そのものを増減・並べ替えるのは CSS ではなく `src/App.tsx` の
`BOTTOM_NAV`(34行目) と `SIDE_NAV`(42行目) の配列。** 順番＝表示順。
中央の＋はナビ項目ではなく操作なので配列には入っていない（App.tsx:33 のコメント）。

---

## 2. 折り返し（ブレークポイント）

| 幅 | 起きること | 場所 |
| --- | --- | --- |
| `≤380px` | 統計の文字だけ小さくする | App.css:3234 |
| `≤640px` | ヘッダー・本文の余白を詰める / サマリを3列×2段に / フォロー整理のツールバーを2行の横スクロールに | App.css:3100 |
| `≥768px` | （現在は特になし。ヘッダーの補助表示用に残している枠） | App.css:1654 |
| `≤1023px` | 本文を780px幅で中央寄せ / **確認カードが一覧の上に全画面で被さる** / 日付ストリップを出す | App.css:1660 |
| `≥1024px` | 下部バーを消して左サイドバーを出す / ヘッダー検索を出す / **確認カードが右カラム（sticky, 340px）に常駐** / 一覧以外の画面を720px幅で止める | App.css:1699 |
| `≥900px`（コンポーザーのみ） | 下から出るシートを画面中央のダイアログに変える | App.css:2498 |

「PC / モバイル」の境目は **1024px** ひとつだけ、と考えてよい。
モバイルは 320〜480px で崩れないことを前提に組んである（横スクロールを作らない）。

---

## 3. 重なり順（z-index）

上にあるものほど手前。位置を動かすときは、この順番も一緒に見る。

| z-index | 要素 | 場所 |
| --- | --- | --- |
| 200 | `.update-banner`（アップデート通知） | App.css:2200 付近 |
| 150 | `.composer-sheet`（投稿作成シート＋カバー写真） | App.css:2328 |
| 90 | 狭い画面の確認カード全画面表示 | App.css:1669 |
| 70 | `.bottom-nav` | App.css:168 |
| 40 | `.app-header` | App.css:13 |
| 1 | Heroに重ねるカード（`.home-top > .surface-card`） | App.css:882 |

`.side-nav`(top:68px) と PC の確認カード(`top: 86px`) は、ヘッダーの高さを見込んだ
数字が直接書いてある。**ヘッダーの高さを変えるならこの2つも一緒に直す**
（ずらすとヘッダーの下に潜り込む・不自然に空く）。

---

## 4. 共通パーツ

| パーツ | 何者か | 場所 |
| --- | --- | --- |
| `.surface-card` | 白いカード。角丸20px・細い枠・柔らかい影 | App.css:448 |
| `PhotoHero` / `.photo-hero` | 写真＋scrim＋見出し＋CTA。`compact` で低い帯になる | PhotoHero.tsx / App.css:468, 482 |
| `.trust-label` | 写真の上に置く小さな信頼ラベル（端末内で解析 など） | App.css:551 付近 |
| `.link-list` / `.link-row` | カードの中に積む「行としてのリンク」 | App.css:591, 597 |
| `.btn--primary` | 主要CTA。インクネイビー | App.css:299 |
| `.btn--sage` | 「残す」専用。一覧のバッジと同じセージ | App.css:313 |
| `.btn--on-photo` | 写真の上に置く白いボタン。**テーマに関係なく白のまま** | App.css:386 |
| `.empty-state` | 空の状態。理由＋次にできることの2行で置く | App.css:681 |
| `.status-badge--protected` | 残す＝セージ、解除済み＝控えめなグレー | App.css:1300 付近 |

---

## 5. 画面ごとの中身の並び

### ホーム（`tab === 'home'`）

`src/components/HomeView.tsx`。**未読込でも表示する**（読み込み導線がHeroの主役）。

1. `.home-top`（App.css:872）… gapを持たない箱。この中で2枚が重なる
   - `PhotoHero`（気になる人だけ、残そう。）＋ CTA
     - 未読込・読み込み失敗: `FileDropZone variant="button"`（写真の上の白いボタン）
     - 読込済み: 「次の◯人を確認 / 続きから」
   - `.home-metrics`（読込済み）または `.home-empty`（未読込）… `margin-top: -34px` で
     Heroに重ねる。Hero側は `.home-top .photo-hero__body { padding-bottom: 46px }` で
     文字が隠れないよう下を空けている（App.css:876）
2. `.home-search`（App.css:895 付近）
3. `.home-cards` … `.entry-card` 2枚（未確認 / 残す） App.css:957
4. 予約投稿の `.link-list` … 予約した投稿を見る / AIで下書きを作る
5. `.task-list`（今日のタスク） App.css:1005
6. 最近のうごき（`HistoryView` を limit=5 で埋め込み）

### フォロー整理 / 残すリスト（`tab === 'tidy' | 'protected'`）

`src/components/FollowTidyView.tsx`。上から:

1. `PhotoHero compact`（写真の帯に見出しと未確認件数を重ねる）
2. `.tidy-view__search`（狭い画面のみ。PCはヘッダーの検索を使う）
3. `.tidy-toolbar`（App.css:1124）
   - 左: `.filter-bar__tabs`（すべて/未確認/残す） `.filter-tab` App.css:1154
   - 右: `.tidy-toolbar__end` … バッチ人数 / 次のN人を選択 / CSV書き出し
     （≤640pxでは横スクロールの1行になる）
4. `.tidy-layout`（App.css:1223）
   - `.tidy-layout__list` … `.account-table`(1242) の中に `.account-row`(1248) が
     **1件1カード**で並ぶ
   - `.tidy-layout__detail` … `.review-panel`（App.css:1364）
     - **≤1023px**: 全画面で被せる / **≥1024px**: 右カラムに sticky・幅340px

### 履歴

`.timeline`（App.css:1485）。点は `position: absolute` で左の縦線に乗せている。

### 予約投稿（`tab === 'schedule'`）

`src/components/schedule/ScheduleView.tsx`。`.schedule-view`(1766) が縦並び。

1. `XConnectCard`（連携状態）
2. `.stat-hero`(1901) … **濃紺のサマリーカード**（予約中N件 / 次の投稿）＋ `.stat-grid`(1960)
3. `.schedule-view__toolbar`（投稿を作る / 再読み込み / ログアウト）
4. `.post-list` … `.post-item`(2865)
   - これから出すもの（予約中・処理中・下書き）は `.post-item--photo`(2905) で
     写真の面になる。色味は `--tone-0..2` を index で回す（ScheduledPostList.tsx）
   - 投稿済み・失敗は落ち着いた面のまま（本文と理由を読ませたいので写真にしない）

### 新しい投稿（`ComposerSheet`）

`.composer-sheet`(2328) の中で:

- `.composer-sheet__cover`(2344) … 背後のカバー写真。上に×と「新しい投稿」を重ねる
- `.composer-sheet__panel`(2411) … 白いシート（上角28px、最大82dvh）。
  中身は `PostComposer variant="sheet"`。**シート版は見出しを描かない**
  （カバー側に出しているので、両方描くと同じものが2つ並ぶ）

### 設定 / 読み込み前

`.settings-section`(1557)。見出しにアイコン、長い説明は `.settings-details` に畳む。
読み込み前の案内は `.onboarding`(771) ＋ `.file-drop`(793)。

---

## 6. 現状を撮って見比べる

```bash
npm run build
npm run preview -- --port 4173 --strictPort   # 別ターミナルで動かしておく

npm run design:shots                                      # .design-shots/ に保存
node scripts/design-shots.mjs --out .design-shots/after    # 変更後を別名で
node scripts/design-shots.mjs --screens home --viewports mobile   # 一部だけ撮り直す
```

- PC(1440) / タブレット(900) / モバイル(390) × ライト・ダーク × 各画面。
- 1画面につき2枚。`◯◯.png` が画面ぴったり、`◯◯-full.png` が下まで伸ばしたもの。
  **位置の判断はぴったりの方でする**（`-full` は固定表示の下部バーがページの
  途中に写り込むので、実際の見え方とは違う）。
- Playwright同梱のブラウザが無い環境では `CHROMIUM_PATH=/path/to/chromium` を付ける
  （`npm run test:e2e` も同じ環境変数を見る）。
- `.design-shots/` はコミットしない（`.gitignore` 済み）。

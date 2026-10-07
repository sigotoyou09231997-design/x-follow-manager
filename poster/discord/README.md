# ディスコード自動投稿（poster/discord）

discord-ch.site の「掲示板に募集する」へ、文を順番に回して投稿する。
画面を見張って、「投稿可能まであと○分○秒」が「今すぐ投稿できます」に変わった瞬間に投稿 →
`/create` に戻る → 次の合図を見張る、の繰り返し（時間では待たず、表示で動く）。

> 2026-10-07 に、`discord-ch自動投稿/` と `yay自動投稿/` と X フォロー整理ツールを **このアプリ（SNSアプリ）の1つのフォルダ** にまとめた。
> 投稿役のコードは `poster/discord` と `poster/yay`、文を変える画面はアプリの「自動投稿」タブ。
> 全体の説明は `../README.md`。

```
bash launchd.sh install              # 投稿し続ける。Mac にログインすると自動で始まり、Claude アプリを再起動しても止まらない
bash launchd.sh status | restart | uninstall
node post.mjs                        # 手で直接起動（launchd と二重にはならない。2つ目は「すでに動いています」で終わる）
node post.mjs --max 1                # 1回だけ
node post.mjs --dry                  # 合図を待って文を入れるだけ（送信しない）
touch STOP                           # 止める（作ったままなら、次のログインでも止まったまま。再開は bash launchd.sh restart）
```

`config.json`（手元だけ・コミットしない）は `config.example.json` をコピーして作る。

## 投稿する文を画面で変える

アプリの **「自動投稿」タブ**（https://x-follow-manager-wine.vercel.app）で、Google ログインして文を直して「保存する」（Cmd/Ctrl+S でも）。
外出先のスマホからでも同じ。**次の投稿から**新しい文になる（止めたり再起動したりは要らない）。
上の **「ディスコード / Yay」** で投稿先を切り替える。差し替えた前の文は「これまでの文」に残り、「この文にする」で呼び戻せる。
文は1つ最大1000文字、最大10個まで。空の文は保存できない。2か所で同時に開いて先に片方で保存すると、もう片方は上書きせず知らせる。
画面の上に「Macは動いています（○分前に確認）・最後の投稿・今日の件数」が出る。20分以上報告が無いと「Macから応答がありません」になる。

```
画面（アプリの「自動投稿」タブ） ──(Google ログイン)──> api/autopost ──> Supabase の autopost_channels
                                                                  ↑ 投稿の直前に取る / 数分おきに報告
                                         Mac の post.mjs（cloud-client.mjs）──(合鍵)──> api/poster-text・poster-status
```

- 文の正は Supabase。投稿側は投稿の直前に取り、`config.json` にも控える。
  届かないときは、その控え（直前に使えた文）で続ける（`run.log` に1回だけ記録）
- `config.json` の `"cloud": { "url", "tokenFile" }` が接続先。`tokenFile` は合鍵のファイル名（このフォルダの `.hub-token`）。
  `cloud` を消すと、手元の `config.json` の文だけで動く
- Mac 用の合鍵は `.hub-token`（コミットしない）。画面のログインとは別物で、できるのは「文を読む・状態を報告する」だけ
  （文は書き換えられない）。Supabase には sha256 の値だけを置いている（`autopost_poster_keys`）
- 以前の編集画面（https://ch-post-editor.vercel.app 、別リポジトリ discord-ch-auto-post の `cloud/`）は、切り替えの控えとして当面残してある。
  戻したいときは `config.json` の `cloud` を `{ "url": "https://ch-post-editor.vercel.app" }` に戻して再起動する（合鍵は旧 `.cloud-token`）

## 設定・運用

- 動いているかは `bash launchd.sh status`（`pgrep "node post.mjs"` では見つからない。launchd 起動は node のフルパスで動くため）。
  launchd は Desktop の中を開けないので、標準出力のログは `~/Library/Logs/local.discord-ch-auto-post.log`（詳しくは `launchd.sh` の冒頭）
- 専用の Chrome（`chrome-profile/`）を使う。窓は開いたままにしておく。無ければ自動で起動する
- Discord へのログインは、その Chrome 窓で手で一度だけ
- 設定は `config.json`
  - `messages` … 回す文
  - `minGapSeconds` … 前回から最短何秒あけるか。表示の読み違いで連投しないための保険（サイトの冷却は10分）
  - `rewatchSeconds` … 表示が変わらないまま何秒たったら読み直すか（見張りが止まっていた場合の保険）
  - `tokenMaxAgeSeconds` … 読み込みから何秒たつと Cloudflare の認証の値が古いとみなすか。超えていたら読み直してから投稿する
  - `dailyCap` … 1日の上限（null で無制限）
- 記録は `logs/`（`posted.log` が投稿の履歴、`run.log` が動作の記録）。`chrome-profile/` にはログイン情報が入るのでコミットしない
- 次に回す文の位置は `logs/state.json`。再開すると続きから回る
- 投稿の成功は、画面に「投稿が成功しました」が出たことで確かめる
- ログイン切れ・HTTP 403/429・3回続けての失敗では、通知を出して止まる
- `post.mjs` を直したときの入れ替えは、`run.log` の最終行が「見張り中」で、次の合図まで90秒以上ある待機中に行う
  （`touch STOP` → 次の投稿のあとに止まる → `bash launchd.sh restart`。投稿の最中に殺すと `state.json` と `posted.log` が食い違う）

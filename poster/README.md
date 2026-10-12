# poster/ — Mac で動く投稿役

「自動投稿」タブで決めた文を、実際に投稿する側。Chrome を操作する必要があるため Vercel では動かせず、**この Mac で動き続ける**。

| 場所 | 投稿先 | 間隔 | 詳しく |
| --- | --- | --- | --- |
| `discord/` | discord-ch.site の募集掲示板（＋ `config.json` で有効にしたとき、同じ文を eroype.net にも一緒に投稿） | 画面の「今すぐ投稿できます」が出るたび（約10分） | `discord/README.md` |
| `yay/` | Yay のタイムライン＋参加中のサークル全部（「ショタ」「ロリ」を含む名前は除く） | 5分 | `yay/README.md` |

```
アプリの「自動投稿」タブ ──> api/autopost ──> Supabase（autopost_channels）
                                                     ↑ 投稿の直前に文を取る / 数分おきに「動いています」を報告
                          Mac の投稿役（launchd で常駐）──> api/poster-text・poster-status（合鍵）
```

## 動かし方（どちらも同じ）

```
cd poster/discord        # または poster/yay
bash launchd.sh install  # Mac にログインすると自動で始まる
bash launchd.sh status   # state = running なら動いている
bash launchd.sh restart  # 止めたあとの再開
touch STOP               # 止める（作ったままなら次のログインでも止まったまま）
```

- 各フォルダの `config.json`（手元だけ）は `config.example.json` をコピーして作る

## 止める（2通り）

| やり方 | 何が起きるか | 再開 |
| --- | --- | --- |
| アプリの「自動投稿」タブの **投稿を止める** | 投稿役は**動いたまま**、投稿だけを見合わせる（投稿先ごと。外出先のスマホからも押せる） | 同じ画面の「投稿を再開する」 |
| `touch STOP` | 投稿役のプロセスごと終わる | Mac で `bash launchd.sh restart` |

- アプリから止めると、画面は「停止を依頼しました」→（投稿役が受け取ると）「停止中」と変わる。**「停止中」と出るまでは、止まったと思わない**
  （数十秒かかる。古い版の投稿役は止められないので、ずっと「依頼しました」のまま）
- 画面の状態が読めないとき（通信の失敗）は、最後に分かっていた状態のまま。止めたはずが、通信の失敗ひとつで再開しない。
  その状態は各フォルダの `logs/paused.json` に控えるので、Mac を再起動した直後に通信がつながっていなくても止めたまま始まる
- Yay は、止めても**いま出ている投稿は消えずに残る**（再開すると、最初の周回で前の投稿を消してから投稿する）。周回の途中で止めたら、そこで打ち切る
- 使うには、Supabase の SQL Editor で `supabase/sql/006_autopost_pause.sql` を実行する（表が無いあいだは、止めるボタンだけが「準備中」になる）。
  投稿役は、このコードの版へ**入れ替えて**（各フォルダの README にある入れ替えの手順）初めて止まるようになる
- 投稿役の入れ替えは、投稿の最中に殺さない。`touch STOP` → 止まるのを待つ → `bash launchd.sh restart`（詳しくは各 README）

テスト: `node --test poster/pause-state.test.mjs poster/discord/cloud-client.test.mjs poster/discord/eroype.test.mjs poster/yay/cloud.test.mjs poster/yay/targets.test.mjs`
- 合鍵は `discord/.hub-token`（Yay も同じものを探す）。Supabase の `autopost_poster_keys` に sha256 の値を入れてある
- `chrome-profile/`（Discord・Yay のログイン情報）・`logs/`・合鍵・`config.json` は、コミットしない（ルートの `.gitignore`）
- playwright は、このアプリの `node_modules` を使う（`npm install` 済みであること）
- launchd のラベルは `local.discord-ch-auto-post` / `local.yay-auto-post`（plist は `~/Library/LaunchAgents/`）。
  フォルダを動かしたら、それぞれ `bash launchd.sh install` をやり直す（plist に絶対パスを書くため）

## 止まったとき（スマホから再起動）

投稿役の報告が20分途絶えると、アプリを入れたスマホに通知が来る（アプリの設定で「この端末で通知を受け取る」を有効にしておく）。
通知を押すと自動投稿タブが開くので、「投稿役を再起動する」→「再起動する」。

- 受けるのは `remote/`（Mac で1分ごとに起動する小さな見張り。投稿役とは別なので、投稿役が死んでいても動く）。
  入れるのは **一度だけ**: `bash remote/launchd.sh install`（`status` / `uninstall` もある）
- 入れ替えるのは**止まっている投稿役だけ**（動いていない、または `logs/run.log` が15分動いていない）。動いているものには触らない
  （ディスコードは、投稿の最中に殺すと `state.json` と `posted.log` が食い違うため）。結果は画面に「Yay: 止まっていたので再起動しました / …」と出る
- **STOP ファイルがある投稿役は触らない**（わざと止めているのを、スマホの1回の操作で外さない）。画面に「STOP ファイルがあるので止めたままです」と出る
- Mac 本体は再起動しない。FileVault が有効で自動ログインが無いので、本体を再起動すると Mac の前でパスワードを打つまで投稿役が全部止まる
- 30分以上前の依頼は実行しない（Mac が寝ていた間の昔の依頼が、戻ってきた途端に動かないように）
- 動作確認: `POSTER_REMOTE_DRY=1 POSTER_REMOTE_URL=http://127.0.0.1:ポート node remote/remote.mjs`（手元の偽サーバーにつなぎ、入れ替えは「確認のみ」）
- 使うには、Supabase の SQL Editor で `supabase/sql/008_autopost_restart.sql` を実行する（表が無いあいだは、再起動のカードだけが「準備中」になる）

## 関連（このアプリの外）

- 以前の編集画面 https://ch-post-editor.vercel.app は、戻せるように残してある（別リポジトリ discord-ch-auto-post の `cloud/`）。
  使わなくなったら Vercel のプロジェクト `ch-post-editor` を消してよい
- 統合前のフォルダ（`discord-ch自動投稿`・`yay自動投稿`）は `~/Documents/統合前の控え/` にある

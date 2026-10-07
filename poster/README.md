# poster/ — Mac で動く投稿役

「自動投稿」タブで決めた文を、実際に投稿する側。Chrome を操作する必要があるため Vercel では動かせず、**この Mac で動き続ける**。

| 場所 | 投稿先 | 間隔 | 詳しく |
| --- | --- | --- | --- |
| `discord/` | discord-ch.site の募集掲示板 | 画面の「今すぐ投稿できます」が出るたび（約10分） | `discord/README.md` |
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
- 合鍵は `discord/.hub-token`（Yay も同じものを探す）。Supabase の `autopost_poster_keys` に sha256 の値を入れてある
- `chrome-profile/`（Discord・Yay のログイン情報）・`logs/`・合鍵・`config.json` は、コミットしない（ルートの `.gitignore`）
- playwright は、このアプリの `node_modules` を使う（`npm install` 済みであること）
- launchd のラベルは `local.discord-ch-auto-post` / `local.yay-auto-post`（plist は `~/Library/LaunchAgents/`）。
  フォルダを動かしたら、それぞれ `bash launchd.sh install` をやり直す（plist に絶対パスを書くため）

## 関連（このアプリの外）

- 以前の編集画面 https://ch-post-editor.vercel.app は、戻せるように残してある（別リポジトリ discord-ch-auto-post の `cloud/`）。
  使わなくなったら Vercel のプロジェクト `ch-post-editor` を消してよい
- 統合前のフォルダ（`discord-ch自動投稿`・`yay自動投稿`）は `~/Documents/統合前の控え/` にある

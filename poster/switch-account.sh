#!/bin/bash
# 自動投稿のアカウントを入れ替えるときの準備（コードや設定は書き換えない）。
#   bash switch-account.sh yay        … Yay のアカウントを替える
#   bash switch-account.sh discord    … 掲示板(discord-ch.site)・eroype・ディス速のアカウントを替える
#   bash switch-account.sh all        … 両方
# やること: ①投稿を止める ②前のアカウントの「消すための控え」を取り分ける（消さない）
#           ③専用 Chrome をログイン用に開く。あとはあなたが、前のアカウントをログアウトして新しいアカウントでログインし、
#           最後に bash <yay か discord>/launchd.sh restart で再開する。ログインの入力は私は触らない。
# Yay は、起動のたびに「いまのアカウント番号」を見て、替わっていれば控えを自動で取り分ける（account-guard.mjs）ので、
# ②は保険。入れ替えたあとの投稿先は「auto」なら、新しいアカウントが参加しているサークルを自動で選び直す。
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
STAMP="$(date +%Y%m%d-%H%M%S)"
which="${1:-}"
case "$which" in yay | discord | all) ;; *) echo "使い方: bash switch-account.sh yay|discord|all"; exit 1 ;; esac

bash "$HERE/stop-all.sh" >/dev/null
echo "投稿を止めました（STOP を置きました）"

open_chrome() { # ポート プロファイル URL...
  local port="$1" profile="$2"; shift 2
  nohup "$CHROME" "--remote-debugging-port=$port" "--user-data-dir=$profile" --no-first-run --no-default-browser-check "$@" >/dev/null 2>&1 &
}

if [ "$which" = yay ] || [ "$which" = all ]; then
  # 控えは取り分けるだけ（消さない）。戻したいときは名前を posted.jsonl に戻す
  [ -f "$HERE/yay/logs/posted.jsonl" ] && mv "$HERE/yay/logs/posted.jsonl" "$HERE/yay/logs/posted-before-switch-$STAMP.jsonl" && echo "Yay の控えを取り分けました: posted-before-switch-$STAMP.jsonl"
  rm -f "$HERE/yay/logs/account.json"
  open_chrome 9334 "$HERE/yay/chrome-profile" https://yay.space/
  echo "Yay: 開いた Chrome で、前のアカウントをログアウト → 新しいアカウントでログイン → bash $HERE/yay/launchd.sh restart"
fi

if [ "$which" = discord ] || [ "$which" = all ]; then
  [ -f "$HERE/discord/logs/eroype-posts.json" ] && mv "$HERE/discord/logs/eroype-posts.json" "$HERE/discord/logs/eroype-posts-before-switch-$STAMP.json" && echo "eroype の控えを取り分けました"
  open_chrome 9333 "$HERE/discord/chrome-profile" https://discord-ch.site/create https://eroype.net/create https://dissoku.net/ja/mypage/profile
  echo "掲示板・eroype・ディス速: 開いた Chrome で、必要なサイトだけ、前のアカウントをログアウト → 新しいアカウントでログイン → bash $HERE/discord/launchd.sh restart"
  echo "  ※ディス速は、募集のタグ・メッセージが新しいアカウントでは空です。タグ（1つ以上）を先に入れて保存してください（投稿役はタグに触りません）"
fi

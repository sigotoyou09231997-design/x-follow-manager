#!/bin/bash
# Mac を再起動する前に、自動投稿を全部いますぐ止める（投稿役・専用 Chrome ごと終わらせる）。
#   bash stop-all.sh
# STOP を置くので、止めたあとは自動で再開しない。再開は discord・yay それぞれで bash launchd.sh restart。
# 投稿の最中に殺すこともある（discord は state.json と posted.log が食い違うことがある）。急がないときは STOP だけ置いて待つ。
HERE="$(cd "$(dirname "$0")" && pwd)"
for d in discord yay; do
  touch "$HERE/$d/STOP"
  [ -f "$HERE/$d/logs/post.pid" ] && kill -TERM "$(cat "$HERE/$d/logs/post.pid")" 2>/dev/null
  [ -f "$HERE/$d/logs/run.pid" ] && kill -TERM "$(cat "$HERE/$d/logs/run.pid")" 2>/dev/null
done
pkill -TERM -f "post.mjs|poster/yay/run.mjs" 2>/dev/null
# 専用プロファイルの Chrome（再起動を邪魔する）。ふだんの Chrome には触らない
pkill -TERM -f "user-data-dir=.*/poster/(discord|yay)/chrome-profile" 2>/dev/null
sleep 2
pkill -KILL -f "user-data-dir=.*/poster/(discord|yay)/chrome-profile" 2>/dev/null
echo "止めました（STOP を置きました）。Mac を再起動できます。"

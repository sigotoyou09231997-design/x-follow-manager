#!/bin/bash
# Yay自動投稿の自動起動（launchd）。Mac にログインすると自動で始まり、Claude アプリを再起動しても止まらない。
#   bash launchd.sh install     … 自動起動を入れて、いま始める
#   bash launchd.sh uninstall   … 自動起動を外して、止める
#   bash launchd.sh status      … 動いているか
#   bash launchd.sh restart     … STOP を消して、始め直す（止めたあとの再開）
# 止めるとき: このフォルダに STOP という名前のファイルを作る（作ったままなら、次のログインでも止まったまま）。
#
# 作りの注意:
#   ・launchd から起動した「sh」や「ls」は Desktop の中を読めない（macOS のプライバシー保護）が、node を直接起動すれば読める。
#     なので ProgramArguments は node を直接指す（caffeinate は道具自身が子プロセスとして付ける）
#   ・launchd 自身も Desktop の中は開けない（EX_CONFIG: 78 で起動に失敗する）ので、WorkingDirectory は指定せず、
#     標準出力のログは ~/Library/Logs/<ラベル>.log に出す（道具自身の記録は、これまでどおり logs/run.log）
#   ・KeepAlive は Crashed のみ。制限(403/429)・ログイン切れ・連続失敗で道具が自分で止まったときは、再起動しない（安全装置を打ち消さない）
#   ・node のパスは、入れたときの `command -v node` を書き込む。node のバージョンを上げたら、もう一度 install する
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
LABEL="local.yay-auto-post"
SCRIPT="run.mjs"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

case "${1:-status}" in
  install)
    NODE="$(command -v node)" || { echo "node が見つかりません"; exit 1; }
    mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs" "$HERE/logs"
    cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$HERE/$SCRIPT</string></array>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/$LABEL.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/$LABEL.log</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>Crashed</key><true/></dict>
  <key>ThrottleInterval</key><integer>60</integer>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>$(dirname "$NODE"):/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>HOME</key><string>$HOME</string>
  </dict>
</dict></plist>
PLISTEOF
    plutil -lint "$PLIST" >/dev/null
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    launchctl bootstrap "$DOMAIN" "$PLIST"
    echo "入れました: ${PLIST} (node: ${NODE})"
    ;;
  uninstall)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "外しました"
    ;;
  restart)
    rm -f "$HERE/STOP"
    if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then launchctl kickstart -k "$DOMAIN/$LABEL"; else launchctl bootstrap "$DOMAIN" "$PLIST"; fi
    echo "始め直しました"
    ;;
  status)
    if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
      launchctl print "$DOMAIN/$LABEL" | grep -E "^\s*(state|pid|last exit code|runs) =" | sed 's/^\s*/  /'
      [ -e "$HERE/STOP" ] && echo "  ※ STOP ファイルがあるので、止まったままです"
    else
      echo "入っていません（bash launchd.sh install）"
    fi
    ;;
  *) echo "使い方: bash launchd.sh install | uninstall | status | restart"; exit 1 ;;
esac

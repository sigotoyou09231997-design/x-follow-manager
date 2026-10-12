#!/bin/bash
# スマホからの「投稿役を再起動する」を受ける見張り（remote.mjs）を、1分ごとに起動する自動起動（launchd）。
#   bash launchd.sh install     … 自動起動を入れて、いま始める
#   bash launchd.sh uninstall   … 自動起動を外す
#   bash launchd.sh status      … 入っているか
#
# 作りの注意（yay/launchd.sh・discord/launchd.sh と同じ）:
#   ・ProgramArguments は node を直接指す（launchd から起動した sh は Desktop の中を読めないため）
#   ・WorkingDirectory は指定しない。出力は ~/Library/Logs/<ラベル>.log（依頼を処理したときだけ書く）
#   ・常駐ではなく StartInterval（60秒ごとに起動して、依頼を見て、終わる）。KeepAlive は付けない
#   ・node のパスは、入れたときの `command -v node` を書き込む。node のバージョンを上げたら、もう一度 install する
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
LABEL="local.poster-remote"
SCRIPT="remote.mjs"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

case "${1:-status}" in
  install)
    NODE="$(command -v node)" || { echo "node が見つかりません"; exit 1; }
    mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
    cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$HERE/$SCRIPT</string></array>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/$LABEL.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/$LABEL.log</string>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>60</integer>
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
  status)
    if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
      echo "入っています（1分ごとに依頼を見に行きます）"
      launchctl print "$DOMAIN/$LABEL" | grep -E "^\s*(state|runs|last exit code) =" | sed 's/^\s*/  /'
    else
      echo "入っていません（bash launchd.sh install）"
    fi
    ;;
  *) echo "使い方: bash launchd.sh install | uninstall | status"; exit 1 ;;
esac

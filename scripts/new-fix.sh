#!/usr/bin/env bash
# 修正用の作業場所(git worktree)を1コマンドで作る。
#
#   bash scripts/new-fix.sh <名前>        → 作業場所のパスを最後の行に出す(ブランチ名は fix/<名前>)
#
# 別の作業場所で作業するのは、(1) Cowork の裏実行が同じフォルダで走って作業中のファイルを書き換えるのと、
# (2) 本体のフォルダには poster/ の作業途中の変更が溜まりがちで、それを巻き込んでコミットしてしまうのを避けるため。
# node_modules と .env は本体のものを指す(入れ直さない)。
# 出す時は、その作業場所の中で `bash scripts/ship.sh "<統合のメッセージ>"`。
set -euo pipefail

NAME="${1:?名前を付けてください(例: bash scripts/new-fix.sh yay-timeout)}"
MAIN_DIR="$(cd "$(dirname "$(git rev-parse --git-common-dir)")" && pwd)"
SP="${FIX_WORKTREE_ROOT:-${TMPDIR:-/tmp}/sns-fixes}"
DIR="$SP/$NAME"
BRANCH="fix/$NAME"

# 手元の main が公開の main より遅れていると、古いコードの上に直すことになる(ship.sh も止まる)。作る前に知らせる。
# 先に進んでいるだけ(Cowork の裏実行が push できずに残したコミット)なら問題ない。ship.sh が確認に含めて一緒に出す。
REMOTE_MAIN="$(git ls-remote origin refs/heads/main 2>/dev/null | cut -f1 || true)"
LOCAL_MAIN="$(git -C "$MAIN_DIR" rev-parse main)"
if [ -n "$REMOTE_MAIN" ] && [ "$LOCAL_MAIN" != "$REMOTE_MAIN" ]; then
  if git -C "$MAIN_DIR" cat-file -e "$REMOTE_MAIN^{commit}" 2>/dev/null && git -C "$MAIN_DIR" merge-base --is-ancestor "$REMOTE_MAIN" "$LOCAL_MAIN"; then
    echo "ℹ 手元の main は公開より $(git -C "$MAIN_DIR" rev-list --count "$REMOTE_MAIN..$LOCAL_MAIN") コミット先行しています(push できずに残ったもの)。ship.sh が一緒に出します" >&2
  else
    echo "⚠ 手元の main(${LOCAL_MAIN:0:7})が公開の main(${REMOTE_MAIN:0:7})の先ではありません。先に手元を進めてください" >&2
  fi
fi

mkdir -p "$SP"
git -C "$MAIN_DIR" worktree add -q -b "$BRANCH" "$DIR" main
ln -s "$MAIN_DIR/node_modules" "$DIR/node_modules"
for f in .env .env.local; do
  if [ -e "$MAIN_DIR/$f" ]; then ln -s "$MAIN_DIR/$f" "$DIR/$f"; fi
done
echo "$DIR"

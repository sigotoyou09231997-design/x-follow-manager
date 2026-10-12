#!/usr/bin/env bash
# 修正を本番に出すまでを1コマンドで行う(作業場所の中で、変更をコミットしたあとに)。
#
#   bash scripts/ship.sh "<何を直したか>" [--from <依頼が来た時刻 epoch 秒>] [--skip-e2e] [--keep] [--dry-run]
#
# やること(CLAUDE.md の「反映する前に必ず通すもの」と同じ条件に、2つ足してある。1つでも落ちたら main に入れずに止まる):
#   1. 手元の main が公開の main と同じか確かめる。公開より「先に進んでいるだけ」(Cowork の裏実行が push できずに残したコミット)
#      なら、その先行分も確認に含めて一緒に出す。公開のほうが進んでいる・枝分かれなら止まる。ブランチが main に追いついていなければ main を取り込む
#   2. 型・lint・ユニット・poster のテスト・サーバー関数の読み込み・本番ビルドを**同時に**走らせる → 通ったら E2E
#        足した2つ:
#        - poster のテスト(node --test)。`npm test` には入っていない。poster/ を直しても今まで誰も走らせていなかった
#        - サーバー関数の読み込み(npm run check:api)。拡張子 .js の付け忘れは型・テストで見えず、本番だけ壊れる(2026-10-10)
#   3. dist-artifact を作り直す。差分が出たら自動でコミットする(src を触ったあとに作り直し忘れるのを防ぐ)
#   4. main へ統合 → main をプッシュ(強制プッシュはしない)。作業ブランチは**プッシュしない**:
#      プッシュするたびに Vercel の待ち行列に1件入り、本番のビルドを待たせるため(vercel.json で main 以外は作らない)
#   5. 手元の main を進める
#   6. Vercel が公開するのを待つ(/version.json)
#   7. 公開した版の全受け口を、鍵なしで叩いて 500 が無いか見る(読み込みの失敗は 500 で出る)
#   8. 作業場所を片付ける(--keep で残す)。所要時間を .fix-times.log(git に入れない)に残す
set -euo pipefail

MSG="${1:?何を直したか(統合のメッセージ)を渡してください}"
shift || true
SKIP_E2E=0; KEEP=0; DRY=0; FROM_EPOCH=""
while [ $# -gt 0 ]; do
  case "$1" in
    --from) FROM_EPOCH="${2:?--from の後に、依頼が来た時刻(epoch 秒。date +%s)}"; shift 2 ;;
    --skip-e2e) SKIP_E2E=1; shift ;;
    --keep) KEEP=1; shift ;;
    --dry-run) DRY=1; shift ;;
    *) echo "知らない指定です: $1" >&2; exit 2 ;;
  esac
done

START=$SECONDS
E_START=$(date +%s)
die() { echo "✗ $*" >&2; exit 1; }
step() { echo "▶ $*  (+$((SECONDS - START))秒)"; }

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$BRANCH" != "HEAD" ] && [ "$BRANCH" != "main" ] || die "作業ブランチの中で実行してください(いまは $BRANCH)"
WT="$(git rev-parse --show-toplevel)"
MAIN_DIR="$(cd "$(dirname "$(git rev-parse --git-common-dir)")" && pwd)"
cd "$WT"   # 相対パス(poster/・api/・dist-artifact)を使うので、作業場所の直下に固定する
SITE_URL="${SHIP_SITE_URL:-https://x-follow-manager-wine.vercel.app}"
COAUTHOR="${SHIP_COAUTHOR:-Claude Sonnet 5.5 <noreply@anthropic.com>}"

[ -z "$(git status --porcelain --untracked-files=no)" ] || die "コミットされていない変更があります。先にコミットしてください"

step "1/7 公開の main と手元の main を見比べる"
REMOTE_MAIN="$(git ls-remote origin refs/heads/main 2>/dev/null | cut -f1)"
[ -n "$REMOTE_MAIN" ] || die "公開の main を読めませんでした(通信を確かめてください)"
LOCAL_MAIN="$(git rev-parse main)"
if [ "$LOCAL_MAIN" != "$REMOTE_MAIN" ]; then
  # 手元が公開より「先に進んでいるだけ」(公開の main が手元の祖先)なら止めない。Cowork の裏実行は、ネットワークの許可が
  # 無くて push できず、コミットだけを手元の main に残す。それを毎回手で出し直すのでは遅いので、この作業の確認に含めて
  # 一緒に出す(確認は作業場所の中で、先行分も含めて走る)。公開のほうが進んでいる・枝分かれしているときは止まる。
  if git cat-file -e "$REMOTE_MAIN^{commit}" 2>/dev/null && git merge-base --is-ancestor "$REMOTE_MAIN" "$LOCAL_MAIN"; then
    echo "   手元の main は公開より $(git rev-list --count "$REMOTE_MAIN..$LOCAL_MAIN") コミット先行しています(push できずに残ったもの)。確認に含めて、一緒に出します:"
    git log --format='     %h %s' "$REMOTE_MAIN..$LOCAL_MAIN" | cut -c1-110
  else
    die "手元の main($(git rev-parse --short main))が公開の main(${REMOTE_MAIN:0:7})の先ではありません(公開のほうが進んでいる、または枝分かれ)。手元の main を進めてから"
  fi
fi
git merge-base --is-ancestor main HEAD || { step "ブランチが main に追いついていないので、main を取り込む"; git merge -q --no-edit main || die "main の取り込みで衝突しました"; }

step "2/7 型・lint・テスト・サーバー関数の読み込み・ビルドを同時に走らせる"
LOG_DIR="$(mktemp -d)"
# 同時に走らせる ship.sh は1つだけにする。Mac では自動投稿(launchd)も動いていて、作業用プロセスが重なると
# 投稿役まで遅れる(todoアプリで 2026-10-12 に実際に起きた)。順番待ちの札は、10分たったら古いものとして捨てる
# (落ちた実行の札が残っても詰まらないように)。
LOCK_DIR="${TMPDIR:-/tmp}/sns-ship-tests.lock"
waited=0
until mkdir "$LOCK_DIR" 2>/dev/null; do
  if [ -n "$(find "$LOCK_DIR" -maxdepth 0 -mmin +10 2>/dev/null)" ]; then rmdir "$LOCK_DIR" 2>/dev/null || true; continue; fi
  [ "$waited" -eq 0 ] && echo "   (ほかの ship.sh がテスト中です。終わるのを待ちます)"
  waited=1; sleep 3
done
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

NAMES=(); PIDS=()
spawn() { local name="$1"; shift; "$@" >"$LOG_DIR/$name.log" 2>&1 & NAMES+=("$name"); PIDS+=("$!"); }
# tsc -b は前回の記録(node_modules/.tmp。作業場所どうしで共有している)を信じて飛ばすことがあるので、--force で毎回見直す
spawn 型 npx tsc -b --force
spawn lint npx oxlint
spawn ユニット npx vitest run
spawn poster node --test $(find poster -name '*.test.mjs' -not -path '*/node_modules/*' | sort)
spawn サーバー関数 npm run check:api --silent
spawn ビルド npx vite build

FAILED=()
for i in "${!PIDS[@]}"; do
  wait "${PIDS[$i]}" || FAILED+=("${NAMES[$i]}")
done
grep -E "^ +(Test Files|Tests) " "$LOG_DIR/ユニット.log" || true
grep -E "^ℹ (tests|pass|fail) " "$LOG_DIR/poster.log" | tr '\n' ' ' | sed 's/^/poster: /; s/$/\n/' || true
if [ "${#FAILED[@]}" -gt 0 ]; then
  for name in "${FAILED[@]}"; do
    echo "---- 落ちた: $name (全文: $LOG_DIR/$name.log)"
    grep -E "FAIL|×|✖|NG |error TS|Error|AssertionError|not ok" "$LOG_DIR/$name.log" | head -15 || true
  done
  die "${FAILED[*]} が落ちました。main には入れていません"
fi

if [ "$SKIP_E2E" -eq 0 ]; then
  step "E2E(約6秒。CI=1 は、4173番に別のサーバーが居たら黙ってそれを使わず、落とすため)"
  CI=1 npx playwright test >"$LOG_DIR/e2e.log" 2>&1 || { tail -25 "$LOG_DIR/e2e.log"; die "E2E が落ちました(全文: $LOG_DIR/e2e.log)。main には入れていません"; }
  grep -E "^ +[0-9]+ passed" "$LOG_DIR/e2e.log" || true
else
  echo "(--skip-e2e) E2E は走らせていません。画面の導線を変えたなら外してください"
fi
rmdir "$LOCK_DIR" 2>/dev/null || true

step "3/7 dist-artifact を作り直す"
npm run build:artifact >"$LOG_DIR/artifact.log" 2>&1 || { tail -15 "$LOG_DIR/artifact.log"; die "build:artifact が落ちました。main には入れていません"; }
if [ -n "$(git status --porcelain dist-artifact)" ]; then
  git add dist-artifact
  git commit -q -m "dist-artifact を作り直す(src の変更に合わせて)

Co-Authored-By: $COAUTHOR"
  echo "   dist-artifact に差分が出たのでコミットしました"
fi
[ -z "$(git status --porcelain --untracked-files=no)" ] || { git status --short | head; die "確認の途中でコミットされていない変更ができました(上のファイル)。main には入れていません"; }
rm -rf "$LOG_DIR"
[ "$DRY" -eq 0 ] || { echo "(--dry-run) 確認がすべて通ったので、ここで止めます。main には入れていません"; exit 0; }

step "4/7 main へ統合してプッシュ"
git checkout -q --detach main
git merge -q --no-ff "$BRANCH" -m "Merge branch '$BRANCH': $MSG

Co-Authored-By: $COAUTHOR"
SHA="$(git rev-parse HEAD)"
if ! PUSH_OUT="$(git push origin HEAD:main 2>&1)"; then
  git checkout -q "$BRANCH"
  echo "$PUSH_OUT" | tail -5
  die "プッシュできませんでした(公開の main が先に進んだ可能性)。手元の main を進めてから、もう一度実行してください"
fi
echo "$PUSH_OUT" | tail -1
E_PUSHED=$(date +%s)

step "5/7 手元の main を進める"
git -C "$MAIN_DIR" merge -q --ff-only "$SHA" || die "手元の main を進められませんでした(公開はされています: ${SHA:0:7})。本体のフォルダの作業途中の変更と重なっていないか見てください"

step "6/7 Vercel が公開するのを待つ"
LIVE=0; DEADLINE=$((SECONDS + 600))
while [ "$SECONDS" -lt "$DEADLINE" ]; do
  V="$(curl -fsS --max-time 10 "$SITE_URL/version.json?t=$RANDOM" 2>/dev/null || true)"
  case "$V" in *"${SHA:0:7}"*) LIVE=1; break ;; esac
  sleep 4
done
E_LIVE=$(date +%s)
if [ "$LIVE" -eq 1 ]; then echo "✓ Vercel に出ました: ${SHA:0:7}"
else echo "✗ Vercel がまだ ${SHA:0:7} になっていません(10分待ちました)。Vercel の画面でデプロイの状態を見てください(受け口が13個以上・.js の付け忘れが過去の原因)"; fi

step "7/7 全受け口を、鍵なしで叩く(500・つながらない=読み込みの失敗。401/405 は『読み込めて、鍵を求めた』ので正常)"
SMOKE_BAD=0
if [ "$LIVE" -eq 1 ]; then
  line=""
  for f in "$WT"/api/*.ts; do
    n="$(basename "$f" .ts)"
    case "$n" in *.test) continue ;; esac
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$SITE_URL/api/$n" 2>/dev/null || true)"
    case "$code" in
      5*|000|"") SMOKE_BAD=1; echo "  ✗ /api/$n → ${code:-なし}" ;;
      *) line="$line $n=$code" ;;
    esac
  done
  echo " $line"
  [ "$SMOKE_BAD" -eq 0 ] && echo "✓ 全受け口が読み込めています" || echo "✗ 読み込めない受け口があります。すぐ直すか、直前の版に戻してください"
else
  echo "(公開を確認できなかったので飛ばしました)"
fi

if [ "$KEEP" -eq 0 ]; then
  cd "$MAIN_DIR"
  git worktree remove --force "$WT" 2>/dev/null || true
  git branch -D "$BRANCH" >/dev/null 2>&1 || true
fi
# 所要時間の計測。依頼が届いてから公開までを分けて出し、.fix-times.log(git に入れない)に残す。
#   依頼→開始 = 見つけて、調べて、直す時間(私の作業)/ テスト・統合 = ship.sh の前半 / 公開待ち = push から Vercel が公開するまで
T0=""
case "$FROM_EPOCH" in ''|*[!0-9]*) ;; *) T0="$FROM_EPOCH" ;; esac
A=$((E_PUSHED - E_START)); B=$((E_LIVE - E_PUSHED))
if [ -n "$T0" ]; then
  W0=$((E_START - T0)); TOTAL=$((E_LIVE - T0))
  echo "計測: 依頼→開始 ${W0}秒(調べて直す) / テスト・統合 ${A}秒 / 公開待ち ${B}秒 / 依頼→公開 ${TOTAL}秒"
else
  W0=""; TOTAL=$((E_LIVE - E_START))
  echo "計測: テスト・統合 ${A}秒 / 公開待ち ${B}秒 / 開始→公開 ${TOTAL}秒(依頼の時刻が分からないので、依頼→開始は無し)"
fi
printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$(date '+%Y-%m-%dT%H:%M:%S')" "${SHA:0:7}" "${W0:--}" "$A" "$B" "$TOTAL" "$MSG" >> "$MAIN_DIR/.fix-times.log" || true
echo "完了: ${SHA:0:7}  Vercel=$([ "$LIVE" -eq 1 ] && echo 公開済み || echo 未確認)  受け口=$([ "$SMOKE_BAD" -eq 0 ] && [ "$LIVE" -eq 1 ] && echo 正常 || echo 要確認)  所要 $((SECONDS - START))秒"
[ "$LIVE" -eq 1 ] && [ "$SMOKE_BAD" -eq 0 ]

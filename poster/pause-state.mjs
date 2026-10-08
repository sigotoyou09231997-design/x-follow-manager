// 画面の「投稿を止める」を、投稿役が覚えておく部品（ディスコード・Yay 共通）。
//
// 画面で止めると、api/poster-text が paused: true を返す。投稿役のプロセスは動いたまま、投稿だけを見合わせる
// （プロセスごと止めると、画面から再開できなくなる。STOP ファイルはその用途で今も使える）。
//
//   ・読めなかったとき（通信の失敗など）は、最後に分かっていた状態のまま。
//     止めたはずが、読み取りの失敗ひとつで再開してしまわないようにするため。
//   ・最後に分かっていた状態は logs/ に控える。Mac を再起動した直後に、まだ通信がつながっていなくても、
//     止めたまま始まる（読めた時点で、画面の状態に追いつく）。
//   ・画面の設定を使わない（クラウドの設定が無い）ときは、控えを作らない・読まない。
//     読み取る手段が無いのに「止めた」が残ると、再開する方法がなくなるため。
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** 控えから、最後に分かっていた状態を読む。無い・壊れているときは「止めていない」。 */
export function readPausedFile(file) {
  if (!file) return false;
  try {
    return JSON.parse(readFileSync(file, "utf8")).paused === true;
  } catch {
    return false;
  }
}

function writePausedFile(file, paused) {
  try {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ paused, at: new Date().toISOString() }) + "\n");
    renameSync(tmp, file);
  } catch {
    // 控えられなくても、止める・再開するの判断そのものには影響しない
  }
}

/**
 * file    … 控えの置き場所。null なら控えない（クラウドを使わないとき）
 * onChange … 状態が変わったときに1回だけ呼ぶ（記録や報告のため）
 */
export function createPauseTracker({ file = null, onChange } = {}) {
  let paused = readPausedFile(file);
  return {
    get paused() {
      return paused;
    },
    /** 画面から読めた状態を取り込む。変わったときだけ控えて、変わったかどうかを返す。 */
    observe(next) {
      if (next === paused) return false;
      paused = next;
      if (file) writePausedFile(file, next);
      onChange?.(next);
      return true;
    },
  };
}

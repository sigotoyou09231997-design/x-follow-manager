// 「いま投稿できていない」ことを、アプリの画面に出すための控え（ディスコード・Yay の投稿役が共通で使う）。
//
// なぜ要るか: 画面は「Mac からの報告が20分途絶えたら警告」しか見ていなかった。投稿役は動いていて報告も届くのに、
// 投稿だけが失敗し続けている間（2026-11-25、Yay のログインが切れて30分空回りしてから止まった）は、画面では
// 「動いています」のままで、気づけなかった。失敗のたびにこれを報告に載せ、投稿に成功したら消す。
//
//   message … 何が起きているか（1行・200文字まで。サーバーは300文字までしか受け取らない）
//   since   … 失敗が続き始めた時刻（直れば消えるので、次の失敗からまた数え直す）
//   count   … 続けて何回失敗したか
//   stopped … 投稿役がそれで止まったか（止まると報告も来なくなるので、止まる直前に送る）

const MAX_MESSAGE = 200;

export function oneLine(message) {
  return String(message ?? "").split("\n")[0].trim().slice(0, MAX_MESSAGE) || "原因の分からない失敗";
}

export function createProblem() {
  let current = null;
  return {
    /** いまの不調。無ければ null（報告にはそのまま載せる） */
    get value() {
      return current;
    },
    /** 失敗を1回ぶん足す。止まるときは stopped: true */
    fail(message, { stopped = false, now = new Date() } = {}) {
      current = {
        message: oneLine(message),
        since: current?.since ?? now.toISOString(),
        count: (current?.count ?? 0) + 1,
        stopped: stopped === true,
      };
      return current;
    },
    /** 投稿できたので消す。消したら true（そのときだけ、すぐ報告し直せばよい） */
    clear() {
      const had = current !== null;
      current = null;
      return had;
    },
  };
}

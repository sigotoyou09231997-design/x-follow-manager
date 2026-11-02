// 投稿が「外から」見えているかの確認（ログインしていない人と同じ見え方）。
//
// 2026-11-03 に、前のアカウントの投稿が、リンクを開けば見えるのに、サークルの一覧には1件も出ていないと分かった
// （1日約1,000件を出して消し続けた結果、制限されたとみられる）。自分の画面では必ず見えるので、気づけなかった。
// そこで、投稿のたびに、公開の一覧（ログイン不要の API）に、いま出した投稿が載っているかを確かめる。
// 何周も続けて載っていなければ、制限されている可能性が高いので、投稿を止めて知らせる（出し続けても誰にも届かない）。
//
// 確かめられないとき（サークルが非公開・通信エラー・API が変わった）は「見えない」とは数えない。
// 誤って止めるより、確かめられないことをログに残して続けるほうを選ぶ（止めるのは、確かに載っていない場合だけ）。

const API = "https://api.yay.space";

/** @returns {Promise<"visible"|"hidden"|"unknown">} */
export async function checkVisible({ target, postId, fetchJson = defaultFetch }) {
  if (!target.startsWith("group:")) return "unknown"; // タイムラインは一覧の作りが違うので確かめない
  const groupId = target.replace(/^group:/, "");
  try {
    // 出した直後は一覧に載るまで少しかかることがあるので、2回見る
    for (let i = 0; i < 2; i++) {
      const body = await fetchJson(`${API}/v2/posts/group_timeline?group_id=${groupId}&number=50`);
      const posts = body?.posts;
      if (!Array.isArray(posts) || posts.length === 0) return "unknown"; // 一覧が空・形が違う
      if (posts.some((p) => String(p.id) === String(postId))) return "visible";
      if (i === 0) await new Promise((r) => setTimeout(r, 4000));
    }
    return "hidden";
  } catch {
    return "unknown";
  }
}

async function defaultFetch(url) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * 「見えない」が続いたかを数える。見えた回があれば 0 に戻す。unknown は「見えない」の数えには入れず、戻しもしない。
 *   warn   … 見えない回が出はじめた最初の1回（通知用。続くあいだは重ねて知らせない）
 *   stop   … limit 回続けて hidden（投稿を止める）
 *   blind  … 確かめられない(unknown)が blindLimit 回続いた最初の1回（API が変わった・通信できない、の知らせ。見えているかが分からないまま出し続けないため）
 */
export function createVisibilityWatch({ limit = 3, blindLimit = 20 } = {}) {
  let hiddenStreak = 0;
  let unknownStreak = 0;
  return {
    record(result) {
      let warn = false;
      let blind = false;
      if (result === "unknown") {
        unknownStreak++;
        blind = unknownStreak === blindLimit;
      } else {
        unknownStreak = 0;
        if (result === "visible") hiddenStreak = 0;
        else {
          hiddenStreak++;
          warn = hiddenStreak === 1;
        }
      }
      return { streak: hiddenStreak, stop: hiddenStreak >= limit, warn, blind };
    },
    get streak() {
      return hiddenStreak;
    },
  };
}

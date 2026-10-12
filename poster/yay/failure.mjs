// Yay の投稿役が、失敗を「一時的な不調」と「ほんとうの失敗」に見分けて、待ち方を決める部品。
//
// 以前は、どんな失敗でも3回続くと投稿役が自分で止まっていた（2026-10-11 16:42、10-12 12:20・16:13 に止まり、
// 手で再起動するまで数時間〜止まったままだった）。16:13 の分は、Mac が一時的に重く（iCloud の同期で負荷が約45）、
// ページを開くのに30秒以上かかって「3回続けて失敗」になっただけで、yay.space 自体は無事だった。
// 一時的な遅れ・つながりにくさで止まっていては、止まったままになる時間のほうが長い。
//
//   一時的な不調（待って続ける）… 時間切れ・サーバーの答えが無い・通信の切断・投稿欄がまだ出ない
//   ほんとうの失敗（これまでどおり3回で止まる）… 上に当てはまらないもの（投稿が受け付けられない 等）
//   すぐ止まるもの（run.mjs の fatalPattern）… ログイン切れ・HTTP 403/429（制限がかかった可能性）。ここでは判断しない
//
// ただし、一時的な不調が TRANSIENT_GIVE_UP_MS 続けば、そのときは止まって知らせる（ずっと不調なのに
// 「動いている」顔で居続けないため。止まれば、スマホへの通知と、画面からの再起動が使える）。

/** この時間、一時的な不調が途切れず続いたら、止まって知らせる。 */
export const TRANSIENT_GIVE_UP_MS = 30 * 60 * 1000;

// 「interrupted by another navigation」は、前のページ移動が時間切れで終わらないまま次の移動に進んだときに出る
// （2026-10-12 16:41 に、これが3回続いて止まった）。つながりが遅いときの副作用なので、一時的な不調に数える
const TRANSIENT =
  /Timeout \d+ms exceeded|サーバーの答えが無い|投稿欄が見つかりません|is interrupted by another navigation|net::ERR_|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed/i;

/** 待てば直りうる失敗か。 */
export const isTransient = (message) => TRANSIENT.test(message);

/** 一時的な不調が続いているとき、次に動くまで待つ時間。30秒 → 1分 → 2分 → 4分 → 5分（上限）。 */
export const backoffMs = (streak) => Math.min(30_000 * 2 ** Math.max(0, streak - 1), 5 * 60_000);

/** 連続した一時的な不調が、あきらめる長さに達したか。since は不調が始まった時刻（ms）。 */
export const shouldGiveUp = (since, now) => now - since >= TRANSIENT_GIVE_UP_MS;

/**
 * 一時的な不調が続いているとき、同じ周回の残りの投稿先をどうするか。
 *   1回目 … そのまま次の投稿先へ（1回きりの時間切れは、よくある）
 *   2回目 … 少し待ってから次の投稿先へ
 *   3回目以降 … この周回の残りは見送る（サイトか Mac が不調なので、叩き続けない。次の周回でまた試す）
 */
export function nextStep(streak) {
  if (streak <= 1) return { action: "continue", waitMs: 0 };
  if (streak === 2) return { action: "continue", waitMs: backoffMs(1) };
  return { action: "skip-rest", waitMs: 0 };
}

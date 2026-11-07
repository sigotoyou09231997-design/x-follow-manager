// 投稿が消される直前に、その投稿の反応（いいね・返信・通報など）を読んで記録する。
// 「どの文・どのサークル・どの時間帯の投稿に反応が付いたか」を、あとから分析するための材料。
//
// 読むのは公開の投稿データ（ログイン不要・GET /v2/posts/<番号>）。1投稿につき1回だけ。
// 回数制限（429）で家の回線ごと使えなくなった前例がある（2026-11-03）ので、ここでは決して粘らない:
//   失敗したら1回で諦めて null を返す。投稿・削除の流れは、これが失敗しても止めない（投げない）。
const API = "https://api.yay.space";

/** 公開の投稿データから、分析に使う数字だけを取り出す。形が違えば null */
export function pickEngagement(body) {
  const p = body?.post ?? body;
  if (!p || typeof p !== "object" || p.id == null) return null;
  const n = (v) => (Number.isFinite(v) ? v : 0);
  return {
    likes: n(p.likes_count),
    reposts: n(p.reposts_count),
    replies: n(p.in_reply_to_post_count),
    reported: n(p.reported_count),
    gifts: n(p.total_gifts_count),
    hidden: p.hidden === true,
  };
}

/** @returns {Promise<ReturnType<typeof pickEngagement>>} 読めなかったときは null（投げない） */
export async function readEngagement(postId, { fetchJson = defaultFetch } = {}) {
  try {
    return pickEngagement(await fetchJson(`${API}/v2/posts/${postId}`));
  } catch {
    return null;
  }
}

/** 記録の1行。何時間掲載されていたか（ageSec）と、投稿時刻の時（JST の0〜23）も持たせる */
export function engagementRow({ prev, metrics, now = new Date() }) {
  const postedAt = new Date(prev.t);
  const jstHour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "Asia/Tokyo" }).format(postedAt)) % 24;
  return {
    target: prev.target,
    id: prev.id,
    text: prev.text ?? null,
    postedAt: postedAt.toISOString(),
    hour: jstHour,
    ageSec: Math.max(0, Math.round((now - postedAt) / 1000)),
    ...metrics,
  };
}

async function defaultFetch(url) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

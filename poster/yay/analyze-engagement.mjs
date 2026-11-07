// 記録（logs/engagement.jsonl）を、文・サークル・時間帯ごとに集計して見せる。
//   node analyze-engagement.mjs [日数=7]
// 「反応」は 1投稿あたりのいいね＋返信＋リポスト。通報は別に出す（多いと制限されやすい）。
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export function summarize(rows, keyOf) {
  const m = new Map();
  for (const r of rows) {
    const k = keyOf(r);
    const a = m.get(k) ?? { n: 0, likes: 0, replies: 0, reposts: 0, reported: 0, withReaction: 0 };
    a.n++; a.likes += r.likes; a.replies += r.replies; a.reposts += r.reposts; a.reported += r.reported;
    if (r.likes + r.replies + r.reposts > 0) a.withReaction++;
    m.set(k, a);
  }
  return [...m.entries()].map(([key, a]) => ({
    key, 投稿数: a.n, いいね: a.likes, 返信: a.replies, リポスト: a.reposts, 通報: a.reported,
    反応のあった率: `${Math.round((a.withReaction / a.n) * 100)}%`, 通報の平均: +(a.reported / a.n).toFixed(2),
  })).sort((x, y) => y.投稿数 - x.投稿数);
}

export function load(file, days, now = Date.now()) {
  if (!existsSync(file)) return [];
  const since = now - days * 86400000;
  return readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } })
    .filter((r) => new Date(r.postedAt ?? r.t).getTime() >= since);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const here = dirname(fileURLToPath(import.meta.url));
  const days = Number(process.argv[2] ?? 7);
  const rows = load(join(here, "logs/engagement.jsonl"), days);
  console.log(`直近${days}日の記録: ${rows.length}件`);
  if (!rows.length) process.exit(0);
  console.log("\n■ 文ごと"); console.table(summarize(rows, (r) => r.text ?? "(不明)"));
  console.log("\n■ 時間帯ごと（日本時間・投稿した時）"); console.table(summarize(rows, (r) => `${String(r.hour).padStart(2, "0")}時`).sort((a, b) => a.key.localeCompare(b.key)));
  console.log("\n■ 投稿先ごと"); console.table(summarize(rows, (r) => r.target));
}

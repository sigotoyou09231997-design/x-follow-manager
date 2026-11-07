// チャットの定期記録（logs/chats.jsonl）と投稿の記録（logs/posted.jsonl）を突き合わせて、
// 「相手からの新着（新しい会話・返事）が、どの文・どの時間帯のときに来たか」を数える。
//   node analyze-chats.mjs [日数=7]
// 文の特定: 新着の時刻より前で、いちばん新しく投稿した文（時間帯ごとに文が切り替わるので、これで近似できる）。
// 注意: 記録は30分おき。1日に来た数のおおよその傾向を見るもので、1件ごとの原因は断定できない。
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const readJsonl = (f) => (existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }) : []);

/** 文の切り替わり表: 投稿の記録から [時刻ms, 文] を時刻順に */
export function textTimeline(ledgerRows) {
  return ledgerRows.filter((r) => r.id && !r.deleted && r.text).map((r) => [new Date(r.t).getTime(), r.text]).sort((a, b) => a[0] - b[0]);
}
export function textAt(timeline, ms) {
  let found = null;
  for (const [t, text] of timeline) { if (t <= ms) found = text; else break; }
  return found;
}

/** 連続する記録の差から「相手からの新着」の出来事を取り出す: [{ at(ms), kind: 'new'|'reply' }] */
export function incomingEvents(snaps) {
  const events = [];
  for (let i = 1; i < snaps.length; i++) {
    const before = new Map(snaps[i - 1].rooms.map((r) => [r.room, r]));
    for (const r of snaps[i].rooms) {
      if (r.lastBy !== "partner") continue;
      const b = before.get(r.room);
      if (!b) events.push({ at: r.lastAt * 1000, kind: "new" });
      else if (r.lastId !== b.lastId) events.push({ at: r.lastAt * 1000, kind: "reply" });
    }
  }
  return events;
}

export function tally(events, timeline, keyOf) {
  const m = new Map();
  for (const e of events) {
    const k = keyOf(e, textAt(timeline, e.at));
    const a = m.get(k) ?? { 新しい会話: 0, 返事: 0 };
    if (e.kind === "new") a.新しい会話++; else a.返事++;
    m.set(k, a);
  }
  return [...m.entries()].map(([key, a]) => ({ key, ...a })).sort((x, y) => (y.新しい会話 + y.返事) - (x.新しい会話 + x.返事));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const here = dirname(fileURLToPath(import.meta.url));
  const days = Number(process.argv[2] ?? 7);
  const since = Date.now() - days * 86400000;
  const snaps = readJsonl(join(here, "logs/chats.jsonl")).filter((s) => new Date(s.t).getTime() >= since - 3600000);
  const timeline = textTimeline(readJsonl(join(here, "logs/posted.jsonl")));
  const events = incomingEvents(snaps).filter((e) => e.at >= since);
  console.log(`直近${days}日: 記録${snaps.length}回 / 相手からの新着 ${events.length}件（新しい会話 ${events.filter((e) => e.kind === "new").length}）`);
  if (!events.length) process.exit(0);
  const jstHour = (ms) => `${String(Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "Asia/Tokyo" }).format(new Date(ms))) % 24).padStart(2, "0")}時`;
  console.log("\n■ 文ごと"); console.table(tally(events, timeline, (_e, text) => text ?? "(不明)"));
  console.log("\n■ 時間帯ごと（日本時間）"); console.table(tally(events, timeline, (e) => jstHour(e.at)).sort((a, b) => a.key.localeCompare(b.key)));
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { engagementRow, pickEngagement, readEngagement } from "./engagement.mjs";

test("公開の投稿データから反応の数字を取り出す", () => {
  const m = pickEngagement({ id: 1, likes_count: 3, reposts_count: 1, in_reply_to_post_count: 2, reported_count: 4, total_gifts_count: 0, hidden: false });
  assert.deepEqual(m, { likes: 3, reposts: 1, replies: 2, reported: 4, gifts: 0, hidden: false });
});

test("項目が無ければ0、形が違えば null", () => {
  assert.deepEqual(pickEngagement({ post: { id: 9 } }), { likes: 0, reposts: 0, replies: 0, reported: 0, gifts: 0, hidden: false });
  assert.equal(pickEngagement({}), null);
  assert.equal(pickEngagement(null), null);
});

test("読めない（429・通信エラー）ときは null を返し、投げない・粘らない", async () => {
  let calls = 0;
  const m = await readEngagement(5, { fetchJson: async () => { calls++; throw new Error("HTTP 429"); } });
  assert.equal(m, null);
  assert.equal(calls, 1);
});

test("記録の1行: 掲載時間と、投稿した時刻（日本時間の時）を持つ", () => {
  const prev = { t: "2026-11-07T10:00:00.000Z", target: "group:1", id: "7", text: "こんにちは" }; // JST 19時
  const row = engagementRow({ prev, metrics: { likes: 1, reposts: 0, replies: 0, reported: 2, gifts: 0, hidden: false }, now: new Date("2026-11-07T10:15:00.000Z") });
  assert.equal(row.hour, 19);
  assert.equal(row.ageSec, 900);
  assert.equal(row.text, "こんにちは");
  assert.equal(row.reported, 2);
});

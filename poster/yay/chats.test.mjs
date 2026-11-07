import { test } from "node:test";
import assert from "node:assert/strict";
import { diffChats, dueForSnapshot, pickChats } from "./chats.mjs";

const room = (id, lastId, userId, partner = 100, unread = 0) => ({
  id, is_group: false, unread_count: unread, members: [{ id: partner, nickname: "名前は記録しない" }],
  last_message: { id: lastId, user_id: userId, created_at: 1000 + lastId, text: "本文は記録しない" },
});

test("一覧から会話ごとの番号・時刻・送り主だけを取る（名前と本文は持たない）", () => {
  const s = pickChats({ chat_rooms: [room(1, 11, 100, 100, 2)], pinned_chats: [room(2, 22, 5, 200)] }, 3);
  assert.equal(s.requests, 3);
  assert.deepEqual(s.rooms.map((r) => [r.room, r.lastBy, r.unread]), [[2, "me", 0], [1, "partner", 2]]);
  assert.equal(JSON.stringify(s).includes("本文は記録しない"), false);
  assert.equal(JSON.stringify(s).includes("名前は記録しない"), false);
});

test("形が違えば null", () => { assert.equal(pickChats({}), null); assert.equal(pickChats(null), null); });

test("前回との差: 新しい会話・相手からの新着を数える。自分の発言は数えない", () => {
  const prev = pickChats({ chat_rooms: [room(1, 11, 100), room(2, 21, 200)] });
  const next = pickChats({ chat_rooms: [room(1, 12, 100), room(2, 22, 5, 200), room(3, 31, 300, 300)] });
  assert.deepEqual(diffChats(prev, next), { newRooms: 1, incoming: 2, first: false });
});

test("最初の記録は差を出さない", () => { assert.equal(diffChats(null, pickChats({ chat_rooms: [] })).first, true); });

test("記録の間隔: 空いていれば true、記録が無ければ true", () => {
  const now = Date.parse("2026-11-08T00:30:00Z");
  assert.equal(dueForSnapshot({ t: "2026-11-08T00:00:00Z" }, 30 * 60000, now), true);
  assert.equal(dueForSnapshot({ t: "2026-11-08T00:10:00Z" }, 30 * 60000, now), false);
  assert.equal(dueForSnapshot(null, 1000, now), true);
});

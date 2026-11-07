import { test } from "node:test";
import assert from "node:assert/strict";
import { incomingEvents, tally, textAt, textTimeline } from "./analyze-chats.mjs";

const snap = (rooms) => ({ t: "x", rooms });
const room = (room, lastId, lastBy, lastAt) => ({ room, lastId, lastBy, lastAt });

test("相手からの新着だけ、新しい会話と返事に分けて取り出す", () => {
  const a = snap([room(1, 10, "partner", 100)]);
  const b = snap([room(1, 11, "partner", 200), room(2, 20, "partner", 210), room(3, 30, "me", 220)]);
  assert.deepEqual(incomingEvents([a, b]), [{ at: 200000, kind: "reply" }, { at: 210000, kind: "new" }]);
});

test("新着の時刻より前で、いちばん新しい文に振り分ける", () => {
  const tl = textTimeline([{ t: new Date(1000).toISOString(), id: 1, text: "A" }, { t: new Date(5000).toISOString(), id: 2, text: "B" }, { t: new Date(6000).toISOString(), id: 2, deleted: true }]);
  assert.equal(textAt(tl, 900), null);
  assert.equal(textAt(tl, 4000), "A");
  assert.equal(textAt(tl, 9000), "B");
  const out = tally([{ at: 4000, kind: "new" }, { at: 9000, kind: "reply" }, { at: 9500, kind: "new" }], tl, (_e, t) => t);
  assert.deepEqual(out.find((x) => x.key === "B"), { key: "B", 新しい会話: 1, 返事: 1 });
});

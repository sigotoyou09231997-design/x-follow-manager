import { test } from "node:test";
import assert from "node:assert/strict";
import { summarize } from "./analyze-engagement.mjs";

const row = (text, likes, reported = 0) => ({ text, likes, replies: 0, reposts: 0, reported });

test("文ごとに、投稿数・いいね・反応のあった率・通報の平均を出す", () => {
  const out = summarize([row("A", 1, 2), row("A", 0, 4), row("B", 0)], (r) => r.text);
  const a = out.find((x) => x.key === "A");
  assert.equal(a.投稿数, 2);
  assert.equal(a.いいね, 1);
  assert.equal(a.反応のあった率, "50%");
  assert.equal(a.通報の平均, 3);
  assert.equal(out[0].key, "A"); // 投稿数の多い順
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { checkVisible, createVisibilityWatch } from "./visibility.mjs";

const feed = (ids) => async () => ({ posts: ids.map((id) => ({ id })) });

test("一覧に載っていれば visible", async () => {
  assert.equal(await checkVisible({ target: "group:1", postId: "5", fetchJson: feed([9, 5, 3]) }), "visible");
});

test("一覧に載っていなければ hidden（2回見てから）", async () => {
  let calls = 0;
  const f = async () => (calls++, { posts: [{ id: 9 }] });
  assert.equal(await checkVisible({ target: "group:1", postId: "5", fetchJson: f }), "hidden");
  assert.equal(calls, 2);
});

test("タイムライン・通信エラー・一覧が空は unknown（見えないとは数えない）", async () => {
  assert.equal(await checkVisible({ target: "timeline", postId: "5", fetchJson: feed([5]) }), "unknown");
  assert.equal(await checkVisible({ target: "group:1", postId: "5", fetchJson: async () => { throw new Error("HTTP 403"); } }), "unknown");
  assert.equal(await checkVisible({ target: "group:1", postId: "5", fetchJson: feed([]) }), "unknown");
  assert.equal(await checkVisible({ target: "group:1", postId: "5", fetchJson: async () => ({ oops: 1 }) }), "unknown");
});

test("見えない続きが limit 回で止める。見えた回・unknown の扱い", () => {
  const w = createVisibilityWatch({ limit: 3 });
  assert.equal(w.record("hidden").stop, false);
  assert.equal(w.record("unknown").streak, 1); // unknown は数えも戻しもしない
  assert.equal(w.record("hidden").stop, false);
  assert.equal(w.record("visible").streak, 0); // 見えたら戻る
  w.record("hidden");
  w.record("hidden");
  assert.equal(w.record("hidden").stop, true);
});

test("最初に見えなかった回だけ warn、確かめられない状態が続いたら blind（1回だけ）", () => {
  const w = createVisibilityWatch({ limit: 3, blindLimit: 3 });
  assert.equal(w.record("hidden").warn, true);
  assert.equal(w.record("hidden").warn, false); // 続くあいだは重ねて知らせない
  assert.equal(w.record("visible").warn, false);
  assert.equal(w.record("hidden").warn, true); // 見えた回のあとの、新しい始まり
  assert.equal(w.record("unknown").blind, false);
  assert.equal(w.record("unknown").blind, false);
  assert.equal(w.record("unknown").blind, true);
  assert.equal(w.record("unknown").blind, false); // 重ねて知らせない
  assert.equal(w.record("visible").blind, false); // 確かめられた回で数え直す
});

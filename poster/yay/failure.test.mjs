// node --test poster/yay/failure.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { backoffMs, isTransient, nextStep, shouldGiveUp, TRANSIENT_GIVE_UP_MS } from "./failure.mjs";

test("実際に投稿役を止めた失敗（時間切れ・サーバーの答えが無い・投稿欄が出ない）は、一時的な不調と見分ける", () => {
  for (const msg of [
    "page.goto: Timeout 30000ms exceeded.",
    "locator.click: Timeout 10000ms exceeded.",
    "locator.waitFor: Timeout 15000ms exceeded.",
    "page.waitForResponse: Timeout 30000ms exceeded while waiting for event \"response\"",
    "投稿 610321010 の状態を確認できません（サーバーの答えが無い）",
    "投稿欄が見つかりません (https://yay.space/)",
    "page.goto: net::ERR_INTERNET_DISCONNECTED at https://yay.space/",
    "fetch failed",
  ]) {
    assert.equal(isTransient(msg), true, msg);
  }
});

test("投稿が受け付けられない・想定と違う、は一時的ではない（これまでどおり数えて止める）", () => {
  for (const msg of [
    "投稿が受け付けられませんでした: HTTP 400 {\"result\":\"error\"}",
    "投稿先か文が想定と違います（番号 1 / group_id=2）。手で確認してください",
    "削除したのに残っています (610321010)",
    "投稿欄の文が一致しません: \"…\"",
  ]) {
    assert.equal(isTransient(msg), false, msg);
  }
});

test("待ち時間は 30秒→1分→2分→4分→5分で、5分より延ばさない", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 20].map(backoffMs), [30000, 60000, 120000, 240000, 300000, 300000, 300000]);
});

test("一時的な不調が30分途切れず続いたら、あきらめて止まる", () => {
  const since = 1_000_000;
  assert.equal(shouldGiveUp(since, since + TRANSIENT_GIVE_UP_MS - 1), false);
  assert.equal(shouldGiveUp(since, since + TRANSIENT_GIVE_UP_MS), true);
});

test("1回きりは次の投稿先へ、2回目は少し待つ、3回目以降はその周回の残りを見送る", () => {
  assert.deepEqual(nextStep(1), { action: "continue", waitMs: 0 });
  assert.deepEqual(nextStep(2), { action: "continue", waitMs: 30000 });
  assert.deepEqual(nextStep(3), { action: "skip-rest", waitMs: 0 });
  assert.deepEqual(nextStep(9), { action: "skip-rest", waitMs: 0 });
});

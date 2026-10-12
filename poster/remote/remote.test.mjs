// node --test poster/remote/remote.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { decide, STALE_LOG_MINUTES } from "./remote.mjs";

test("動いていて、記録も新しければ、そのまま（触らない）", () => {
  assert.equal(decide({ running: true, stopExists: false, logAgeMinutes: 3 }).action, "skip");
});

test("動いていなければ入れ替える", () => {
  assert.equal(decide({ running: false, stopExists: false, logAgeMinutes: 3 }).action, "restart");
  assert.equal(decide({ running: false, stopExists: false, logAgeMinutes: null }).action, "restart");
});

test("動いていても、記録が15分以上動いていなければ（固まっている）入れ替える", () => {
  assert.equal(decide({ running: true, stopExists: false, logAgeMinutes: STALE_LOG_MINUTES }).action, "restart");
  assert.equal(decide({ running: true, stopExists: false, logAgeMinutes: STALE_LOG_MINUTES - 1 }).action, "skip");
});

test("記録がまだ無い（時刻が分からない）ときは、動いていれば触らない", () => {
  assert.equal(decide({ running: true, stopExists: false, logAgeMinutes: null }).action, "skip");
});

test("STOP があるときは、止まっていても固まっていても触らない（わざと止めているのを外さない）", () => {
  assert.equal(decide({ running: false, stopExists: true, logAgeMinutes: 99 }).action, "blocked");
  assert.equal(decide({ running: true, stopExists: true, logAgeMinutes: 99 }).action, "blocked");
});

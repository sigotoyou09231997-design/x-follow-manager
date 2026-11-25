import { test } from "node:test";
import assert from "node:assert/strict";
import { createProblem, oneLine } from "./problem.mjs";

test("失敗が続くあいだは、始まりの時刻を保ったまま回数を数え、最新の中身に差し替える", () => {
  const p = createProblem();
  assert.equal(p.value, null);
  p.fail("時間切れ", { now: new Date("2026-11-25T10:45:00Z") });
  p.fail("ログインが切れています\n詳しい呼び出し履歴", { now: new Date("2026-11-25T11:15:00Z"), stopped: true });
  assert.deepEqual(p.value, { message: "ログインが切れています", since: "2026-11-25T10:45:00.000Z", count: 2, stopped: true });
});

test("投稿できたら消え、次の失敗からまた数え直す", () => {
  const p = createProblem();
  p.fail("a", { now: new Date("2026-11-25T10:00:00Z") });
  assert.equal(p.clear(), true);
  assert.equal(p.clear(), false); // 2回目は消すものが無い（報告し直さなくてよい）
  p.fail("b", { now: new Date("2026-11-25T12:00:00Z") });
  assert.deepEqual(p.value, { message: "b", since: "2026-11-25T12:00:00.000Z", count: 1, stopped: false });
});

test("中身は1行・200文字まで。空なら決まった言い方にする", () => {
  assert.equal(oneLine("x".repeat(500)).length, 200);
  assert.equal(oneLine(""), "原因の分からない失敗");
  assert.equal(oneLine(undefined), "原因の分からない失敗");
});

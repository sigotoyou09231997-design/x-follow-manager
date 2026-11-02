import { test } from "node:test";
import assert from "node:assert/strict";
import { pickCycleTargets } from "./rotation.mjs";

const T = ["timeline", "group:1", "group:2", "group:3", "group:4", "group:5"];

test("perCycle が無い・サークル数以上なら、全部（タイムラインも）", () => {
  assert.deepEqual(pickCycleTargets(T, undefined, 3).picked, T);
  assert.deepEqual(pickCycleTargets(T, null).picked, T);
  assert.deepEqual(pickCycleTargets(T, 5).picked, T);
  assert.deepEqual(pickCycleTargets(T, 9).picked, T);
  assert.deepEqual(pickCycleTargets(T, 0).picked, T); // 0 や負は無効＝全部
});

test("タイムラインは毎周回、サークルは perCycle ずつ順番に回って、一巡する", () => {
  let offset = 0;
  const seen = [];
  for (let i = 0; i < 5; i++) {
    const r = pickCycleTargets(T, 2, offset);
    assert.equal(r.picked[0], "timeline");
    assert.equal(r.picked.length, 3);
    seen.push(r.picked.slice(1));
    offset = r.nextOffset;
  }
  assert.deepEqual(seen, [["group:1", "group:2"], ["group:3", "group:4"], ["group:5", "group:1"], ["group:2", "group:3"], ["group:4", "group:5"]]);
});

test("サークルの数が変わっても、続きが範囲を外れない", () => {
  const r = pickCycleTargets(["timeline", "group:1", "group:2"], 1, 9);
  assert.deepEqual(r.picked, ["timeline", "group:2"]); // 9 を 2 で割った余り 1 番目
  assert.equal(r.nextOffset, 0);
});

test("タイムラインが無くても動く", () => {
  assert.deepEqual(pickCycleTargets(["group:1", "group:2", "group:3"], 2, 0).picked, ["group:1", "group:2"]);
});

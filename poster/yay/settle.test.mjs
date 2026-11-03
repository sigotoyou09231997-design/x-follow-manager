import { test } from "node:test";
import assert from "node:assert/strict";
import { waitSettled } from "./yay.mjs";

// 位置が動いている間は待ち、2回続けて同じになったら返す（動画カードの読み込みで自分の投稿がずれる対策）
const fake = (ys) => {
  let i = 0;
  return { boundingBox: async () => ({ x: 0, y: ys[Math.min(i++, ys.length - 1)], height: 100 }) };
};

test("ずれが止まったら true", async () => {
  assert.equal(await waitSettled(fake([10, 50, 80, 80]), { gapMs: 1 }), true);
});
test("ずっと動いていたら false（投げない）", async () => {
  assert.equal(await waitSettled(fake([1, 2, 3, 4, 5, 6]), { tries: 5, gapMs: 1 }), false);
});
test("要素が見つからないときも false", async () => {
  assert.equal(await waitSettled({ boundingBox: async () => null }, { tries: 3, gapMs: 1 }), false);
});

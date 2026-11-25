import { test } from "node:test";
import assert from "node:assert/strict";
import { chromeArgs } from "./yay.mjs";

test("既定は画面あり（--headless を付けない）", () => {
  const args = chromeArgs({ port: 9334, profile: "/p" });
  assert.ok(!args.some((a) => a.startsWith("--headless")));
  assert.ok(args.includes("--remote-debugging-port=9334"));
  assert.ok(args.includes("--user-data-dir=/p"));
});

test("headless のときだけ --headless=new を付ける", () => {
  assert.ok(chromeArgs({ port: 1, profile: "/p", headless: true }).includes("--headless=new"));
  // 画面が狭いと Yay の投稿欄が出ないので、大きさも一緒に指定する
  assert.ok(chromeArgs({ port: 1, profile: "/p", headless: true }).includes("--window-size=1280,900"));
  assert.ok(!chromeArgs({ port: 1, profile: "/p", headless: false }).includes("--headless=new"));
});

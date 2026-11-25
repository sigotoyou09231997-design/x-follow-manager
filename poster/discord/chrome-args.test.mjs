import { test } from "node:test";
import assert from "node:assert/strict";
import { chromeArgs } from "./chrome-args.mjs";

test("既定は画面あり（--headless を付けない）", () => {
  const args = chromeArgs({ port: 9333, profile: "/p", url: "https://example.com/" });
  assert.ok(!args.some((a) => a.startsWith("--headless")));
  assert.ok(args.includes("--remote-debugging-port=9333"));
  assert.ok(args.includes("--user-data-dir=/p"));
  assert.equal(args.at(-1), "https://example.com/");
});

test("headless のときだけ --headless=new と画面の大きさを付ける", () => {
  const on = chromeArgs({ port: 1, profile: "/p", url: "u", headless: true });
  assert.ok(on.includes("--headless=new"));
  assert.ok(on.includes("--window-size=1280,900"));
  const off = chromeArgs({ port: 1, profile: "/p", url: "u", headless: false });
  assert.ok(!off.includes("--headless=new"));
});

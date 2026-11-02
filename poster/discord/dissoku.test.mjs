import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDissokuPoster, dissokuConfig } from "./dissoku.mjs";

// 画面の部品は偽物。確かめるのは「いつ入れ替え、いつアップを押し、いつ見送るか」。実際の部品が合っているかは本物の画面で見る。
function fakePage(over = {}) {
  const calls = { goto: [], typed: [], submit: 0, up: 0, terms: 0 };
  const s = { landed: "https://dissoku.net/ja/mypage/profile", value: "古い文", max: 500, submitReady: true, writeStatus: 200, upStatus: 200, upDisabled: false, upCount: 1, ...over };
  let pendingStatus = 200;
  const page = {
    calls,
    goto: async (url) => calls.goto.push(url),
    url: () => s.landed,
    waitForTimeout: async () => {},
    waitForFunction: () => (s.submitReady ? Promise.resolve() : Promise.reject(new Error("timeout"))),
    waitForResponse: async () => ({ status: () => pendingStatus, json: async () => ({ remainMs: 120000 }) }),
    locator: (sel) => ({
      waitFor: () => (s.landed.includes("/mypage/profile") ? Promise.resolve() : Promise.reject(new Error("timeout"))),
      evaluate: async () => s.max,
      inputValue: async () => s.value,
      count: async () => 1,
      getAttribute: async () => "false",
      first() {
        return this;
      },
      click: async () => {
        if (String(sel).includes("checkbox")) calls.terms++;
        if (String(sel).includes("submit")) {
          calls.submit++;
          pendingStatus = s.writeStatus;
        }
      },
      press: async () => {
        s.value = "";
      },
      pressSequentially: async (t) => {
        calls.typed.push(t);
        s.value = t;
      },
    }),
    getByRole: () => ({
      count: async () => s.upCount,
      first: () => ({
        isDisabled: async () => s.upDisabled,
        click: async () => {
          calls.up++;
          pendingStatus = s.upStatus;
        },
      }),
    }),
  };
  return page;
}

function make(cfg = {}) {
  const dir = mkdtempSync(join(tmpdir(), "dissoku-"));
  const logs = [];
  const notes = [];
  const poster = createDissokuPoster({
    config: { dissoku: { enabled: true, ...cfg } },
    logFile: join(dir, "posted.log"),
    log: (m) => logs.push(m),
    notify: (m) => notes.push(m),
    isHeld: () => false,
  });
  return { poster, logs, notes, dir };
}

test("設定: 書かなければ使わない／dissoku.net 以外は断る", () => {
  assert.equal(dissokuConfig({}).enabled, false);
  assert.equal(dissokuConfig({ dissoku: { enabled: false } }).enabled, false);
  assert.equal(dissokuConfig({ dissoku: { enabled: true } }).enabled, true);
  assert.throws(() => dissokuConfig({ dissoku: { enabled: true, url: "https://example.com/x" } }), /dissoku\.net/);
});

test("文を入れ替えて送信し、アップを押す。記録が残る", async () => {
  const { poster, dir } = make();
  const page = fakePage();
  const r = await poster.postTogether(page, "新しい文");
  assert.deepEqual([r.status, r.rewrote, r.upped], ["posted", true, true]);
  assert.deepEqual(page.calls.typed, ["新しい文"]);
  assert.equal(page.calls.terms, 1); // 利用規約のチェックを入れてから送信
  assert.equal(page.calls.submit, 1);
  assert.equal(page.calls.up, 1);
  assert.match(readFileSync(join(dir, "posted.log"), "utf8"), /新しい文/);
});

test("同じ文のときは送信を飛ばして、アップだけ押す", async () => {
  const { poster } = make();
  const page = fakePage({ value: "同じ文" });
  const r = await poster.postTogether(page, "同じ文");
  assert.deepEqual([r.status, r.rewrote, r.upped], ["posted", false, true]);
  assert.equal(page.calls.submit, 0);
  assert.equal(page.calls.terms, 0); // 送信しないのでチェックも入れない
  assert.equal(page.calls.up, 1);
});

test("アップが断られたら（429）冷却のあいだは押さない。失敗にはしない", async () => {
  let t = 0;
  const poster = createDissokuPoster({
    config: { dissoku: { enabled: true } },
    logFile: join(mkdtempSync(join(tmpdir(), "dissoku-")), "p.log"),
    log: () => {},
    notify: () => {},
    isHeld: () => false,
    now: () => t,
  });
  const first = fakePage({ value: "a", upStatus: 429 });
  assert.equal((await poster.postTogether(first, "a")).upped, false);
  assert.equal(first.calls.up, 1);
  t = 60_000; // 残り2分のうちの1分後
  const second = fakePage({ value: "b" });
  assert.equal((await poster.postTogether(second, "b")).upped, false);
  assert.equal(second.calls.up, 0);
  t = 200_000; // 冷却が明けた
  const third = fakePage({ value: "c" });
  assert.equal((await poster.postTogether(third, "c")).upped, true);
});

test("ログインが切れていたら通知して見送る（1回だけ通知）", async () => {
  const { poster, notes } = make();
  const page = fakePage({ landed: "https://dissoku.net/ja" });
  assert.equal((await poster.postTogether(page, "x")).status, "login");
  assert.equal((await poster.postTogether(page, "x")).status, "login");
  assert.equal(notes.length, 1);
});

test("欄の上限を超える文は切らずに見送る", async () => {
  const { poster } = make();
  const page = fakePage({ max: 5 });
  assert.equal((await poster.postTogether(page, "あいうえおか")).status, "toolong");
  assert.equal(page.calls.typed.length, 0);
});

test("送信が403なら、このプロセスではやめる。アップは押さない", async () => {
  const { poster } = make();
  const page = fakePage({ writeStatus: 403 });
  assert.equal((await poster.postTogether(page, "新しい文")).status, "stopped");
  assert.equal(page.calls.up, 0);
  assert.equal((await poster.postTogether(fakePage(), "x")).status, "stopped");
});

test("止められている・無効なときは何もしない", async () => {
  const off = createDissokuPoster({ config: {}, logFile: "x", log() {}, notify() {}, isHeld: () => false });
  assert.equal((await off.postTogether(fakePage(), "x")).status, "off");
  const held = createDissokuPoster({ config: { dissoku: { enabled: true } }, logFile: "x", log() {}, notify() {}, isHeld: () => true });
  const page = fakePage();
  assert.equal((await held.postTogether(page, "x")).status, "held");
  assert.equal(page.calls.goto.length, 0);
});

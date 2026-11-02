import { test } from "node:test";
import assert from "node:assert/strict";
import { checkBoard, judgeBoard, snippetOf } from "./board-visibility.mjs";

const many = (extra = []) => [...Array.from({ length: 10 }, (_, i) => `誰か${i} / 雑談`), ...extra];

test("目印は、文の最初の空でない1行", () => {
  assert.equal(snippetOf("\n  甘々寝落ち、連絡ください\n24"), "甘々寝落ち、連絡ください");
  assert.equal(snippetOf(""), "");
});

test("一覧に載っていれば visible、載っていなければ hidden", () => {
  assert.equal(judgeBoard({ articles: many(["tubasa / 甘々寝落ち、連絡ください\n24 / 0分前"]), snippet: "甘々寝落ち、連絡ください" }), "visible");
  assert.equal(judgeBoard({ articles: many(), snippet: "甘々寝落ち、連絡ください" }), "hidden");
});

test("一覧が少ない・読めていない・目印が無いときは unknown（見えないとは数えない）", () => {
  assert.equal(judgeBoard({ articles: ["a", "b"], snippet: "x" }), "unknown");
  assert.equal(judgeBoard({ articles: null, snippet: "x" }), "unknown");
  assert.equal(judgeBoard({ articles: many(), snippet: "" }), "unknown");
});

// 偽のブラウザ
function fakeChromium({ pages, fail = false }) {
  let n = 0;
  const closed = { v: false };
  return {
    closed,
    launch: async () => {
      if (fail) throw new Error("起動できません");
      return {
        newContext: async () => ({
          newPage: async () => ({
            goto: async () => {},
            waitForSelector: async () => {},
            $$eval: async () => pages[Math.min(n++, pages.length - 1)],
            waitForTimeout: async () => {},
          }),
        }),
        close: async () => {
          closed.v = true;
        },
      };
    },
  };
}

test("1回目に載っていなくても、2回目に載っていれば visible。ブラウザは必ず閉じる", async () => {
  const c = fakeChromium({ pages: [many(), many(["甘々寝落ち、連絡ください"])] });
  assert.equal(await checkBoard({ chromium: c, url: "https://x.example/", text: "甘々寝落ち、連絡ください\n24", retryWaitMs: 0 }), "visible");
  assert.equal(c.closed.v, true);
});

test("2回見ても載っていなければ hidden。起動できないときは unknown", async () => {
  const c = fakeChromium({ pages: [many()] });
  assert.equal(await checkBoard({ chromium: c, url: "https://x.example/", text: "甘々寝落ち、連絡ください", retryWaitMs: 0 }), "hidden");
  const f = fakeChromium({ pages: [many()], fail: true });
  assert.equal(await checkBoard({ chromium: f, url: "https://x.example/", text: "あ" }), "unknown");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterFailure, createEroypePoster, eroypeConfig } from "./eroype.mjs";

// 画面の部品は偽物（Playwright の page のうち、eroype.mjs が使う部分だけ）。
// 確かめるのは「いつ送り、いつ見送り、いつやめるか」。実際の画面の部品が合っているかは、本物のページで見る。
function fakePage(over = {}) {
  const calls = { goto: [], typed: [], tags: [], clicked: 0 };
  const state = {
    landed: "https://eroype.net/create",
    maxLength: 300,
    turnstile: true,
    token: true,
    enabled: true, // 文を入れたあと、投稿ボタンが押せるか
    status: 201,
    body: null, // 投稿の通信の中身（冷却中は { remainMs }）
    posted: true, // 投稿のあと、文が欄から消える（成功）か
    noPost: false, // 投稿の通信が出ない
    typedValue: null, // 欄に入った値（null なら打った文のまま）
    clickThrows: false,
    ...over,
  };
  const never = () => Promise.reject(new Error("timeout"));
  const page = {
    calls,
    state,
    goto: async (url) => {
      calls.goto.push(url);
    },
    url: () => state.landed,
    locator: (selector) => ({
      count: async () => (state.turnstile ? 1 : 0),
      // 欄の上限を読む呼び出しと、ボタンを直接押す代わりの呼び出し
      evaluate: async (fn) => {
        if (String(fn).includes("maxLength")) return state.maxLength;
        calls.clicked++;
      },
      click: async () => {
        if (selector.includes("submit")) {
          if (state.clickThrows) throw new Error("click failed");
          calls.clicked++;
        }
      },
      pressSequentially: async (text) => {
        if (selector === "#message") calls.typed.push(text);
        else calls.tags.push(text);
      },
      press: async () => {},
      inputValue: async () => (state.typedValue ?? calls.typed.at(-1)),
    }),
    // 待つ内容は関数の中身で見分ける（認証の値・投稿ボタンが押せるか・投稿が済んだか）
    waitForFunction: async (fn) => {
      const src = String(fn);
      const ok = src.includes("cf-turnstile") ? state.token : src.includes("disabled") ? state.enabled : state.posted;
      return ok ? true : never();
    },
    waitForTimeout: async () => {},
    waitForResponse: async (predicate) => {
      calls.responsePredicate = predicate;
      return state.noPost ? never() : { status: () => state.status, json: async () => state.body };
    },
  };
  return page;
}

function setup(over = {}, config = { eroype: { enabled: true } }) {
  const clock = { now: 1_000_000 };
  const slept = [];
  const dir = mkdtempSync(join(tmpdir(), "eroype-"));
  const logs = [];
  const notes = [];
  const held = { value: false };
  const logFile = join(dir, "eroype-posted.log");
  const poster = createEroypePoster({
    config,
    logFile,
    log: (m) => logs.push(m),
    notify: (m) => notes.push(m),
    isHeld: () => held.value,
    now: () => clock.now,
    sleep: async (ms) => {
      slept.push(ms);
      clock.now += ms;
    },
  });
  return { poster, logs, notes, held, logFile, clock, slept, page: fakePage(over) };
}

test("設定: 書かなければ使わない。書けば初期値で補う。eroype.net 以外の宛先は受け付けない", () => {
  assert.equal(eroypeConfig({}).enabled, false);
  assert.equal(eroypeConfig({ eroype: { enabled: false } }).enabled, false);
  const on = eroypeConfig({ eroype: { enabled: true } });
  assert.equal(on.enabled, true);
  assert.equal(on.url, "https://eroype.net/create");
  assert.equal(on.textSelector, "#message");
  assert.equal(on.submitSelector, 'button[type="submit"]');
  assert.deepEqual(on.tags, []);
  assert.equal(eroypeConfig({ eroype: { enabled: true, readyWaitSeconds: 5 } }).readyWaitSeconds, 5);
  assert.throws(() => eroypeConfig({ eroype: { enabled: true, url: "https://discord-ch.site/create" } }), /eroype\.net ではありません/);
  assert.throws(() => eroypeConfig({ eroype: { enabled: true, url: "not a url" } }), /eroype\.net ではありません/);
  // タグは最大5個の文字列
  assert.deepEqual(eroypeConfig({ eroype: { enabled: true, tags: ["a", "b"] } }).tags, ["a", "b"]);
  assert.throws(() => eroypeConfig({ eroype: { enabled: true, tags: ["1", "2", "3", "4", "5", "6"] } }), /最大5個/);
  assert.throws(() => eroypeConfig({ eroype: { enabled: true, tags: [""] } }), /最大5個/);
});

test("失敗のあと: 403/429 はすぐやめる。ほかは3回続くまで次の回に任せる", () => {
  assert.equal(afterFailure({ failures: 1, status: 403 }), "stop");
  assert.equal(afterFailure({ failures: 1, status: 429 }), "stop");
  assert.equal(afterFailure({ failures: 1, status: 500 }), "retry");
  assert.equal(afterFailure({ failures: 2 }), "retry");
  assert.equal(afterFailure({ failures: 3 }), "stop");
});

test("使わない設定なら、ページに触れない", async () => {
  const t = setup({}, {});
  assert.deepEqual(await t.poster.postTogether(t.page, "文"), { status: "off" });
  assert.equal(t.page.calls.goto.length, 0);
});

test("文をキーを打つ形で入れ、投稿ボタンが押せるときに送って、記録する", async () => {
  const t = setup();
  const r = await t.poster.postTogether(t.page, "あまあま寝落ち\n連絡ください");
  assert.equal(r.status, "posted");
  assert.deepEqual(t.page.calls.goto, ["https://eroype.net/create"]);
  assert.deepEqual(t.page.calls.typed, ["あまあま寝落ち\n連絡ください"]);
  assert.equal(t.page.calls.clicked, 1);
  const line = JSON.parse(readFileSync(t.logFile, "utf8").trim());
  assert.equal(line.text, "あまあま寝落ち / 連絡ください");
  assert.equal(line.status, 201);
  assert.equal(t.poster.todayCount(), 1);
});

test("投稿の通信だけを待つ（画面が先に呼ぶプロフィールの保存や、Cloudflare の計測は待たない）", async () => {
  const t = setup();
  await t.poster.postTogether(t.page, "文");
  const pred = t.page.calls.responsePredicate;
  const res = (method, url) => ({ request: () => ({ method: () => method }), url: () => url });
  assert.equal(pred(res("POST", "https://eroype.net/api/sp/posts")), true);
  assert.equal(pred(res("POST", "https://eroype.net/api/profile")), false);
  assert.equal(pred(res("POST", "https://eroype.net/cdn-cgi/rum")), false);
  assert.equal(pred(res("GET", "https://eroype.net/api/sp/posts")), false);
  assert.equal(pred(res("POST", "https://example.com/api/sp/posts")), false);
});

test("冷却の残りが短ければ（150秒まで）、その分待って、もう一度だけ送る", async () => {
  const t = setup({ status: 429, body: { remainMs: 60 * 1000 } });
  // 1回目は冷却中、待ったあとの2回目は通る
  const original = t.page.waitForResponse;
  let n = 0;
  t.page.waitForResponse = async (pred) => {
    n++;
    if (n === 2) {
      t.page.state.status = 201;
      t.page.state.body = null;
    }
    return original(pred);
  };
  const r = await t.poster.postTogether(t.page, "文");
  assert.equal(r.status, "posted");
  assert.deepEqual(t.slept, [63000]); // 残り60秒＋余裕3秒
  assert.equal(t.page.calls.goto.length, 2); // 開き直している
  assert.equal(t.page.calls.typed.length, 2);
});

test("待ったあとにもう一度冷却と言われたら、そこで見送る（待ちを重ねない）", async () => {
  const t = setup({ status: 429, body: { remainMs: 30 * 1000 } });
  const r = await t.poster.postTogether(t.page, "文");
  assert.equal(r.status, "cooldown");
  assert.equal(t.slept.length, 1);
});

test("待っているあいだに止められたら、送らずに見送る", async () => {
  const t = setup({ status: 429, body: { remainMs: 30 * 1000 } });
  const sleepOrig = t.slept;
  const original = t.page.waitForResponse;
  t.page.waitForResponse = async (pred) => {
    t.held.value = true; // 待ちに入る前後で止められた
    return original(pred);
  };
  const r = await t.poster.postTogether(t.page, "文");
  assert.equal(r.status, "held");
  assert.equal(sleepOrig.length, 1);
});

test("冷却中（HTTP 429）は失敗でもやめるでもない。残り時間のあいだはページも開かず、過ぎたらまた送る", async () => {
  const t = setup({ status: 429, body: { remainMs: 5 * 60 * 1000 } });
  const first = await t.poster.postTogether(t.page, "文");
  assert.equal(first.status, "cooldown");
  assert.equal(first.remainMs, 300000);
  assert.equal(t.notes.length, 0);
  assert.match(t.logs.at(-1), /あと約5分/);

  const opened = t.page.calls.goto.length;
  t.clock.now += 4 * 60 * 1000;
  assert.equal((await t.poster.postTogether(t.page, "文")).status, "cooldown");
  assert.equal(t.page.calls.goto.length, opened); // 開いてもいない

  t.clock.now += 61 * 1000;
  t.page.state.status = 201;
  assert.equal((await t.poster.postTogether(t.page, "文")).status, "posted");
  assert.equal(t.page.calls.goto.length, opened + 1);
});

test("冷却中でも残り時間が分からなければ10分とみなす。何度続いても、やめない", async () => {
  const t = setup({ status: 429, body: null });
  const r = await t.poster.postTogether(t.page, "文");
  assert.equal(r.remainMs, 600000);
  assert.equal(t.slept.length, 0); // 10分は長すぎるので待たない
  for (let i = 0; i < 5; i++) {
    t.clock.now += 11 * 60 * 1000;
    assert.equal((await t.poster.postTogether(t.page, "文")).status, "cooldown");
  }
});

test("タグを設定していれば、1つずつ入れる", async () => {
  const t = setup({}, { eroype: { enabled: true, tags: ["寝落ち", "あまあま"] } });
  assert.equal((await t.poster.postTogether(t.page, "文")).status, "posted");
  assert.deepEqual(t.page.calls.tags, ["寝落ち", "あまあま"]);
});

test("欄の上限を超える文は、切らずに見送る（失敗には数えず、何も入力しない）", async () => {
  const t = setup({ maxLength: 5 });
  assert.equal((await t.poster.postTogether(t.page, "123456")).status, "toolong");
  assert.equal(t.page.calls.typed.length, 0);
  assert.equal((await t.poster.postTogether(t.page, "12345")).status, "posted");
});

test("文が欄に入りきっていなければ、送らず失敗に数える", async () => {
  const t = setup({ typedValue: "半分だけ" });
  assert.equal((await t.poster.postTogether(t.page, "文は全部で長い")).status, "failed");
  assert.equal(t.page.calls.clicked, 0);
});

test("投稿ボタンが押せないままなら（冷却中など）、見送る。失敗には数えず、やめもしない", async () => {
  const t = setup({ enabled: false });
  for (let i = 0; i < 5; i++) assert.equal((await t.poster.postTogether(t.page, "文")).status, "cooldown");
  assert.equal(t.page.calls.clicked, 0);
  assert.equal(existsSync(t.logFile), false);
  t.page.state.enabled = true;
  assert.equal((await t.poster.postTogether(t.page, "文")).status, "posted");
});

test("ログインが切れていれば、通知して見送る。ログインし直せば次の回から再開。通知は続けて鳴らさない", async () => {
  const t = setup({ landed: "https://eroype.net/login" });
  assert.equal((await t.poster.postTogether(t.page, "文")).status, "login");
  assert.equal((await t.poster.postTogether(t.page, "文")).status, "login");
  assert.equal(t.notes.length, 1);
  t.page.state.landed = "https://eroype.net/create";
  assert.equal((await t.poster.postTogether(t.page, "文")).status, "posted");
});

test("認証の値が入らなければ、見送る（手で押すのを待ってディスコード側を止めない）。認証の枠が無い画面なら待たずに送る", async () => {
  const t = setup({ token: false });
  assert.equal((await t.poster.postTogether(t.page, "文")).status, "turnstile");
  assert.equal(t.page.calls.typed.length, 0);
  t.page.state.turnstile = false;
  assert.equal((await t.poster.postTogether(t.page, "文")).status, "posted");
});

test("止められている（画面の停止・STOP）あいだは、ページも開かない。送る直前に止められたら見送る", async () => {
  const t = setup();
  t.held.value = true;
  assert.equal((await t.poster.postTogether(t.page, "文")).status, "held");
  assert.equal(t.page.calls.goto.length, 0);

  t.held.value = false;
  const original = t.page.waitForTimeout;
  t.page.waitForTimeout = async () => {
    t.held.value = true; // 待っているあいだに止められた
    await original();
  };
  assert.equal((await t.poster.postTogether(t.page, "文")).status, "held");
  assert.equal(t.page.calls.clicked, 0);
});

test("HTTP 403 ならすぐやめ、以後はページを開かない（ディスコード側には影響しない）", async () => {
  const t = setup({ status: 403 });
  assert.equal((await t.poster.postTogether(t.page, "文")).status, "stopped");
  assert.equal(t.notes.length, 1);
  const opened = t.page.calls.goto.length;
  assert.equal((await t.poster.postTogether(t.page, "文")).status, "stopped");
  assert.equal(t.page.calls.goto.length, opened);
});

test("投稿できた様子が無い失敗は、3回続いたらやめる。途中で成功すれば数え直す", async () => {
  const t = setup({ posted: false });
  assert.equal((await t.poster.postTogether(t.page, "文")).status, "failed");
  assert.equal((await t.poster.postTogether(t.page, "文")).status, "failed");
  t.page.state.posted = true;
  assert.equal((await t.poster.postTogether(t.page, "文")).status, "posted");
  t.page.state.posted = false;
  assert.equal((await t.poster.postTogether(t.page, "文")).status, "failed");
  assert.equal((await t.poster.postTogether(t.page, "文")).status, "failed");
  assert.equal((await t.poster.postTogether(t.page, "文")).status, "stopped");
  assert.equal(readFileSync(t.logFile, "utf8").trim().split("\n").length, 1);
});

test("投稿の通信が出なければ、失敗に数える", async () => {
  const t = setup({ noPost: true });
  assert.equal((await t.poster.postTogether(t.page, "文")).status, "failed");
  assert.match(t.logs.at(-1), /送信の結果が確認できません/);
});

test("ページ操作で例外が出ても、呼び出し元には投げない", async () => {
  const t = setup();
  t.page.locator = () => {
    throw new Error("画面が閉じられた");
  };
  const r = await t.poster.postTogether(t.page, "文");
  assert.equal(r.status, "failed");
  assert.match(t.logs.at(-1), /エラー: 画面が閉じられた/);
});

test("1日の上限に達したら、ページも開かない", async () => {
  const t = setup({}, { eroype: { enabled: true, dailyCap: 1 } });
  assert.equal((await t.poster.postTogether(t.page, "文")).status, "posted");
  const opened = t.page.calls.goto.length;
  assert.equal((await t.poster.postTogether(t.page, "文")).status, "cap");
  assert.equal(t.page.calls.goto.length, opened);
});

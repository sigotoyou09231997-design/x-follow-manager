// node --test poster/discord/cloud-client.test.mjs
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { parseState, pullState, pushStatus } from "./cloud-client.mjs";

const cloud = { url: "http://cloud.test", token: "key" };
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const reply = (status, body) => async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("止められていなくて文が使えるなら、そのまま文を返す", () => {
  assert.deepEqual(parseState({ messages: [" a ", "b"], paused: false }), { paused: false, messages: ["a", "b"], problem: null });
});

test("止める機能より前のサーバー（paused を返さない）は、止められていない扱い", () => {
  assert.equal(parseState({ messages: ["a"] }).paused, false);
});

test("止められているあいだは、文が空でも止められていることを読み取る", () => {
  assert.deepEqual(parseState({ messages: [], paused: true }), { paused: true, messages: null, problem: "文が1つもありません" });
});

test("止められていないのに文が使えなければ、理由（problem）を返す（呼び出し側は手元の文で続ける）", () => {
  const state = parseState({ messages: [""], paused: false });
  assert.equal(state.paused, false);
  assert.equal(state.messages, null);
  assert.ok(state.problem);
});

test("paused が文字列の \"true\" などでも、真とは読まない", () => {
  assert.equal(parseState({ messages: ["a"], paused: "true" }).paused, false);
  assert.equal(parseState({ messages: ["a"], paused: 1 }).paused, false);
});

test("pullState: 止められていれば paused: true を返す", async () => {
  globalThis.fetch = reply(200, { messages: ["a"], updatedAt: null, paused: true, pausedAt: "2026-10-07T12:10:00.000Z" });
  assert.deepEqual(await pullState(cloud), { paused: true, messages: ["a"], problem: null });
});

test("pullState: 404（文がまだ保存されていない）は、止められてはいない", async () => {
  globalThis.fetch = reply(404, { error: "文がまだ保存されていません" });
  assert.deepEqual(await pullState(cloud), { paused: false, messages: null, problem: "文がまだ保存されていません" });
});

test("pullState: 通信やサーバーの失敗は投げる（呼び出し側は最後に分かっていた状態のまま続ける）", async () => {
  globalThis.fetch = reply(500, { error: "サーバーでエラーが起きました" });
  await assert.rejects(pullState(cloud), /HTTP 500/);
  globalThis.fetch = reply(401, { error: "unauthorized" });
  await assert.rejects(pullState(cloud), /HTTP 401/);
  globalThis.fetch = async () => {
    throw new TypeError("fetch failed");
  };
  await assert.rejects(pullState(cloud), /fetch failed/);
});

test("pushStatus: いま止まっているかを真偽値で送る（無ければ false）", async () => {
  const sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  };
  await pushStatus(cloud, { lastPost: null, today: 2, paused: true });
  await pushStatus(cloud, { lastPost: null, today: 2 });
  assert.equal(sent[0].url, "http://cloud.test/api/poster-status");
  assert.equal(sent[0].body.paused, true);
  assert.equal(sent[1].body.paused, false);
});

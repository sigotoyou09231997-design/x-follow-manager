// node --test poster/yay/cloud.test.mjs
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { parseState, pullState, pushStatus } from "./cloud.mjs";

const cloud = { url: "http://cloud.test", token: "key" };
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const reply = (status, body) => async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("止められていなくて文が使えるなら、そのまま文を返す", () => {
  assert.deepEqual(parseState({ messages: ["  やっほー\r\n"], paused: false }), { paused: false, text: "やっほー", problem: null });
});

test("止める機能より前のサーバー（paused を返さない）は、止められていない扱い", () => {
  assert.equal(parseState({ messages: ["a"] }).paused, false);
});

test("止められているあいだは、文が空でも止められていることを読み取る", () => {
  assert.deepEqual(parseState({ messages: [], paused: true }), { paused: true, text: null, problem: "文が空です" });
});

test("止められていないのに文が使えなければ、理由（problem）を返す（呼び出し側は手元の文で続ける）", () => {
  assert.deepEqual(parseState({ messages: [], paused: false }), { paused: false, text: null, problem: "文が空です" });
  assert.match(parseState({ messages: ["あ".repeat(1001)], paused: false }).problem, /文が長すぎます/);
});

test("paused が文字列の \"true\" などでも、真とは読まない", () => {
  assert.equal(parseState({ messages: ["a"], paused: "true" }).paused, false);
});

test("pullState: 止められていれば paused: true を返す", async () => {
  globalThis.fetch = reply(200, { messages: ["a"], paused: true });
  assert.deepEqual(await pullState(cloud), { paused: true, text: "a", problem: null });
});

test("pullState: 404（文がまだ保存されていない）は、止められてはいない", async () => {
  globalThis.fetch = reply(404, { error: "文がまだ保存されていません" });
  assert.deepEqual(await pullState(cloud), { paused: false, text: null, problem: "文がまだ保存されていません" });
});

test("pullState: 通信やサーバーの失敗は投げる（呼び出し側は最後に分かっていた状態のまま続ける）", async () => {
  globalThis.fetch = reply(500, { error: "サーバーでエラーが起きました" });
  await assert.rejects(pullState(cloud), /HTTP 500/);
});

test("pullState / pushStatus は投稿先 yay の枠（ch=yay）を使う", async () => {
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return new Response(JSON.stringify({ messages: ["a"] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  await pullState(cloud);
  await pushStatus(cloud, { lastPost: null, today: 0, paused: false });
  assert.deepEqual(urls, ["http://cloud.test/api/poster-text?ch=yay", "http://cloud.test/api/poster-status?ch=yay"]);
});

test("pushStatus: いま止まっているかを真偽値で送る（無ければ false）", async () => {
  const bodies = [];
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  };
  await pushStatus(cloud, { lastPost: null, today: 2, paused: true });
  await pushStatus(cloud, { lastPost: null, today: 2 });
  assert.equal(bodies[0].paused, true);
  assert.equal(bodies[1].paused, false);
});

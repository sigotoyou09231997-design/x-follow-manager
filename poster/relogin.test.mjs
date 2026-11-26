import { test } from "node:test";
import assert from "node:assert/strict";
import { createReloginGate, judgeDiscordConsent, passGooglePopup } from "./relogin.mjs";

// 2026-11-26 のログ・実際の許可画面に出た URL（state など毎回変わる所は適当な値）
const BOARD =
  "https://discord.com/oauth2/authorize?client_id=1278321645123010663&redirect_uri=https%3A%2F%2Fdiscord-ch.site%2Fauth%2Fdiscord%2Fcallback&scope=identify+email+guilds&response_type=code&state=x&prompt=none";
const EROYPE =
  "https://discord.com/oauth2/authorize?scope=identify+email&response_type=code&client_id=1477011382099771392&redirect_uri=https%3A%2F%2Feroype.net%2Fapi%2Fauth%2Fcallback%2Fdiscord&state=x";
const DISSOKU =
  "https://discord.com/oauth2/authorize?client_id=761562078095867916&redirect_uri=https%3A%2F%2Fdissoku.net%2Faccounts%2Fdiscord%2Flogin%2Fcallback&response_type=code&scope=identify+guilds&state=x";

test("いつもの3つのサイトの許可画面は、押してよい", () => {
  assert.equal(judgeDiscordConsent(BOARD).ok, true);
  assert.equal(judgeDiscordConsent(EROYPE).ok, true);
  assert.equal(judgeDiscordConsent(DISSOKU).ok, true);
});

test("知らないアプリ・いつもより多い許可・別の戻り先・Discord 以外では押さない", () => {
  assert.match(judgeDiscordConsent(BOARD.replace("1278321645123010663", "999")).reason, /知らないアプリ/);
  // サーバーに参加させる・ボットとして入れる、は今までに求められたことがない
  assert.match(judgeDiscordConsent(EROYPE.replace("scope=identify+email", "scope=identify+email+guilds.join")).reason, /多い許可/);
  assert.match(judgeDiscordConsent(DISSOKU.replace("scope=identify+guilds", "scope=identify+guilds+bot")).reason, /多い許可/);
  assert.match(judgeDiscordConsent(BOARD.replace("discord-ch.site", "evil.example")).reason, /戻り先/);
  assert.match(judgeDiscordConsent(BOARD.replace("https%3A%2F%2F", "http%3A%2F%2F")).reason, /戻り先/);
  assert.equal(judgeDiscordConsent(BOARD.replace("discord.com", "discord.com.evil.example")).ok, false);
  assert.equal(judgeDiscordConsent("https://discord.com/login").ok, false);
  assert.equal(judgeDiscordConsent("なにか").ok, false);
});

test("ログインし直しは1時間に1回まで（すぐまた切れるなら、止まって本人に任せる）", () => {
  let t = 0;
  const gate = createReloginGate({ now: () => t });
  assert.equal(gate.take(), true);
  t = 30 * 60 * 1000;
  assert.equal(gate.take(), false);
  t = 61 * 60 * 1000;
  assert.equal(gate.take(), true);
});

// Google のログインの窓の偽物。screens を1つずつ進む
function fakePopup(screens) {
  let i = 0;
  const clicks = [];
  const cur = () => screens[Math.min(i, screens.length - 1)];
  const popup = {
    clicks,
    isClosed: () => cur() === "closed",
    url: () => "https://accounts.google.com/x",
    locator: (sel) => ({
      first: () => ({ isVisible: async () => sel.includes("password") && cur() === "password" }),
      count: async () => (sel.includes("data-identifier") && cur().ids ? cur().ids.length : 0),
      evaluateAll: async () => cur().ids,
      nth: (n) => ({
        click: async () => {
          clicks.push(cur().ids[n]);
          i++;
        },
      }),
    }),
    getByRole: () => ({
      first: () => ({
        isVisible: async () => cur() === "continue",
        click: async () => {
          clicks.push("続行");
          i++;
        },
      }),
    }),
    close: async () => {},
  };
  return popup;
}

test("Google: アカウントが1つなら選び、続行を押し、窓が閉じたら通った", async () => {
  const p = fakePopup([{ ids: ["a@example.com"] }, "continue", "closed"]);
  assert.deepEqual(await passGooglePopup(p, { timeoutMs: 60000 }), { status: "done" });
  assert.deepEqual(p.clicks, ["a@example.com", "続行"]);
});

test("Google: パスワードを求められたら押さない", async () => {
  const p = fakePopup(["password"]);
  assert.equal((await passGooglePopup(p, { timeoutMs: 5000 })).status, "refused");
  assert.deepEqual(p.clicks, []);
});

test("Google: 候補が複数で、決めたアカウントが無ければ選ばない。決めてあればそれを選ぶ", async () => {
  const two = { ids: ["a@example.com", "b@example.com"] };
  const p = fakePopup([two]);
  assert.match((await passGooglePopup(p, { timeoutMs: 5000 })).reason, /決まらない/);
  assert.deepEqual(p.clicks, []);
  const q = fakePopup([two, "closed"]);
  assert.equal((await passGooglePopup(q, { account: "B@example.com", timeoutMs: 60000 })).status, "done");
  assert.deepEqual(q.clicks, ["b@example.com"]);
});

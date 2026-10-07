// yay.space の画面を操作する部品（専用 Chrome にログイン済みの画面へ CDP でつなぐ）。
//   タイムライン  : https://yay.space/            ("timeline")
//   サークル      : https://yay.space/group/<番号> ("group:<番号>")
// 投稿は「画面の投稿欄に入れて『投稿』を押す」、削除は「カードの … → 削除 → はい」。
// 画面の作りに依存するので、見つからないときは推測せず投げる（呼び出し側は止まる）。
// playwright は、このアプリ（poster/ の2つ上）の node_modules を使う（poster/discord と同じ）。
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(HERE, "../../node_modules/"));
const { chromium } = require("playwright");

export const PORT = 9334;
const COMPOSER = "textarea[placeholder='気軽につぶやいてみよう！']";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const same = (a, b) => a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();

export const urlOf = (target) =>
  target === "timeline" ? "https://yay.space/" : `https://yay.space/group/${target.replace(/^group:/, "")}`;

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PROFILE = join(HERE, "chrome-profile");

// 専用 Chrome（chrome-profile/）へつなぐ。起動していなければ自分で起動する（ログインはプロフィールに残っている）。
// タブが1枚も無いと Playwright が接続に失敗するので、その場合はタブを開き直す
async function attach() {
  try {
    return await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  } catch (e) {
    if (/Browser context management is not supported/.test(e.message)) {
      await fetch(`http://127.0.0.1:${PORT}/json/new?https://yay.space/`, { method: "PUT" }).catch(() => {});
      await sleep(1500);
      return await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
    }
    throw e;
  }
}

export async function connect() {
  let browser = await attach().catch(() => null);
  if (!browser) {
    spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, "--no-first-run", "--no-default-browser-check", "https://yay.space/"], { detached: true, stdio: "ignore" }).unref();
    for (let i = 0; i < 40 && !browser; i++) {
      await sleep(1000);
      browser = await attach().catch(() => null);
    }
    if (!browser) throw new Error("Chrome に接続できません");
  }
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => !p.isClosed() && p.url().includes("yay.space")) ?? (await ctx.newPage());
  return { browser, page };
}

// 投稿欄のある画面を開く。ログインが切れていたら投げる
export async function openTarget(page, target) {
  await page.goto(urlOf(target), { waitUntil: "domcontentloaded" });
  try {
    await page.locator(COMPOSER).first().waitFor({ state: "visible", timeout: 20000 });
  } catch {
    const loggedOut = await page.getByText("ログイン", { exact: false }).first().isVisible().catch(() => false);
    throw new Error(loggedOut ? `ログインが切れています (${page.url()})` : `投稿欄が見つかりません (${page.url()})`);
  }
  await page.locator(".PostList__item").first().waitFor({ state: "attached", timeout: 15000 }).catch(() => {});
}

// 自分のユーザー番号（ヘッダーの「プロフィールを見る」のリンクから）。途中で変わらないので、一度読んだら覚える
// （投稿そのもののページなど、作りの違うページではこのリンクが出ないため）
let cachedSelf = null;
export async function selfId(page) {
  if (cachedSelf) return cachedSelf;
  for (let i = 0; i < 20; i++) {
    const href = await page.evaluate(() => {
      const a = [...document.querySelectorAll("a[href^='/user/']")].find((x) => x.innerText.includes("プロフィールを見る"));
      return a?.getAttribute("href") ?? "";
    });
    const m = /\/user\/(\d+)/.exec(href);
    if (m) return (cachedSelf = m[1]);
    await sleep(500);
  }
  throw new Error("自分のユーザー番号を読み取れません（ログイン状態を確認してください）");
}

// 参加中のサークルの一覧: [{ id, name }]。「サークル」の画面（/groups）が自分で取りにいく
// サーバーの答え（GET /v2/groups/mine）をそのまま読む。画面の作りではなく答えの中身を見るので、
// 見た目が変わっても影響されにくい。形が想定と違うときは推測せず投げる（呼び出し側は前の一覧で続ける）
export async function listJoinedGroups(page) {
  const reply = page.waitForResponse((r) => new URL(r.url()).pathname === "/v2/groups/mine", { timeout: 25000 });
  reply.catch(() => {});
  await page.goto("https://yay.space/groups", { waitUntil: "domcontentloaded" });
  const res = await reply.catch(() => null);
  if (!res) throw new Error("参加中のサークルの一覧を取得できません（サーバーの答えが無い）");
  if (res.status() !== 200) throw new Error(`参加中のサークルの一覧を取得できません（HTTP ${res.status()}）`);
  const body = await res.json().catch(() => null);
  if (!body || body.result !== "success" || !Array.isArray(body.groups)) {
    throw new Error("参加中のサークルの一覧の形が想定と違います");
  }
  const seen = new Set();
  const groups = [];
  // pinned_groups（ピン留め）が groups と別に返ることがあるので、両方から集めて番号で重複を除く
  for (const g of [...body.groups, ...(Array.isArray(body.pinned_groups) ? body.pinned_groups : [])]) {
    const id = String(g?.id ?? "");
    if (!/^\d+$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    groups.push({ id, name: String(g.topic ?? g.title ?? "") });
  }
  return groups;
}

// 画面に出ている投稿の一覧: [{ id, user, text }]
export function listPosts(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll(".PostList__item")]
      .map((el) => {
        const link = [...el.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")).find((h) => /\/post\/\d+/.test(h)) ?? "";
        const user = /^\/user\/(\d+)/.exec(el.querySelector("a[href^='/user/']")?.getAttribute("href") ?? "");
        return { id: /\/post\/(\d+)/.exec(link)?.[1], user: user?.[1], text: el.querySelector(".PostText")?.innerText ?? "" };
      })
      .filter((p) => p.id),
  );
}

// 画面の投稿欄は、クリックすると入力用の本物の欄（編集用の部品）に入れ替わる。
// textarea に fill しても「投稿」ボタンが有効にならないので、クリックして実際にキー入力する
async function typeIntoComposer(page, text) {
  await page.locator(COMPOSER).first().click({ timeout: 10000 });
  await sleep(500);
  const active = await page.evaluate(() => ({ tag: document.activeElement?.tagName, ce: document.activeElement?.isContentEditable }));
  if (!(active.ce || active.tag === "TEXTAREA")) throw new Error(`投稿欄にカーソルが入りません (${active.tag})`);
  await page.keyboard.insertText(text);
  await sleep(500);
  const typed = await page.evaluate(() => document.activeElement?.innerText ?? document.activeElement?.value ?? "");
  if (!same(typed, text)) throw new Error(`投稿欄の文が一致しません: ${JSON.stringify(typed.slice(0, 40))}`);
}

async function clearComposer(page) {
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Backspace");
  await sleep(300);
}

// 有効な（押せる）「投稿」ボタンはちょうど1つのはず。そうでなければ押さずに投げる
async function enabledPostButton(page) {
  const buttons = page.locator("button:visible:not([disabled])", { hasText: /^投稿$/ });
  for (let i = 0; i < 20 && (await buttons.count()) === 0; i++) await sleep(250);
  const n = await buttons.count();
  if (n !== 1) throw new Error(`押せる「投稿」ボタンが${n}個あります（1個のはず）。押さずに止めます`);
  return buttons.first();
}

// 投稿して、できた投稿の番号を返す。dry なら文を入れるだけで送らない。
// 番号は画面から探さず、サーバーの返事（POST /api/posts）に入っているものを使う。
// 返事が「成功」で、番号と文が一致したときだけ採用する（画面の一覧は反映が遅れたり別のページに移ったりする）
export async function createPost(page, text, { target = "timeline", dry = false } = {}) {
  await typeIntoComposer(page, text);
  const button = await enabledPostButton(page);
  if (dry) {
    await clearComposer(page);
    return { dry: true, buttonWasEnabled: true };
  }
  const reply = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/posts", { timeout: 30000 });
  await button.click({ timeout: 10000 });
  const res = await reply;
  const raw = await res.text().catch(() => "");
  let body = null;
  try {
    body = JSON.parse(raw);
  } catch {}
  if (res.status() >= 400 || body?.result !== "success" || !/^\d+$/.test(String(body?.id ?? ""))) {
    const e = new Error(`投稿が受け付けられませんでした: HTTP ${res.status()} ${raw.slice(0, 160)}`);
    e.status = res.status();
    throw e;
  }
  const wantGroup = target === "timeline" ? null : Number(target.replace(/^group:/, ""));
  if ((body.group_id ?? null) !== wantGroup || !same(body.text ?? "", text)) {
    throw new Error(`投稿先か文が想定と違います（番号 ${body.id} / group_id=${body.group_id}）。手で確認してください`);
  }
  return { id: String(body.id), createdAt: body.created_at };
}

// 画面の一覧にその投稿のカードが出るまで待つ（読み直しながら）。出なければ投げる
export async function waitForCard(page, target, id, timeoutMs = 120000) {
  const t0 = Date.now();
  while (true) {
    await openTarget(page, target);
    await sleep(2000);
    if (await stillThere(page, id)) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > timeoutMs) throw new Error(`投稿 ${id} が一覧に${Math.round(timeoutMs / 1000)}秒たっても出ません`);
    await sleep(5000);
  }
}

// 画面には他の確認画面の部品（ブロック・辞退など）も隠れて並んでいて、「はい」が複数ある。
// 「この投稿を削除」の確認画面の中の、いちばん手前に出ている「はい」だけを押す。1つに絞れなければ押さない
export async function confirmDelete(page) {
  const hit = await page.evaluate(() => {
    const hits = [...document.querySelectorAll("button")]
      .filter((b) => b.innerText.trim() === "はい")
      .map((b) => {
        const r = b.getBoundingClientRect();
        const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        const box = b.closest(".ConfirmBox");
        const ok = r.width > 0 && (top === b || b.contains(top)) && !!box && box.innerText.includes("この投稿を削除");
        return { ok, x: r.x + r.width / 2, y: r.y + r.height / 2 };
      })
      .filter((h) => h.ok);
    return { n: hits.length, ...hits[0] };
  });
  if (hit.n !== 1) throw new Error(`削除の確認の『はい』を特定できません（${hit.n}個）。押さずに止めます`);
  await page.mouse.click(hit.x, hit.y);
}

// 番号を指定して、自分の投稿だけを消す。自分の投稿でなければ消さずに投げる
export async function deletePost(page, id) {
  const me = await selfId(page);
  const card = page.locator(".PostList__item", { has: page.locator(`a[href*="/post/${id}/"]`) }).first();
  if (!(await card.count())) throw new Error(`投稿 ${id} が画面に見つかりません`);
  if (!(await card.locator(`a[href="/user/${me}"]`).count())) throw new Error(`投稿 ${id} は自分の投稿ではないので消しません`);
  await card.locator(".Menu__handle").first().click({ timeout: 10000 });
  await card.locator(".Menu__panel__ul__a", { hasText: /^削除$/ }).first().click({ timeout: 10000 });
  await confirmDelete(page);
  await card.waitFor({ state: "detached", timeout: 15000 });
}

export const postUrl = (target, id) =>
  target === "timeline" ? `https://yay.space/post/${id}` : `https://yay.space/group/${target.replace(/^group:/, "")}/post/${id}`;

// 投稿そのもののページを開いて、サーバーの答え（GET /v2/posts/<番号>）で確かめる: 200 = ある / 404 = 消えている。
// 「一覧に出てこない」は消えた証拠にならない（一覧が読めていない・流れて見えないだけのことがある）ので、これを使う。
// どちらとも言えないときは推測せず投げる
export async function postState(page, target, id) {
  const reply = page.waitForResponse((r) => new URL(r.url()).pathname === `/v2/posts/${id}`, { timeout: 20000 });
  reply.catch(() => {});
  await page.goto(postUrl(target, id), { waitUntil: "domcontentloaded" });
  const res = await reply.catch(() => null);
  if (!res) throw new Error(`投稿 ${id} の状態を確認できません（サーバーの答えが無い）`);
  if (res.status() === 200) return "exists";
  if (res.status() === 404) return "deleted";
  throw new Error(`投稿 ${id} の状態を確認できません（HTTP ${res.status()}）`);
}

export async function stillThere(page, id) {
  return (await listPosts(page)).some((p) => p.id === id);
}

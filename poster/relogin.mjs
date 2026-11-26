// ログインが切れたときに、投稿役が自分でログインし直すための部品（2026-11-26、本人「毎回切れたら、今の工程を覚えて実行して欲しい」）。
//
// その日に手でやった手順を、そのままなぞる:
//   ・掲示板（discord-ch.site）・eroype・ディス速 … どれも「Discord でログイン」。専用 Chrome の Discord のログインは
//     生きているので、Discord の許可画面（oauth2/authorize）で「認証」を押すだけで戻る。
//   ・Yay … 「Google で続ける」。専用 Chrome に Google のログインが残っているので、押すだけで（またはアカウントを選ぶだけで）戻る。
//
// 押してよいのは、次の全部が揃っているときだけ。1つでも外れたら押さずに「できない」と返し、呼び出し元が今までどおり止まって知らせる。
//   ・パスワードを打つ画面が出ていない（パスワードは扱わない。そこから先は本人がやる）
//   ・許可を求めているのが、下の一覧にあるアプリ（client_id）で、戻り先がそのサイト、求める中身（scope）がいつもの範囲の内
//     — 見知らぬアプリや、いつもより多い中身（サーバーに参加させる・代わりに発言する 等）を勝手に許可しないため
//   ・Google では、選ぶアカウントが1つに決まる（config の googleAccount と一致する／候補が1つだけ）

/** 許可してよい Discord のアプリ。2026-11-26 に実際の許可画面・ログの URL で確かめた値 */
export const DISCORD_APPS = {
  "1278321645123010663": { name: "掲示板（discord-ch.site）", host: "discord-ch.site", scopes: ["identify", "email", "guilds"] },
  "1477011382099771392": { name: "eroype", host: "eroype.net", scopes: ["identify", "email"] },
  "761562078095867916": { name: "ディス速", host: "dissoku.net", scopes: ["identify", "guilds"] },
};

/**
 * Discord の許可画面の URL を見て、押してよいかを決める（画面に触らない判定だけ。テストできるように分けてある）。
 * @returns {{ ok: true, app: object } | { ok: false, reason: string }}
 */
export function judgeDiscordConsent(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, reason: "URL を読めない" };
  }
  if (u.hostname !== "discord.com" || !/^\/(api\/)?oauth2\/authorize\/?$/.test(u.pathname)) return { ok: false, reason: "Discord の許可画面ではない" };
  const app = DISCORD_APPS[u.searchParams.get("client_id") ?? ""];
  if (!app) return { ok: false, reason: `知らないアプリ（client_id=${u.searchParams.get("client_id")}）` };
  let back;
  try {
    back = new URL(u.searchParams.get("redirect_uri") ?? "");
  } catch {
    return { ok: false, reason: "戻り先が読めない" };
  }
  if (back.protocol !== "https:" || back.hostname !== app.host) return { ok: false, reason: `戻り先が ${app.host} ではない（${back.hostname}）` };
  const asked = (u.searchParams.get("scope") ?? "").split(/[\s+]+/).filter(Boolean);
  const extra = asked.filter((s) => !app.scopes.includes(s));
  if (extra.length) return { ok: false, reason: `いつもより多い許可を求めている（${extra.join(", ")}）` };
  return { ok: true, app };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function passwordShown(page) {
  return page
    .locator("input[type=password]")
    .first()
    .isVisible()
    .catch(() => false);
}

/**
 * いま開いている画面が Discord の許可画面なら、確かめてから「認証」を押し、サイトへ戻るのを待つ。
 * @returns {Promise<{ status: "approved" | "not-consent" | "refused", reason?: string }>}
 */
export async function approveDiscordConsent(page, { log = () => {} } = {}) {
  if (!/^https:\/\/discord\.com\//.test(page.url())) return { status: "not-consent" };
  // 許可画面が出るまで少し待つ（Discord の画面は後から組み立てる）
  await page
    .getByRole("button", { name: /^(認証|Authorize)$/ })
    .first()
    .waitFor({ state: "attached", timeout: 15000 })
    .catch(() => {});
  if (await passwordShown(page)) return { status: "refused", reason: "Discord のログインが切れていて、パスワードが要る" };
  const verdict = judgeDiscordConsent(page.url());
  if (!verdict.ok) return { status: "refused", reason: verdict.reason };

  // 「認証」は、中身を下まで送らないと押せない（disabled のまま）作り。箱を全部下まで送り、ホイールも回す
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("*")) if (el.scrollHeight > el.clientHeight + 5) el.scrollTop = el.scrollHeight;
  });
  const vp = page.viewportSize() ?? { width: 1000, height: 700 };
  await page.mouse.move(vp.width / 2, vp.height / 2).catch(() => {});
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, 400).catch(() => {});
    await sleep(150);
  }
  const ok = page.locator("button:not([disabled])", { hasText: /^(認証|Authorize)$/ }).first();
  if (!(await ok.isVisible().catch(() => false))) return { status: "refused", reason: "「認証」ボタンが押せる状態にならない" };
  log(`${verdict.app.name} の Discord の許可画面で「認証」を押します`);
  await ok.click();
  const back = await page
    .waitForURL((u) => new URL(u).hostname === verdict.app.host, { timeout: 20000 })
    .then(() => true, () => false);
  return back ? { status: "approved" } : { status: "refused", reason: `「認証」のあと ${verdict.app.host} へ戻らない` };
}

/**
 * Google のログインの窓（ポップアップ）を、パスワードを打たずに通せるところまで進める。
 * 窓が自分で閉じたら（＝通った）終わり。パスワードの画面・選べないアカウント一覧では押さずに返す。
 * @returns {Promise<{ status: "done" | "refused", reason?: string }>}
 */
export async function passGooglePopup(popup, { account, log = () => {}, timeoutMs = 45000 } = {}) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (popup.isClosed()) return { status: "done" };
    const url = popup.url();
    if (!/^https:\/\/accounts\.google\.com\//.test(url) && !url.startsWith("about:")) {
      // Google 以外（Yay 側の戻り先）に移ったら、Yay の画面が閉じるのを待つだけ
      await sleep(1000);
      continue;
    }
    if (await passwordShown(popup)) return { status: "refused", reason: "Google のパスワードを求められた" };
    // アカウントを選ぶ画面
    const items = popup.locator("[data-identifier]");
    const n = await items.count().catch(() => 0);
    if (n > 0) {
      const ids = await items.evaluateAll((els) => els.map((e) => e.getAttribute("data-identifier")));
      const pick = account ? ids.findIndex((id) => id?.toLowerCase() === account.toLowerCase()) : ids.length === 1 ? 0 : -1;
      if (pick < 0) return { status: "refused", reason: `選ぶ Google アカウントが決まらない（候補 ${ids.length} 件）` };
      log("Google のアカウントを選びます");
      await items.nth(pick).click().catch(() => {});
      await sleep(2500);
      continue;
    }
    // 「続行」だけの確認画面（同じアプリに前に許可したことがある時に出る）
    const cont = popup.getByRole("button", { name: /^(続行|Continue|次へ|Next)$/ }).first();
    if (await cont.isVisible().catch(() => false)) {
      log("Google の確認画面で「続行」を押します");
      await cont.click().catch(() => {});
      await sleep(2500);
      continue;
    }
    await sleep(1000);
  }
  return popup.isClosed() ? { status: "done" } : { status: "refused", reason: "Google の窓が進まない" };
}

/**
 * 自動のログインし直しを、短い間に何度もやらないための見張り。
 * ログインし直してもすぐまた切れるなら、何かがおかしい（アカウントの制限・パスワード変更 等）ので、止まって本人に任せる。
 */
export function createReloginGate({ minGapMs = 60 * 60 * 1000, now = () => Date.now() } = {}) {
  let last = null; // まだ一度も試していない（0 は時刻として正しい値なので、null で見分ける）
  return {
    /** いま試してよいか。よければ時刻を控える */
    take() {
      if (last !== null && now() - last < minGapMs) return false;
      last = now();
      return true;
    },
  };
}

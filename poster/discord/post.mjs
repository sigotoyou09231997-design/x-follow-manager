// discord-ch.site の「掲示板に募集する」へ、決めた文を順番に回して投稿する。
//
// 使い方:
//   node post.mjs --dry     … 文を入れるだけで送信しない（動作確認用）
//   node post.mjs --max 1   … 1回だけ投稿して終わる
//   node post.mjs           … 「今すぐ投稿できます」が出るたびに投稿し続ける
// 止めるとき: Ctrl-C、またはこのフォルダに STOP という名前のファイルを作る。
// Mac をスリープさせないために `caffeinate -i node post.mjs` で走らせる。
//
// 動かし方: 専用プロファイル(chrome-profile/)の Chrome へ DevTools で接続して操作する。
// Discord へのログインは手で一度だけ。Cloudflare の認証は Chrome が自動で通るので、
// こちらでは何も細工しない（通らなければ通知して、手で押すのを待つ）。
// playwright は、このアプリ（poster/ の2つ上）の node_modules を使う。
import { createRequire } from "node:module";
import { spawn, execFile } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readConfig, readMessages, saveMessages } from "./config.mjs";
import { loadCloud, pullMessages, pushStatus } from "./cloud-client.mjs";
import { acquireLock, keepAwake } from "./single-instance.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(HERE, "../../node_modules/"));
const { chromium } = require("playwright");

const CONFIG = readConfig();
const LOGS = join(HERE, "logs");
const STATE = join(LOGS, "state.json");
const POSTED = join(LOGS, "posted.log");
const RUN_LOG = join(LOGS, "run.log");
const STOP = join(HERE, "STOP");
const PROFILE = join(HERE, "chrome-profile");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CDP = `http://127.0.0.1:${CONFIG.debugPort}`;
const CREATE_PATH = new URL(CONFIG.url).pathname;

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const MAX = args.includes("--max") ? Number(args[args.indexOf("--max") + 1]) : Infinity;

mkdirSync(LOGS, { recursive: true });
if (!DRY) {
  acquireLock(join(LOGS, "post.pid"), "post.mjs"); // 二重起動しない（自動起動と手動が重なっても1つだけ）
  keepAwake();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toLocaleString("ja-JP", { hour12: false });

function log(msg) {
  const line = `[${now()}] ${msg}`;
  console.log(line);
  appendFileSync(RUN_LOG, line + "\n");
}

function notify(msg) {
  execFile("osascript", ["-e", `display notification "${msg}" with title "ディスコード自動投稿"`], () => {});
}

// 投稿に使う文は、投稿の直前に読み直す（編集画面で保存した文が次の投稿から使われる）。
//   クラウドの設定があれば、クラウドが正。取れたら config.json にも控えておき、
//   クラウドに届かないときはその控え（直前に使えた文）で続ける。
//   クラウドの設定が無ければ、config.json をそのまま読む。
const CLOUD = loadCloud(CONFIG);
let messages = CONFIG.messages;
let cloudOk = true; // 直前の取得が成功したか。切り替わったときだけ記録する（毎回だと run.log が埋まる）

async function currentMessages() {
  if (CLOUD) {
    try {
      const fresh = await pullMessages(CLOUD);
      if (!cloudOk) {
        cloudOk = true;
        log("クラウドから文を読めるようになりました");
      }
      if (JSON.stringify(fresh) !== JSON.stringify(messages)) {
        saveMessages(fresh); // 手元にも控える（届かないときの代わり）
        messages = fresh;
        log(`文が差し替わりました（クラウド・${fresh.length}個）`);
      }
      return messages;
    } catch (e) {
      if (cloudOk) {
        cloudOk = false;
        log(`クラウドから文を読めません（${e.message}）。手元の文で続けます`);
      }
    }
  }
  try {
    const fresh = readMessages();
    if (JSON.stringify(fresh) !== JSON.stringify(messages)) {
      messages = fresh;
      log(`文が差し替わりました（${fresh.length}個）`);
    }
  } catch (e) {
    log(`config.json の文を読めないので、直前の文のまま続けます: ${e.message}`);
  }
  return messages;
}

// 画面に「Mac は動いている・最後の投稿はこれ」を出すための報告。届かなくても投稿には影響しない
let lastReportAt = 0;
function reportStatus(force = false) {
  if (!CLOUD || (!force && Date.now() - lastReportAt < 2 * 60 * 1000)) return;
  lastReportAt = Date.now();
  const last = postedLines().at(-1);
  pushStatus(CLOUD, { lastPost: last ? { t: last.t, text: last.text } : null, today: todayCount() }).catch(() => {});
}

function loadIndex() {
  try {
    return JSON.parse(readFileSync(STATE, "utf8")).index ?? 0;
  } catch {
    return 0;
  }
}

function postedLines() {
  if (!existsSync(POSTED)) return [];
  return readFileSync(POSTED, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

function lastPostMs() {
  const last = postedLines().at(-1);
  return last ? new Date(last.t).getTime() : 0;
}

function todayCount() {
  const today = new Date().toLocaleDateString("ja-JP");
  return postedLines().filter((p) => new Date(p.t).toLocaleDateString("ja-JP") === today).length;
}

async function connect() {
  try {
    return await chromium.connectOverCDP(CDP);
  } catch {}
  log("Chrome を起動します");
  spawn(
    CHROME,
    [
      `--remote-debugging-port=${CONFIG.debugPort}`,
      `--user-data-dir=${PROFILE}`,
      "--no-first-run",
      "--no-default-browser-check",
      CONFIG.url,
    ],
    { detached: true, stdio: "ignore" },
  ).unref();
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    try {
      return await chromium.connectOverCDP(CDP);
    } catch {}
  }
  throw new Error("Chrome に接続できません");
}

// 連続で落ちた回数。投稿が1回成功するたびに 0 に戻す
let crashes = 0;

async function run(browser) {
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => !p.isClosed() && p.url().includes("discord-ch.site")) ?? (await ctx.newPage());
  page.on("dialog", (d) => {
    log(`ダイアログ: ${d.message()} → OK`);
    d.accept();
  });

  let index = loadIndex();
  let done = 0;
  let failures = 0;
  log(`開始 (${DRY ? "dry-run" : MAX === Infinity ? "連続" : `最大${MAX}回`}) 次の文: ${(index % messages.length) + 1}番`);

  while (true) {
    if (existsSync(STOP)) {
      log("STOP ファイルがあるので終了します");
      break;
    }
    if (done >= MAX) break;

    if (CONFIG.dailyCap && todayCount() >= CONFIG.dailyCap) {
      log(`今日の上限 ${CONFIG.dailyCap} 件に達したので待ちます`);
      await sleep(5 * 60 * 1000);
      continue;
    }

    // 投稿のタイミングは画面の表示で決める。この最短間隔は、表示の読み違いで
    // 連投してしまわないための保険だけ（サイト側の冷却は10分）
    const waitMs = lastPostMs() + CONFIG.minGapSeconds * 1000 - Date.now();
    if (waitMs > 0 && !DRY) {
      await sleep(Math.min(waitMs, 5000));
      continue;
    }

    await page.goto(CONFIG.url, { waitUntil: "domcontentloaded" });
    const loadedAt = Date.now();
    reportStatus();
    if (new URL(page.url()).pathname !== CREATE_PATH) {
      log(`ログインが切れています (${page.url()})。Chrome 窓でログインし直してください`);
      notify("ログインが切れました。Chrome 窓でログインし直してください");
      process.exitCode = 2;
      break;
    }

    const isPostable = () =>
      page
        .getByText("今すぐ投稿できます")
        .first()
        .waitFor({ state: "visible", timeout: 4000 })
        .then(() => true, () => false);

    if (!(await isPostable())) {
      // 「投稿可能まであと○分○秒」の表示が「今すぐ投稿できます」に変わるのを画面で見張る
      const status = await page
        .locator("#post-submit")
        .evaluate((b) => b.parentElement?.parentElement?.innerText.replace(/\s+/g, " ").slice(-100) ?? "")
        .catch(() => "");
      log(`見張り中: ${status}`);
      const changed = await page
        .waitForFunction(() => document.body.innerText.includes("今すぐ投稿できます"), null, {
          polling: 500,
          timeout: CONFIG.rewatchSeconds * 1000,
        })
        .then(() => true, () => false);
      if (!changed) continue; // 変わらないまま時間が来た → 読み直して見直す（表示が止まっている場合の保険）
      if (Date.now() - loadedAt > CONFIG.tokenMaxAgeSeconds * 1000) {
        log("合図が出ました。認証の値が古いので読み直してから投稿します");
        continue;
      }
      log("合図が出ました（今すぐ投稿できます）");
    }

    // Cloudflare の認証が終わるのを待つ。通らなければ通知して、手で押してもらう
    const tokenReady = () =>
      page.waitForFunction(
        () => document.querySelector('input[name="cf-turnstile-response"]')?.value,
        null,
        { timeout: 30000 },
      );
    try {
      await tokenReady();
    } catch {
      log("Cloudflare の認証が通っていません。Chrome 窓でチェックを押してください");
      notify("Cloudflare の認証を手で押してください");
      try {
        await page.waitForFunction(
          () => document.querySelector('input[name="cf-turnstile-response"]')?.value,
          null,
          { timeout: 10 * 60 * 1000 },
        );
      } catch {
        continue;
      }
    }

    await page.waitForTimeout(1500); // 認証の表示が「成功」に変わるのを待つ

    const current = await currentMessages();
    const text = current[index % current.length];
    await page.locator("#message").fill(text);

    if (DRY) {
      const typed = await page.locator("#message").inputValue();
      await page.screenshot({ path: join(LOGS, "dry-run.png") });
      log(`dry-run: 入力まで確認 (入力値${typed === text ? "一致" : "不一致"}) → 送信せず終了`);
      await page.locator("#message").fill("");
      break;
    }

    const submit = page.locator("#post-submit");
    let resp;
    try {
      [resp] = await Promise.all([
        page.waitForResponse(
          (r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/store",
          { timeout: 30000 },
        ),
        submit.click({ timeout: 10000 }).catch(() => submit.evaluate((b) => b.click())),
      ]);
      await page.waitForLoadState("domcontentloaded");
    } catch (e) {
      failures++;
      log(`送信の結果が確認できません (${failures}回目): ${e.message.split("\n")[0]}`);
      if (failures >= 3) {
        notify("送信が3回続けて確認できず止まりました");
        process.exitCode = 1;
        break;
      }
      continue;
    }

    const status = resp.status();
    if (status >= 400) {
      failures++;
      log(`送信が拒否されました: HTTP ${status} (${failures}回目)`);
      // 403/429 は制限がかかっている可能性。続けず止める
      if (status === 403 || status === 429 || failures >= 3) {
        notify(`投稿が拒否されました (HTTP ${status})。止めました`);
        process.exitCode = 1;
        break;
      }
      continue;
    }

    // HTTP 200 だけでは入力エラーの画面も区別できないので、成功の表示で確かめる
    const succeeded = await page
      .getByText("投稿が成功しました")
      .first()
      .waitFor({ state: "visible", timeout: 10000 })
      .then(() => true, () => false);
    if (!succeeded) {
      failures++;
      log(`HTTP ${status} だが成功の表示が出ていません (${failures}回目): ${page.url()}`);
      if (failures >= 3) {
        notify("成功の表示が3回続けて出ず止まりました");
        process.exitCode = 1;
        break;
      }
      continue;
    }

    failures = 0;
    crashes = 0;
    done++;
    index++;
    writeFileSync(STATE, JSON.stringify({ index }));
    appendFileSync(
      POSTED,
      JSON.stringify({ t: new Date().toISOString(), text: text.replace(/\n/g, " / "), status, url: page.url() }) + "\n",
    );
    log(`投稿しました (HTTP ${status}, 今日${todayCount()}件目): ${text.replace(/\n/g, " / ")} → ${page.url()}`);
    reportStatus(true);
  }

  log("終了");
}

async function main() {
  const browser = await connect();
  try {
    await run(browser);
  } finally {
    await browser.close().catch(() => {}); // 接続を切るだけ。Chrome 本体は開いたまま
  }
}

// タブが閉じられたなどで落ちても、つなぎ直してやり直す。投稿に成功しないまま
// 5回続けて落ちたら、通知して止まる（直らない故障で回り続けないため）
while (true) {
  try {
    await main();
    break;
  } catch (e) {
    crashes++;
    log(`エラー: ${e.message.split("\n")[0]} (${crashes}回目)`);
    if (crashes >= 5) {
      notify(`エラーが続いて止まりました: ${e.message.slice(0, 50)}`);
      process.exit(1);
    }
    await sleep(5000);
  }
}

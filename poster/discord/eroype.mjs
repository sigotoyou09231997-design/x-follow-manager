// eroype.net の「投稿」へ、ディスコードの投稿と一緒に同じ文を投稿する。
//
// ディスコード（discord-ch.site）の投稿が1回成功するたびに、同じタブで eroype.net/create を開いて同じ文を送る。
// ディスコードの掲示板とは画面の作りが違う（2026-10-10 に実際の画面で確認）:
//   ・メッセージ欄は #message（最大300字）。Playwright の fill() では入力が画面の状態に反映されず、投稿ボタンが押せないままなので、
//     キーを打つ形（pressSequentially）で入れる
//   ・投稿ボタンは id が無い button[type=submit]。文が入ると押せるようになる
//   ・投稿の前に、画面は /api/profile（プロフィールの保存）を呼び、そのあと /api/sp/posts（投稿）を呼ぶ。投稿の結果は後者で見る
//   ・連続投稿の冷却は、画面には出ない。投稿の通信が HTTP 429（remainMs＝あと何ミリ秒）で返ってくる
// ディスコードの投稿に付いて動くだけなので、ディスコードが止まっている（アプリの「投稿を止める」・STOP・
// Mac の停止）あいだは、こちらも投稿しない。
//
// 守っていること:
//   ・冷却中（HTTP 429）は、その時間が過ぎるまで送らない（冷却の待ちを自分で短くしない）。失敗やBANとは区別して、やめない。
//     残りが短いとき（初期値150秒まで）は、その分だけ待ってもう一度送る（ディスコードの周回とほぼ同じ間隔なので、
//     数秒の差で1回おきに見送りになるのを防ぐ）
//   ・投稿ボタンが押せる状態になったときだけ送る。押せなければ今回は見送る
//   ・メッセージ欄の上限（最大300字）を超える文は、切らずに見送る
//   ・Cloudflare の認証は Chrome が通した値を待つだけで、細工しない。通らなければ今回は見送る
//   ・ここでの失敗は、ディスコードの投稿に影響させない（例外は呼び出し元へ出さない）
//   ・HTTP 403/429 か、3回続けての失敗で、このプロセスが動いているあいだは eroype への投稿をやめる
//   ・ログインが切れたら通知して見送る（ログインし直せば、次の回から再開する）
import { appendFileSync, existsSync, readFileSync } from "node:fs";

export const EROYPE_DEFAULTS = {
  enabled: false,
  url: "https://eroype.net/create",
  // 画面の部品（eroype.net の実際の画面）。変わったら config.json の "eroype" で上書きする
  textSelector: "#message",
  tagsSelector: "#tags",
  submitSelector: 'button[type="submit"]',
  // 投稿の通信の宛先（この通信の結果で、投稿できたかを見る）
  postPath: "/api/sp/posts",
  // 投稿のあとに画面に出る成功の文言。分かっていれば書く（無くても、文が消える・画面が移ることで成功とみなす）
  successText: null,
  // 付けるタグ（最大5個）。空なら付けない
  tags: [],
  // 文を打つ速さ（1文字ごとの待ち、ミリ秒）
  typeDelayMs: 15,
  // 冷却の残りがこの秒数以内なら、待ってもう一度送る。長ければ見送って、次のディスコードの投稿のあとにまた試す
  maxWaitSeconds: 150,
  // 文を入れたあと、投稿ボタンが押せるようになるまで待つ上限（秒）。押せなければ今回は見送り、次のディスコードの投稿のあとにまた試す
  readyWaitSeconds: 30,
  // Cloudflare の認証の値が入るまで待つ上限（秒）
  turnstileWaitSeconds: 45,
  dailyCap: null,
};

// 使うのは、config.json に "eroype": { "enabled": true } と明示したときだけ（書かなければ今までどおり動く）
export function eroypeConfig(cfg) {
  const raw = cfg?.eroype;
  if (!raw || raw.enabled !== true) return { ...EROYPE_DEFAULTS, enabled: false };
  const merged = { ...EROYPE_DEFAULTS, ...raw, enabled: true };
  let host = "";
  try {
    host = new URL(merged.url).hostname;
  } catch {}
  // 別のサイトへ間違って送らないよう、eroype.net 以外の宛先は受け付けない
  if (host !== "eroype.net") throw new Error(`config.json の eroype.url が eroype.net ではありません: ${merged.url}`);
  if (!Array.isArray(merged.tags) || merged.tags.length > 5 || !merged.tags.every((x) => typeof x === "string" && x.trim())) {
    throw new Error("config.json の eroype.tags は、空でない文字列を最大5個までの配列にしてください");
  }
  return merged;
}

// 失敗のあとどうするか。403/429 は制限がかかっている可能性があるので続けない。それ以外は3回続くまで次の回に任せる
export function afterFailure({ failures, status }) {
  if (status === 403 || status === 429) return "stop";
  return failures >= 3 ? "stop" : "retry";
}

const firstLine = (e) => String(e?.message ?? e).split("\n")[0];

export function createEroypePoster({
  config,
  logFile,
  log,
  notify,
  isHeld,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const cfg = eroypeConfig(config);
  const createPath = new URL(cfg.url).pathname;
  let failures = 0;
  let stopped = false;
  let loginNoticeSent = false;
  let turnstileNoticeSent = false;
  let cooldownUntil = 0; // 投稿が冷却中（HTTP 429）と返された。この時刻まで送らない

  const postedLines = () => {
    if (!existsSync(logFile)) return [];
    return readFileSync(logFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  };
  const todayCount = () => {
    const today = new Date().toLocaleDateString("ja-JP");
    return postedLines().filter((p) => new Date(p.t).toLocaleDateString("ja-JP") === today).length;
  };

  function fail(message, status) {
    failures++;
    log(`${message} (${failures}回目)`);
    if (afterFailure({ failures, status }) === "stop") {
      stopped = true;
      log("eroype への投稿をやめます（このプロセスが動いているあいだ。ディスコードの投稿は続けます）");
      notify(`eroype への投稿を止めました${status ? ` (HTTP ${status})` : ""}`);
      return { status: "stopped", reason: message };
    }
    return { status: "failed", reason: message };
  }

  async function attempt(page, text, mayWait = true) {
    await page.goto(cfg.url, { waitUntil: "domcontentloaded" });
    if (new URL(page.url()).pathname !== createPath) {
      log(`ログインが切れています (${page.url()})。Chrome 窓で eroype.net にログインし直してください。今回は見送ります`);
      if (!loginNoticeSent) {
        loginNoticeSent = true;
        notify("eroype のログインが切れました。Chrome 窓でログインし直してください");
      }
      return { status: "login" };
    }
    loginNoticeSent = false;

    const box = page.locator(cfg.textSelector);
    // 欄の上限を超える文は、切らずに見送る（途中で切れた文を勝手に投稿しない）
    const max = await box.evaluate((e) => e.maxLength);
    if (max > 0 && text.length > max) {
      log(`文が欄の上限（${max}字）を超えているので、今回は見送ります（${text.length}字）`);
      return { status: "toolong" };
    }

    // 認証の枠がある画面では、その値が入るのを待つ。通らなければ今回は見送る（手で押すのを待ってディスコード側を止めない）
    const hasTurnstile = (await page.locator('input[name="cf-turnstile-response"]').count()) > 0;
    if (hasTurnstile) {
      const passed = await page
        .waitForFunction(() => document.querySelector('input[name="cf-turnstile-response"]')?.value, null, {
          timeout: cfg.turnstileWaitSeconds * 1000,
        })
        .then(() => true, () => false);
      if (!passed) {
        log("Cloudflare の認証が通っていないので、今回は見送ります");
        if (!turnstileNoticeSent) {
          turnstileNoticeSent = true;
          notify("eroype の Cloudflare の認証が通りません。Chrome 窓を確認してください");
        }
        return { status: "turnstile" };
      }
      turnstileNoticeSent = false;
    }

    // 文を、キーを打つ形で入れる（fill だと画面の状態に反映されず、投稿ボタンが押せないままになる）
    await box.click();
    await box.pressSequentially(text, { delay: cfg.typeDelayMs });
    if ((await box.inputValue()) !== text) return fail("文が欄に入りきっていません");
    for (const tag of cfg.tags) {
      const tags = page.locator(cfg.tagsSelector);
      await tags.click();
      await tags.pressSequentially(tag, { delay: cfg.typeDelayMs });
      await tags.press("Enter");
    }

    // 投稿ボタンが押せる状態になったときだけ送る。押せないままなら冷却中などなので、今回は見送る
    const ready = await page
      .waitForFunction((sel) => {
        const b = document.querySelector(sel);
        return !!b && !b.disabled;
      }, cfg.submitSelector, { timeout: cfg.readyWaitSeconds * 1000 })
      .then(() => true, () => false);
    if (!ready) {
      log("投稿ボタンが押せる状態にならないので、今回は見送ります");
      return { status: "cooldown" };
    }
    await page.waitForTimeout(1000);

    // 待っているあいだに止められていたら、ここで見送る
    if (isHeld()) return { status: "held" };

    const submit = page.locator(cfg.submitSelector);
    const origin = new URL(cfg.url).origin;
    let resp;
    try {
      [resp] = await Promise.all([
        // 画面は投稿の前にプロフィールの保存（/api/profile）も呼ぶし、Cloudflare の計測（/cdn-cgi/）も同じ場所への POST なので、
        // 投稿の通信（postPath）だけを待つ
        page.waitForResponse(
          (r) => {
            const u = new URL(r.url());
            return r.request().method() === "POST" && u.origin === origin && u.pathname === cfg.postPath;
          },
          { timeout: 30000 },
        ),
        submit.click({ timeout: 10000 }).catch(() => submit.evaluate((b) => b.click())),
      ]);
    } catch (e) {
      return fail(`送信の結果が確認できません: ${firstLine(e)}`);
    }

    const status = resp.status();
    if (status === 429) {
      // 冷却中。失敗ではない（あと何分かを覚えて、その間は開きもしない）
      const body = await resp.json().catch(() => null);
      const remainMs = Number(body?.remainMs) > 0 ? Number(body.remainMs) : 10 * 60 * 1000;
      // 残りが短ければ、待ってもう一度だけ送る（1回目の画面は、投稿に失敗して認証の値などが使い済みなので、読み込み直す）
      if (mayWait && remainMs <= cfg.maxWaitSeconds * 1000) {
        log(`冷却が明けるのを待ちます（あと約${Math.ceil(remainMs / 1000)}秒）`);
        await sleep(remainMs + 3000);
        if (isHeld()) return { status: "held" };
        return attempt(page, text, false);
      }
      cooldownUntil = now() + remainMs;
      log(`冷却中のため、今回は見送ります（あと約${Math.ceil(remainMs / 60000)}分）`);
      return { status: "cooldown", remainMs };
    }
    if (status >= 400) return fail(`送信が拒否されました: HTTP ${status}`, status);

    // HTTP 200 だけでは入力エラーの画面も区別できない。文が欄から消える・画面が移る・成功の文言が出る、のどれかで確かめる
    const succeeded = await page
      .waitForFunction(
        ({ sel, path, expected }) => {
          const box = document.querySelector(sel);
          return (
            location.pathname !== path || !box || box.value === "" || (!!expected && document.body.innerText.includes(expected))
          );
        },
        { sel: cfg.textSelector, path: createPath, expected: cfg.successText },
        { timeout: 10000 },
      )
      .then(() => true, () => false);
    if (!succeeded) return fail(`HTTP ${status} だが投稿できた様子がありません: ${page.url()}`);

    failures = 0;
    appendFileSync(
      logFile,
      JSON.stringify({ t: new Date().toISOString(), text: text.replace(/\n/g, " / "), status, url: page.url() }) + "\n",
    );
    log(`投稿しました (HTTP ${status}, 今日${todayCount()}件目): ${text.replace(/\n/g, " / ")}`);
    return { status: "posted" };
  }

  return {
    enabled: cfg.enabled,
    // ディスコードに投稿できた直後に呼ぶ。同じタブで eroype.net に同じ文を送る。例外は出さない
    async postTogether(page, text) {
      if (!cfg.enabled) return { status: "off" };
      if (stopped) return { status: "stopped" };
      if (isHeld()) return { status: "held" };
      if (cfg.dailyCap && todayCount() >= cfg.dailyCap) return { status: "cap" };
      if (now() < cooldownUntil) {
        log(`冷却中のため、今回は見送ります（あと約${Math.ceil((cooldownUntil - now()) / 60000)}分）`);
        return { status: "cooldown", remainMs: cooldownUntil - now() };
      }
      try {
        return await attempt(page, text);
      } catch (e) {
        return fail(`エラー: ${firstLine(e)}`);
      }
    },
    todayCount,
  };
}

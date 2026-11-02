// ディス速（dissoku.net）のフレンド募集にも、ディスコードの投稿と一緒に同じ文を出す。
//
// ディスコード（discord-ch.site）の投稿が1回成功するたびに、同じタブでディス速のプロフィール編集（/ja/mypage/profile）を開き、
// 募集のメッセージを同じ文に入れ替えて「送信する」→「アップ」（一覧の上に上げる）を押す（2026-11-03 に実際の画面で確認した作り）:
//   ・募集の枠は1人1つ（プロフィールの「メッセージ」）。新しい投稿は作れず、メッセージを書き換えて、アップで上に上げる
//   ・メッセージ欄は textarea[name=message]（最大500字）。タグ（tags[0]…）は必須で、すでに入っているものをそのまま使う（触らない）
//   ・「送信する」は、欄が変わり、「利用規約に同意する」のチェックが入るまで押せない（チェックはページを開くたびに空に戻る）
//   ・同じ文のときは書き換えを飛ばしてアップだけ押す
//   ・アップは一覧の上に出す操作。連続で押せない場合は、サーバーが断る（その間は押さない）
// ディスコードの投稿に付いて動くだけなので、ディスコードが止まっている（アプリの「投稿を止める」・STOP・Mac の停止）あいだは、
// こちらも出さない。
//
// 守っていること（eroype.mjs と同じ考え方）:
//   ・ログインはあなたが専用 Chrome で済ませる。パスワード・認証には触らない。切れていたら通知して見送る
//   ・メッセージ欄の上限を超える文は、切らずに見送る
//   ・断られた（HTTP 429・冷却）ときは、その時間が過ぎるまで押さない。縮めない
//   ・HTTP 403/429 か、3回続けての失敗で、このプロセスが動いているあいだはディス速へ出すのをやめる
//   ・ここでの失敗は、ディスコードの投稿に影響させない（例外は呼び出し元へ出さない）
import { appendFileSync } from "node:fs";
import { afterFailure } from "./eroype.mjs";

export const DISSOKU_DEFAULTS = {
  enabled: false,
  url: "https://dissoku.net/ja/mypage/profile",
  // 画面の部品（ディス速の実際の画面）。変わったら config.json の "dissoku" で上書きする
  textSelector: 'textarea[name="message"]',
  submitSelector: 'button[type="submit"]',
  // 「利用規約に同意する」のチェック。ページを開くたびに空に戻り、入れないと送信が押せない（本人が毎回入れてよいと承諾済み・2026-11-03）
  termsSelector: 'form button[role="checkbox"]',
  // 「アップ」を押すか。false なら、メッセージの入れ替えだけ
  up: true,
  upText: "アップ",
  // 文を打つ速さ（1文字ごとの待ち、ミリ秒）
  typeDelayMs: 15,
  // 文を入れたあと、送信ボタンが押せるようになるまで待つ上限（秒）
  readyWaitSeconds: 20,
  // 断られたとき、残りが分からなければこれだけ待ってから次を試す（分）
  defaultCooldownMinutes: 10,
};

// 使うのは、config.json に "dissoku": { "enabled": true } と明示したときだけ
export function dissokuConfig(cfg) {
  const raw = cfg?.dissoku;
  if (!raw || raw.enabled !== true) return { ...DISSOKU_DEFAULTS, enabled: false };
  const merged = { ...DISSOKU_DEFAULTS, ...raw, enabled: true };
  let host = "";
  try {
    host = new URL(merged.url).hostname;
  } catch {}
  // 別のサイトへ間違って送らないよう、dissoku.net 以外の宛先は受け付けない
  if (host !== "dissoku.net") throw new Error(`config.json の dissoku.url が dissoku.net ではありません: ${merged.url}`);
  return merged;
}

const firstLine = (e) => String(e?.message ?? e).split("\n")[0];

export function createDissokuPoster({ config, logFile, log, notify, isHeld, now = () => Date.now() }) {
  const cfg = dissokuConfig(config);
  const origin = new URL(cfg.url).origin;
  const profilePath = new URL(cfg.url).pathname;
  let failures = 0;
  let stopped = false;
  let loginNoticeSent = false;
  let cooldownUntil = 0; // アップが断られた。この時刻まで押さない

  function fail(message, status) {
    failures++;
    log(`${message} (${failures}回目)`);
    if (afterFailure({ failures, status }) === "stop") {
      stopped = true;
      log("ディス速への投稿をやめます（このプロセスが動いているあいだ。ディスコードの投稿は続けます）");
      notify(`ディス速への投稿を止めました${status ? ` (HTTP ${status})` : ""}`);
      return { status: "stopped", reason: message };
    }
    return { status: "failed", reason: message };
  }

  // 画面が出す「書き込みの通信」（POST/PUT/PATCH）を待つ。Cloudflare の計測（/cdn-cgi/）は除く
  const waitWrite = (page) =>
    page.waitForResponse(
      (r) => {
        const u = new URL(r.url());
        return ["POST", "PUT", "PATCH"].includes(r.request().method()) && u.origin === origin && !u.pathname.startsWith("/cdn-cgi/");
      },
      { timeout: 30000 },
    );

  async function attempt(page, text) {
    await page.goto(cfg.url, { waitUntil: "domcontentloaded" });
    const box = page.locator(cfg.textSelector);
    // ログインしていないと、プロフィール編集の欄が出ない（別の画面へ移る）。出るまで少し待つ
    const shown = await box.waitFor({ state: "visible", timeout: 15000 }).then(() => true, () => false);
    if (!shown || new URL(page.url()).pathname !== profilePath) {
      log(`ログインが切れています (${page.url()})。Chrome 窓で dissoku.net にログインし直してください。今回は見送ります`);
      if (!loginNoticeSent) {
        loginNoticeSent = true;
        notify("ディス速のログインが切れています。Chrome 窓でログインしてください");
      }
      return { status: "login" };
    }
    loginNoticeSent = false;

    // 欄の上限を超える文は、切らずに見送る（途中で切れた文を勝手に出さない）
    const max = await box.evaluate((e) => e.maxLength);
    if (max > 0 && text.length > max) {
      log(`文が欄の上限（${max}字）を超えているので、今回は見送ります（${text.length}字）`);
      return { status: "toolong" };
    }

    let rewrote = false;
    if ((await box.inputValue()) !== text) {
      // 文を、キーを打つ形で入れ替える（fill だと画面の状態に反映されず、送信ボタンが押せないままになることがある）
      await box.click();
      await box.press("ControlOrMeta+a");
      await box.press("Delete");
      await box.pressSequentially(text, { delay: cfg.typeDelayMs });
      if ((await box.inputValue()) !== text) return fail("文が欄に入りきっていません");

      // 利用規約のチェック。入っていなければ入れる（入れないと送信が押せない）。本人の承諾を得て、毎回入れる
      const terms = page.locator(cfg.termsSelector);
      if ((await terms.count()) > 0 && (await terms.first().getAttribute("aria-checked")) !== "true") {
        await terms.first().click({ timeout: 10000 });
      }

      const submit = page.locator(cfg.submitSelector);
      const ready = await page
        .waitForFunction((sel) => {
          const b = document.querySelector(sel);
          return !!b && !b.disabled;
        }, cfg.submitSelector, { timeout: cfg.readyWaitSeconds * 1000 })
        .then(() => true, () => false);
      if (!ready) {
        log("送信ボタンが押せる状態にならないので、今回は見送ります");
        return { status: "notready" };
      }
      await page.waitForTimeout(800);
      if (isHeld()) return { status: "held" };

      let resp;
      try {
        [resp] = await Promise.all([waitWrite(page), submit.click({ timeout: 10000 }).catch(() => submit.evaluate((b) => b.click()))]);
      } catch (e) {
        return fail(`送信の結果が確認できません: ${firstLine(e)}`);
      }
      if (resp.status() >= 400) return fail(`メッセージの送信が拒否されました: HTTP ${resp.status()}`, resp.status());
      rewrote = true;
      await page.waitForTimeout(1000);
    }

    let upped = false;
    if (cfg.up) {
      if (now() < cooldownUntil) {
        log(`アップは冷却中のため押しません（あと約${Math.ceil((cooldownUntil - now()) / 60000)}分）`);
      } else if (isHeld()) {
        return { status: "held" };
      } else {
        const up = page.getByRole("button", { name: cfg.upText, exact: true });
        if ((await up.count()) === 0 || (await up.first().isDisabled())) {
          log("アップのボタンが押せない状態なので、今回は押しません");
        } else {
          let resp;
          try {
            [resp] = await Promise.all([waitWrite(page), up.first().click({ timeout: 10000 })]);
          } catch (e) {
            return fail(`アップの結果が確認できません: ${firstLine(e)}`);
          }
          const status = resp.status();
          if (status === 429 || status === 403) {
            // 冷却中。失敗ではない（縮めずに待つ）。残りが返ってくれば（remainMs）それに従う
            const body = await resp.json().catch(() => null);
            const remain = Number(body?.remainMs) > 0 ? Number(body.remainMs) : cfg.defaultCooldownMinutes * 60_000;
            cooldownUntil = now() + remain;
            log(`アップが断られました (HTTP ${status})。あと約${Math.ceil(remain / 60000)}分は押しません`);
          } else if (status >= 400) {
            return fail(`アップが拒否されました: HTTP ${status}`, status);
          } else {
            upped = true;
          }
        }
      }
    }

    failures = 0;
    appendFileSync(logFile, JSON.stringify({ t: new Date().toISOString(), text: text.replace(/\n/g, " / "), rewrote, upped }) + "\n");
    log(`出しました（${rewrote ? "文を入れ替え" : "文は同じ"}${cfg.up ? (upped ? "・アップ" : "・アップなし") : ""}）: ${text.replace(/\n/g, " / ")}`);
    return { status: "posted", rewrote, upped };
  }

  return {
    enabled: cfg.enabled,
    // ディスコードに投稿できた直後に呼ぶ。同じタブでディス速に同じ文を出す。例外は出さない
    async postTogether(page, text) {
      if (!cfg.enabled) return { status: "off" };
      if (stopped) return { status: "stopped" };
      if (isHeld()) return { status: "held" };
      try {
        return await attempt(page, text);
      } catch (e) {
        return fail(`エラー: ${firstLine(e)}`);
      }
    },
  };
}

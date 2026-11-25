#!/usr/bin/env node
// 自動投稿が「外から」（ログインしていない他の人から）見えているかを、投稿先ごとにまとめて確かめる。
//   スキル autopost-visibility から呼ぶ。手順を毎回組み立て直すと、確かめ方が回ごとにぶれる・抜けるため1本にした。
//
//   node scripts/autopost-visibility.mjs [--x-id <ツイートID>] [--x-user lmpdtdgtd]
//
// - 掲示板（discord-ch.site）… まっさらなヘッドレスブラウザでトップの一覧を開き、最後に出した文を探す。
//   一覧は画面側で組み立てるので、curl では中身が取れない。投稿役の自動の確認は config.json の
//   "externalCheck": false で切られているので、ここでやらないと誰も確かめていない。
// - えろぺ（eroype.net）… 一覧に <article> が無く、ページに埋め込まれたデータに投稿が入っている。それを読む。
// - Yay … 投稿役が毎回「外から見えるか」を自分で確かめてログに書いている。そのログを読むだけにする。
//   ここから Yay の公開APIを叩かない（2026-11-03 に手で連打して家の回線ごと 429 になり、スマホまで使えなくなった）。
// - X（くり返し）… ツイートIDが分かれば、ログインなしの埋め込み用の窓口で開けるかを見る。
//   ID は Supabase の autopost_channels（RLS で鍵なしでは読めない）にしか無いので、引数で渡す。
// - ディス速 … 外からの確認はせず、ログのログイン切れだけ拾う（アプリの「投稿できていない表示」に未対応のため、
//   ここで拾わないと気づけない。2026-11-26 に 11/17 から黙って止まっていた）。
//
// 投稿役のログは本体のフォルダ（Mac の投稿役が動いている所）にある。作業場所(worktree)から走らせても
// そこを読むよう、git の共通ディレクトリからたどる。

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const X_ID = opt("--x-id");
const X_USER = opt("--x-user") ?? "lmpdtdgtd";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

const repo = dirname(resolve(execFileSync("git", ["rev-parse", "--git-common-dir"], { encoding: "utf8" }).trim()));
const POSTER = join(repo, "poster");
const now = Date.now();

const results = []; // { name, verdict: "見える"|"見えない"|"確かめられない"|"止まっている", detail }
const warnings = [];

function tailLines(path, n) {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8").trimEnd().split("\n");
  return lines.slice(-n);
}
function lastJson(path) {
  const line = tailLines(path, 1)[0];
  try {
    return line ? JSON.parse(line) : null;
  } catch {
    return null;
  }
}
function lastJsonWhere(path, pred, n = 50) {
  for (const line of tailLines(path, n).reverse()) {
    try {
      const j = JSON.parse(line);
      if (pred(j)) return j;
    } catch {
      /* 壊れた行は飛ばす */
    }
  }
  return null;
}
const minutesAgo = (iso) => Math.round((now - Date.parse(iso)) / 60000);
const jst = (iso) =>
  new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const firstLine = (text) => String(text ?? "").split(/ \/ |\n/)[0].trim();

// ---- 投稿役が動いているか（launchd）
for (const name of ["discord", "yay"]) {
  // launchd.sh status は表示のあと 0 以外で終わることがあるので、終了コードではなく出力の state を見る
  const out = spawnSync("bash", [join(POSTER, name, "launchd.sh"), "status"], { encoding: "utf8" });
  const state = `${out.stdout}${out.stderr}`.match(/state = (\w+)/)?.[1];
  if (!state) warnings.push(`${name} の投稿役の状態を読めません`);
  else if (state !== "running") warnings.push(`${name} の投稿役が動いていません（state = ${state}）`);
  if (existsSync(join(POSTER, name, "STOP"))) warnings.push(`${name} に STOP が置かれています`);
}

// ---- ログに出ている問題（直近40行）
const discordRun = tailLines(join(POSTER, "discord/logs/run.log"), 40);
const yayRun = tailLines(join(POSTER, "yay/logs/run.log"), 60);
if (discordRun.some((l) => l.includes("[dissoku]") && l.includes("ログインが切れています"))) {
  const lastOk = lastJsonWhere(join(POSTER, "discord/logs/dissoku-posted.log"), () => true);
  results.push({
    name: "ディス速",
    verdict: "止まっている",
    detail: `ログインが切れて毎回見送り${lastOk ? `（最後に出せたのは ${jst(lastOk.t)}）` : ""}。投稿役の Chrome 窓で dissoku.net に Discord でログインし直す`,
  });
}
for (const l of discordRun.filter((l) => !l.includes("[dissoku]") && /ログインが切れて|失敗|エラー|見えません/.test(l)).slice(-3))
  warnings.push(`掲示板/えろぺのログ: ${l}`);
for (const l of yayRun.filter((l) => /ログインが切れて|失敗|エラー|見えません/.test(l)).slice(-3)) warnings.push(`Yay のログ: ${l}`);

// ---- 掲示板（discord-ch.site）とえろぺ（eroype.net）: まっさらなブラウザで
const discordLast = lastJson(join(POSTER, "discord/logs/posted.log"));
const eroypeLast = lastJson(join(POSTER, "discord/logs/eroype-posted.log"));

const { chromium } = await import("playwright");
const browser = await chromium.launch({ headless: true });
try {
  if (!discordLast) results.push({ name: "掲示板", verdict: "確かめられない", detail: "posted.log に投稿が無い" });
  else {
    const snippet = firstLine(discordLast.text);
    const ctx = await browser.newContext({ userAgent: UA, locale: "ja-JP" });
    const page = await ctx.newPage();
    try {
      await page.goto("https://discord-ch.site/", { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForSelector("article", { timeout: 20000 });
      await page.waitForTimeout(2000);
      const arts = await page.$$eval("article", (els) => els.map((e) => e.innerText.replace(/\s+/g, " ")));
      const pos = arts.findIndex((a) => a.includes(snippet));
      const age = `最後の投稿 ${jst(discordLast.t)}（${minutesAgo(discordLast.t)}分前）`;
      if (arts.length < 8) results.push({ name: "掲示板", verdict: "確かめられない", detail: `一覧が ${arts.length} 件しか読めない。${age}` });
      else if (pos >= 0)
        results.push({ name: "掲示板", verdict: "見える", detail: `一覧 ${arts.length} 件中 ${pos + 1} 番目に「${snippet}」。${age}` });
      else
        results.push({
          name: "掲示板",
          verdict: "見えない",
          detail: `一覧 ${arts.length} 件に「${snippet}」が無い。${age}（流れが速いと押し出されるので、分が経っていれば正常のこともある）`,
        });
    } catch (e) {
      results.push({ name: "掲示板", verdict: "確かめられない", detail: e.message.split("\n")[0] });
    } finally {
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}

if (!eroypeLast) results.push({ name: "えろぺ", verdict: "確かめられない", detail: "eroype-posted.log に投稿が無い" });
else {
  try {
    const html = await (await fetch("https://eroype.net/", { headers: { "user-agent": UA } })).text();
    // 埋め込みデータは JSON 文字列の中にさらに JSON が入っているので、エスケープを外してから読む
    const t = html.replace(/\\"/g, '"').replace(/\\\\n/g, "\n").replace(/\\n/g, "\n");
    const all = [...t.matchAll(/"createdAt":"([^"]+)"/g)].map((m) => m[1]).sort().reverse();
    const snippet = firstLine(eroypeLast.text);
    const mine = [];
    for (const m of t.matchAll(new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))) {
      const c = t.slice(m.index, m.index + 300).match(/"createdAt":"([^"]+)"/);
      if (c) mine.push(c[1]);
    }
    const newest = mine.sort().reverse()[0];
    const age = `最後の投稿 ${jst(eroypeLast.t)}（${minutesAgo(eroypeLast.t)}分前）`;
    if (all.length < 5) results.push({ name: "えろぺ", verdict: "確かめられない", detail: `一覧のデータが ${all.length} 件しか読めない。${age}` });
    else if (newest)
      results.push({
        name: "えろぺ",
        verdict: "見える",
        detail: `一覧 ${all.length} 件中 ${all.indexOf(newest) + 1} 番目（${jst(newest)} の投稿）。${age}`,
      });
    else results.push({ name: "えろぺ", verdict: "見えない", detail: `一覧 ${all.length} 件に「${snippet}」が無い。${age}` });
  } catch (e) {
    results.push({ name: "えろぺ", verdict: "確かめられない", detail: e.message.split("\n")[0] });
  }
}

// ---- Yay: 投稿役のログの「外から見えるか」を読むだけ
{
  const checks = yayRun.filter((l) => l.includes("外から見えるか"));
  const lastPost = lastJsonWhere(join(POSTER, "yay/logs/posted.jsonl"), (j) => j.text);
  const age = lastPost ? `最後の投稿 ${jst(lastPost.t)}（${minutesAgo(lastPost.t)}分前）` : "posted.jsonl に投稿が無い";
  const recent = checks.slice(-6);
  const hidden = recent.filter((l) => l.includes("見えません"));
  if (!recent.length) results.push({ name: "Yay", verdict: "確かめられない", detail: `ログに外からの確認が無い。${age}` });
  else if (hidden.length)
    results.push({ name: "Yay", verdict: "見えない", detail: `直近 ${recent.length} 回中 ${hidden.length} 回「見えません」。${age}` });
  else results.push({ name: "Yay", verdict: "見える", detail: `直近 ${recent.length} 回すべて「見えます」（投稿役の確認）。${age}` });
  if (lastPost && minutesAgo(lastPost.t) > 20) warnings.push(`Yay の最後の投稿から ${minutesAgo(lastPost.t)} 分たっています（ふだんは5分ごと）`);
}
if (discordLast && minutesAgo(discordLast.t) > 30)
  warnings.push(`掲示板の最後の投稿から ${minutesAgo(discordLast.t)} 分たっています（ふだんは約10分ごと）`);

// ---- X（くり返し）: ID があれば、ログインなしで開けるか
if (!X_ID)
  results.push({ name: "X（くり返し）", verdict: "確かめられない", detail: "--x-id が無い（Supabase の autopost_channels の status->>'lastId' を渡す）" });
else {
  try {
    const res = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${X_ID}&lang=ja&token=4`, { headers: { "user-agent": UA } });
    const body = res.ok ? await res.json().catch(() => null) : null;
    const user = body?.user?.screen_name;
    if (res.status === 404) results.push({ name: "X（くり返し）", verdict: "見えない", detail: `ID ${X_ID} はログインなしでは 404（消えた・非公開・制限）` });
    else if (!body) results.push({ name: "X（くり返し）", verdict: "確かめられない", detail: `HTTP ${res.status}` });
    else if (user && user.toLowerCase() !== X_USER.toLowerCase())
      results.push({ name: "X（くり返し）", verdict: "見えない", detail: `@${user} の投稿だった（@${X_USER} のはず）` });
    else
      results.push({
        name: "X（くり返し）",
        verdict: "見える",
        detail: `@${user} ${jst(body.created_at)}（${minutesAgo(body.created_at)}分前）がログインなしで開ける。検索に出るかは分からない`,
      });
  } catch (e) {
    results.push({ name: "X（くり返し）", verdict: "確かめられない", detail: e.message.split("\n")[0] });
  }
}

// ---- 出力
for (const r of results) console.log(`${r.verdict.padEnd(7, "　")}  ${r.name}: ${r.detail}`);
if (warnings.length) {
  console.log("\n気になる所:");
  for (const w of warnings) console.log(`- ${w}`);
}
// 見えない・止まっているがあれば 1 で終わる（呼んだ側が気づけるように）
process.exit(results.some((r) => r.verdict === "見えない" || r.verdict === "止まっている") ? 1 : 0);

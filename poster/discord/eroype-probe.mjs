// eroype.net の「自分の投稿の消し方」を調べる、読み取り専用の道具。
//
// 「eroype の投稿を全部消す」「毎回消してから投稿する」を作るには、サイト側の削除の仕組み（画面のボタンか、削除の通信か）を
// 実際の画面で確かめる必要がある。それを当てずっぽうで書くと、別のボタン（退会など）を押しかねないので、先にこれで調べる。
//
// 使い方（Mac の poster/discord で。投稿役が動いていて、専用 Chrome の窓が開いている状態）:
//   node eroype-probe.mjs                  … マイページ（/mypage）を調べる
//   node eroype-probe.mjs --path /mypage   … 調べるページを変える（eroype.net のなかだけ）
//
// 何もしないこと:
//   ・何も押さない・入力しない・送信しない。ページを開いて、読むだけ
//   ・eroype.net への GET 以外の通信は、画面が送ろうとしても止める（止めた通信は、削除の通信を知る手がかりとして一覧に出す）
//   ・専用 Chrome は閉じない。調べるために開いたタブだけを閉じる（投稿役が使っているタブには触らない）
//
// 出てくるもの:
//   ・コンソールに要約（このまま貼れる。投稿の文そのものは出さず、通信の中身は「形」だけにしてある）
//   ・logs/eroype-probe/ に probe.json・page.html・page.png（手元だけ。logs/ はコミットされない。投稿の文が写っているので貼らない）
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { readConfig } from "./config.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const EROYPE_ORIGIN = "https://eroype.net";

// 削除を思わせる語。ボタンの文言・aria-label・class などに当てる
export const DELETE_WORDS = /削除|消す|消去|取り消|delete|remove|trash|ゴミ箱|destroy/i;

export const looksLikeDelete = (...texts) => DELETE_WORDS.test(texts.filter(Boolean).join(" "));

// 調べるページ。eroype.net の外は受け付けない（別のサイトを開かない）
export function resolveTarget(path) {
  const url = new URL(path, EROYPE_ORIGIN + "/");
  if (url.origin !== EROYPE_ORIGIN) throw new Error(`eroype.net の外は調べません: ${url.href}`);
  return url;
}

// 通信の中身を「形」にする。投稿の文などの値は出さず、キー名・型・文字数・配列の長さだけ残す
export function shapeOf(value, depth = 0) {
  if (value === null) return "null";
  if (Array.isArray(value)) return { _array: value.length, _item: value.length ? shapeOf(value[0], depth + 1) : null };
  if (typeof value === "string") return `string(${value.length})`;
  if (typeof value !== "object") return typeof value;
  if (depth >= 5) return "{…}";
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shapeOf(v, depth + 1)]));
}

const oneLine = (s) => s.replace(/\s+/g, " ");

// スクリプトの中の API のパス（/api/... で始まる文字列）
export function apiPathsIn(src) {
  const found = new Set();
  for (const m of src.matchAll(/["'`](\/api\/[A-Za-z0-9_\-/.:${}[\]]*)/g)) found.add(m[1]);
  return [...found].sort();
}

// 一致した箇所の前後を切り出す（圧縮されたスクリプトなので、前後 width 字ぶんあれば呼び出しの形が読める）
export function snippetsAround(src, regex, width = 140, max = 10) {
  const out = [];
  const flags = regex.flags.includes("g") ? regex.flags : regex.flags + "g";
  for (const m of src.matchAll(new RegExp(regex.source, flags))) {
    out.push(oneLine(src.slice(Math.max(0, m.index - width), m.index + m[0].length + width)));
    if (out.length >= max) break;
  }
  return out;
}

// 削除の通信（method に DELETE を指定している箇所）と、画面に出す「削除」系の文言の周り
export function deleteHints(src) {
  return {
    calls: snippetsAround(src, /method\s*:\s*["'`]delete["'`]/i, 160, 8),
    labels: snippetsAround(src, /削除|消去/, 50, 6),
  };
}

// ページの中で動かす（ブラウザの側で評価される）。何も変えず、読むだけ
function scanDom(wordsSource) {
  const words = new RegExp(wordsSource, "i");
  const short = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
  const chain = (el) => {
    const out = [];
    let e = el.parentElement;
    for (let i = 0; i < 4 && e && e !== document.body; i++, e = e.parentElement) {
      const cls = typeof e.className === "string" ? e.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).join(".") : "";
      out.push(e.tagName.toLowerCase() + (e.id ? `#${e.id}` : "") + (cls ? `.${cls}` : ""));
    }
    return out;
  };
  const describe = (el) => ({
    tag: el.tagName.toLowerCase(),
    text: short(el.innerText || el.value, 60),
    aria: el.getAttribute("aria-label"),
    title: el.getAttribute("title"),
    id: el.id || null,
    cls: short(typeof el.className === "string" ? el.className : el.getAttribute("class"), 80),
    href: el.getAttribute("href"),
    type: el.getAttribute("type"),
    data: Object.keys(el.dataset || {}),
    html: short(el.outerHTML, 260),
    parents: chain(el),
  });
  const els = [...document.querySelectorAll("button, a, [role=button], [onclick], input[type=button], input[type=submit], summary")];
  const all = els.map(describe);
  const hits = all.filter((c) => words.test([c.text, c.aria, c.title, c.id, c.cls, c.html].join(" ")));
  // 文言のないボタン（「…」のようなメニューの奥に削除があることが多い）
  const iconOnly = all.filter((c) => !c.text && c.tag !== "a").slice(0, 12);
  return {
    url: location.href,
    title: document.title,
    headings: [...document.querySelectorAll("h1, h2, h3")].slice(0, 10).map((h) => short(h.innerText, 50)),
    controls: all.length,
    deleteLike: hits.slice(0, 20),
    iconOnlyButtons: iconOnly,
    buttonLabels: [...new Set(all.map((c) => c.text).filter(Boolean))].slice(0, 40),
    dialogOpen: !!document.querySelector("dialog[open], [role=dialog], [role=alertdialog]"),
  };
}

function printSection(title, lines) {
  console.log(`\n--- ${title} ---`);
  if (!lines.length) console.log("（なし）");
  for (const l of lines) console.log(l);
}

async function main() {
  const args = process.argv.slice(2);
  const pathArg = args.includes("--path") ? args[args.indexOf("--path") + 1] : "/mypage";
  const target = resolveTarget(pathArg);

  const cfg = readConfig();
  const require = createRequire(join(HERE, "../../node_modules/"));
  const { chromium } = require("playwright");

  let browser;
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${cfg.debugPort}`);
  } catch {
    console.error(
      `専用 Chrome（デバッグポート ${cfg.debugPort}）に接続できません。投稿役が動いていれば窓は開いています（bash launchd.sh status で state = running を確認）。\n` +
        `止めているときは、手で開いてください:\n` +
        `  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=${cfg.debugPort} --user-data-dir="${join(HERE, "chrome-profile")}" ${target.href}`,
    );
    process.exit(1);
  }

  const ctx = browser.contexts()[0];
  const page = await ctx.newPage(); // 投稿役が使っているタブには触らず、調べる用に別のタブを開く

  const blocked = []; // 画面が送ろうとして、こちらで止めた通信（GET 以外）
  await page.route("**/*", (route) => {
    const req = route.request();
    const method = req.method();
    if (method !== "GET" && method !== "HEAD") {
      blocked.push(`${method} ${req.url()}`);
      return route.abort();
    }
    return route.continue();
  });

  const apiCalls = [];
  const scripts = new Map();
  page.on("response", async (r) => {
    try {
      const u = new URL(r.url());
      if (u.origin !== target.origin) return;
      const type = r.request().resourceType();
      if (type === "fetch" || type === "xhr") {
        const entry = { method: r.request().method(), path: u.pathname + u.search, status: r.status() };
        try {
          entry.shape = shapeOf(await r.json());
        } catch {
          entry.shape = "(JSON ではない)";
        }
        apiCalls.push(entry);
      } else if (type === "script") {
        scripts.set(r.url(), await r.text());
      }
    } catch {}
  });

  await page.goto(target.href, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  // 一覧が続きを読み込む作りか確かめるため、下まで3回送る（スクロールだけで、何も押さない）
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1200);
  }
  await page.waitForTimeout(1500);

  const dom = await page.evaluate(scanDom, DELETE_WORDS.source);
  const loggedIn = new URL(dom.url).pathname === target.pathname;

  const apiPaths = new Set();
  const deleteCalls = [];
  const deleteLabels = [];
  for (const [url, src] of scripts) {
    for (const p of apiPathsIn(src)) apiPaths.add(p);
    const file = new URL(url).pathname;
    const hints = deleteHints(src);
    for (const s of hints.calls) deleteCalls.push(`${file}: …${s}…`);
    for (const s of hints.labels) deleteLabels.push(`${file}: …${s}…`);
  }

  const outDir = join(HERE, "logs", "eroype-probe");
  mkdirSync(outDir, { recursive: true });
  const report = {
    at: new Date().toISOString(),
    target: target.href,
    loggedIn,
    dom,
    apiCalls,
    blocked,
    apiPaths: [...apiPaths].sort(),
    deleteCalls,
    deleteLabels,
    scriptCount: scripts.size,
  };
  writeFileSync(join(outDir, "probe.json"), JSON.stringify(report, null, 2));
  writeFileSync(join(outDir, "page.html"), await page.content());
  await page.screenshot({ path: join(outDir, "page.png"), fullPage: true }).catch(() => {});

  console.log("=== eroype 調査（読み取りだけ。何も押していません） ===");
  console.log(`開いたページ: ${target.href}`);
  console.log(`いまのURL: ${dom.url}  ${loggedIn ? "" : "← 目的のページと違います。ログインが切れているかもしれません"}`);
  console.log(`見出し: ${dom.headings.join(" / ") || "（なし）"}`);
  console.log(`操作できる部品: ${dom.controls}個  ダイアログ: ${dom.dialogOpen ? "開いている" : "なし"}`);
  printSection(
    "削除らしい部品",
    dom.deleteLike.map((c) => `${c.tag} text="${c.text}" aria="${c.aria ?? ""}" id=${c.id ?? ""} cls="${c.cls}" 親=${c.parents.join(" < ")}\n    ${c.html}`),
  );
  printSection(
    "文言のないボタン（メニューの奥に削除があるかもしれない）",
    dom.iconOnlyButtons.map((c) => `${c.tag} aria="${c.aria ?? ""}" cls="${c.cls}" 親=${c.parents.join(" < ")}`),
  );
  printSection("ボタン・リンクの文言", [dom.buttonLabels.join(" | ")].filter(Boolean));
  printSection(
    "画面のAPI通信",
    apiCalls.map((c) => `${c.method} ${c.path} → ${c.status}  ${JSON.stringify(c.shape)}`),
  );
  printSection("画面が送ろうとして止めた通信（GET以外）", blocked);
  printSection("スクリプトの中の「method: DELETE」の周り", deleteCalls);
  printSection("スクリプトの中の「削除」の文言の周り", deleteLabels);
  printSection("スクリプトの中のAPIパス", [...apiPaths].sort());
  console.log(`\n保存先: ${outDir}（probe.json / page.html / page.png。投稿の文が写っているので、貼るのは上の要約だけにしてください）`);

  await page.close();
  process.exit(0);
}

// import されたとき（テスト）は動かさない
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`失敗しました: ${e.message}`);
    process.exit(1);
  });
}

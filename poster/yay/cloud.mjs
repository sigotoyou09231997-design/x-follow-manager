// 編集画面（このアプリの「自動投稿」タブ）とのやり取り。ディスコードと同じ受け口を、Yay 用の枠（ch=yay）で使う。
//   pullState  … 画面で保存した「投稿する文」と、画面で止められているかを取ってくる（周回の頭と、その合間に呼ぶ）
//   pushStatus … 「動いています・最後の投稿はこれ・いま止まっています」を知らせる（画面に表示される）
// 合鍵は 環境変数 YAY_CLOUD_TOKEN → このフォルダの合鍵ファイル（既定 .cloud-token） → ../discord/ の同名ファイル の順に探す
// （どちらも同じ「Mac用の合鍵」。画面のログインとは別物で、文を読む・状態を報告するだけ。書き換えはできない）。
// config.json の "cloud": { "url": "https://…" } が無ければクラウドは使わない。
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const TIMEOUT_MS = 8000;
const MAX_LENGTH = 1000;

export function loadCloud(config) {
  const url = config.cloud?.url?.replace(/\/+$/, "");
  if (!url) return null;
  // config.json の "cloud": { "tokenFile": ".hub-token" } で、合鍵のファイル名を変えられる（省略すると .cloud-token）
  const name = config.cloud?.tokenFile ?? ".cloud-token";
  const files = [join(HERE, name), join(HERE, "../discord/", name)];
  const file = files.find((f) => existsSync(f));
  const token = process.env.YAY_CLOUD_TOKEN ?? (file ? readFileSync(file, "utf8").trim() : "");
  if (!token) throw new Error(`config.json にクラウドの設定がありますが、合鍵（${name}）が見つかりません`);
  return { url, token };
}

async function call(cloud, path, init = {}) {
  const res = await fetch(`${cloud.url}/api/${path}?ch=yay`, {
    ...init,
    headers: { Authorization: `Bearer ${cloud.token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  return res.json();
}

// サーバーの返事を、使える形にする。投げない（止められているかは、文が使えない形でも読み取る）。
//   paused … 画面で止められているか。止める機能より前のサーバーは返さない（＝止められていない）
//   text   … 使える文。止められているあいだは、文が空でもよい（null になる）
//   problem … 文が使えない理由。止められていなければ、呼び出し側はこれを失敗として扱う（手元の文で続ける）
export function parseState(body) {
  const paused = body?.paused === true;
  const messages = body?.messages;
  const text = Array.isArray(messages) && typeof messages[0] === "string" ? messages[0].replace(/\r\n?/g, "\n").trim() : "";
  if (!text) return { paused, text: null, problem: "文が空です" };
  if (text.length > MAX_LENGTH) return { paused, text: null, problem: `文が長すぎます（${text.length}文字）` };
  return { paused, text, problem: null };
}

export async function pullState(cloud) {
  try {
    return parseState(await call(cloud, "poster-text"));
  } catch (e) {
    // 404 は「文がまだ保存されていない」。止められていれば 404 にはならない（文が空でも200で返す）ので、止められてはいない
    if (e.status === 404) return { paused: false, text: null, problem: "文がまだ保存されていません" };
    throw e;
  }
}

export async function pushStatus(cloud, { lastPost, today, paused }) {
  await call(cloud, "poster-status", { method: "POST", body: JSON.stringify({ lastPost, today, paused: paused === true }) });
}

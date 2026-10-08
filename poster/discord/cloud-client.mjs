// 投稿側(Mac)がクラウドの編集画面とやり取りする部分。
//   pullState  … いま保存されている文と、画面で止められているかを取ってくる（投稿の直前に呼ぶ）
//   pushStatus … 「動いています・最後の投稿はこれ・いま止まっています」を知らせる（画面に表示される）
// 合鍵は .cloud-token（コミットしない）か、環境変数 DISCORD_CH_CLOUD_TOKEN から読む。
// config.json の "cloud": { "url": "https://…", "tokenFile": ".hub-token" } の tokenFile で、合鍵のファイル名を変えられる
// （X のアプリへ移したあとは .hub-token。省略すると .cloud-token）。
// config.json の "cloud": { "url": "https://…" } が無ければクラウドは使わない。
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { cleanMessages } from "./config.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TIMEOUT_MS = 8000;

export function loadCloud(config) {
  const url = config.cloud?.url?.replace(/\/+$/, "");
  if (!url) return null;
  const name = config.cloud?.tokenFile ?? ".cloud-token";
  const file = join(HERE, name);
  const token = process.env.DISCORD_CH_CLOUD_TOKEN ?? (existsSync(file) ? readFileSync(file, "utf8").trim() : "");
  if (!token) throw new Error(`config.json にクラウドの設定がありますが、合鍵（${name}）がありません`);
  return { url, token };
}

async function call(cloud, path, init = {}) {
  const res = await fetch(`${cloud.url}/api/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${cloud.token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  return res.json();
}

// サーバーの返事を、使える形にする。投げない（止められているかは、文が使えない形でも読み取る）。
//   paused   … 画面で止められているか。止める機能より前のサーバーは返さない（＝止められていない）
//   messages … 使える文。止められているあいだは、文が空でもよい（null になる）
//   problem  … 文が使えない理由。止められていなければ、呼び出し側はこれを失敗として扱う（手元の文で続ける）
export function parseState(body) {
  const paused = body?.paused === true;
  try {
    return { paused, messages: cleanMessages(body?.messages), problem: null };
  } catch (e) {
    return { paused, messages: null, problem: e.message };
  }
}

export async function pullState(cloud) {
  try {
    return parseState(await call(cloud, "poster-text"));
  } catch (e) {
    // 404 は「文がまだ保存されていない」。止められていれば 404 にはならない（文が空でも200で返す）ので、止められてはいない
    if (e.status === 404) return { paused: false, messages: null, problem: "文がまだ保存されていません" };
    throw e;
  }
}

export async function pushStatus(cloud, { lastPost, today, paused }) {
  await call(cloud, "poster-status", { method: "POST", body: JSON.stringify({ lastPost, today, paused: paused === true }) });
}

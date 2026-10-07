// 投稿側(Mac)がクラウドの編集画面とやり取りする部分。
//   pullMessages … いま保存されている文を取ってくる（投稿の直前に呼ぶ）
//   pushStatus   … 「動いています・最後の投稿はこれ」を知らせる（画面に表示される）
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
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// 形がおかしい文は投げる（呼び出し側は手元の文で続ける）
export async function pullMessages(cloud) {
  const body = await call(cloud, "poster-text");
  return cleanMessages(body.messages);
}

export async function pushStatus(cloud, { lastPost, today }) {
  await call(cloud, "poster-status", { method: "POST", body: JSON.stringify({ lastPost, today }) });
}

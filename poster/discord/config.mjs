// config.json の読み書きを1か所にまとめる。
// 投稿側（post.mjs）と編集画面（editor.mjs）が同じ決まりで読み書きするため。
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
export const CONFIG_PATH = process.env.DISCORD_CH_CONFIG ?? join(HERE, "config.json");

export const MAX_MESSAGES = 10;
export const MAX_LENGTH = 1000;
const MAX_ARCHIVE = 100;

export function readConfig(path = CONFIG_PATH) {
  return JSON.parse(readFileSync(path, "utf8"));
}

// 投稿に使う文の一覧。形がおかしければ投げる（投稿側は直前の正しい文を使い続ける）
export function readMessages(path = CONFIG_PATH) {
  const { messages } = readConfig(path);
  if (!Array.isArray(messages) || messages.length === 0 || !messages.every((m) => typeof m === "string" && m.trim())) {
    throw new Error("config.json の messages が空、または文字列ではありません");
  }
  return messages;
}

// 画面から来た文を整える。使えない入力は理由つきで投げる
export function cleanMessages(input) {
  if (!Array.isArray(input) || input.length === 0) throw new Error("文が1つもありません");
  if (input.length > MAX_MESSAGES) throw new Error(`文は${MAX_MESSAGES}個までです`);
  return input.map((m, i) => {
    if (typeof m !== "string") throw new Error("文は文字列で送ってください");
    const text = m.replace(/\r\n?/g, "\n").trim();
    if (!text) throw new Error(input.length === 1 ? "文が空です" : `${i + 1}つ目の文が空です`);
    if (text.length > MAX_LENGTH) throw new Error(`文が長すぎます（${text.length}文字。上限${MAX_LENGTH}文字）`);
    return text;
  });
}

// 文を差し替えて保存する。外れた古い文は messagesArchive（履歴）へ移す。
// 一時ファイルに書いてから置き換えるので、読む側が書きかけを見ることはない
export function saveMessages(input, path = CONFIG_PATH) {
  const next = cleanMessages(input);
  const cfg = readConfig(path);
  const archive = Array.isArray(cfg.messagesArchive) ? cfg.messagesArchive : [];
  for (const old of cfg.messages ?? []) {
    if (!next.includes(old) && !archive.includes(old)) archive.push(old);
  }
  cfg.messagesArchive = archive.filter((a) => !next.includes(a)).slice(-MAX_ARCHIVE);
  cfg.messages = next;
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(cfg, null, 2) + "\n");
  renameSync(tmp, path);
  return cfg;
}

#!/usr/bin/env node
// api/*.ts を変換した JS(引数のフォルダ)を、Node の ESM で本当に読み込んでみる。
//   npm run check:api
//
// なぜ要るか: Vercel は TS を JS に変換して Node の ESM で動かすので、相対 import に `.js` が無いと
// `ERR_MODULE_NOT_FOUND` で落ちる。型チェック(moduleResolution: bundler)・Vite・vitest は拡張子なしでも通るため、
// 手元の確認は全部緑のまま本番だけ壊れる。2026-10-10 に publishDue(毎分の予約投稿)が約15分止まった。
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const dir = resolve(process.argv[2] ?? ".api-esm-check", "api");
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"))
  .sort();
let bad = 0;
for (const f of files) {
  try {
    await import(pathToFileURL(join(dir, f)).href);
    console.log("  ok  ", f);
  } catch (e) {
    bad++;
    console.log("  NG  ", f, "→", String((e && e.message) || e).split("\n")[0]);
  }
}
if (bad) console.log(`✗ ${bad} 個の受け口が読み込めません(相対 import に .js が付いているか確かめてください)`);
process.exit(bad ? 1 : 0);

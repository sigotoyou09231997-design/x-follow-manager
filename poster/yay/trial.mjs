// 試し運転: 指定した場所へ1回だけ投稿し、記録して、少し見せてから、その投稿だけを消す。
//   node trial.mjs --dry                      … 文を入れるだけ（送信しない）
//   node trial.mjs --target group:408344      … 1回投稿して消す
//   node trial.mjs --target timeline
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { connect, createPost, deletePost, openTarget, stillThere, waitForCard } from "./yay.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const LOGS = join(HERE, "logs");
mkdirSync(LOGS, { recursive: true });
const args = process.argv.slice(2);
const arg = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
const DRY = args.includes("--dry");
const TARGET = arg("--target", "group:408344");
const HOLD = Number(arg("--hold", "30")); // 投稿を見せておく秒数
const TEXT = JSON.parse(readFileSync(join(HERE, "config.json"), "utf8")).text;

const log = (m) => {
  const line = `[${new Date().toLocaleString("ja-JP", { hour12: false })}] ${m}`;
  console.log(line);
  appendFileSync(join(LOGS, "run.log"), line + "\n");
};

const { browser, page } = await connect();
try {
  await openTarget(page, TARGET);
  if (DRY) {
    log(`dry-run (${TARGET}): ${JSON.stringify(await createPost(page, TEXT, { target: TARGET, dry: true }))}`);
  } else {
    const made = await createPost(page, TEXT, { target: TARGET });
    // 消すための記録。この記録にある番号の投稿しか、この道具は消さない
    appendFileSync(join(LOGS, "posted.jsonl"), JSON.stringify({ t: new Date().toISOString(), target: TARGET, id: made.id, text: TEXT }) + "\n");
    log(`投稿しました (${TARGET}) 投稿番号 ${made.id}（サーバーの返事から）`);
    log(`${HOLD}秒そのまま見せてから、この投稿を消します`);
    await new Promise((r) => setTimeout(r, HOLD * 1000));
    log(`一覧にカードが出るまで ${await waitForCard(page, TARGET, made.id)}秒`);
    await deletePost(page, made.id);
    await openTarget(page, TARGET); // 読み直して、本当に消えたかを確かめる
    log(`削除しました。読み直して確認: ${(await stillThere(page, made.id)) ? "まだ残っている" : "消えている"}`);
    appendFileSync(join(LOGS, "posted.jsonl"), JSON.stringify({ t: new Date().toISOString(), target: TARGET, id: made.id, deleted: true }) + "\n");
  }
} catch (e) {
  log(`エラー: ${e.message.split("\n")[0]}`);
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
}

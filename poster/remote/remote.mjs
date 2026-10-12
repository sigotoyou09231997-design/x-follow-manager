// スマホの画面の「投稿役を再起動する」の依頼を受けて、止まっている投稿役（Yay・ディスコード）だけを入れ替える見張り。
//   launchd が1分ごとにこれを起動する（常駐しない）。依頼を見に行き、あれば処理して、結果を書き戻して終わる。
//   依頼が無いのがふつうなので、そのときは何も出力しない（ログを毎分埋めない）。
//
// 守っていること:
//   ・Mac 本体は再起動しない（FileVault が有効で自動ログインが無いため、本体を再起動すると、Mac の前で
//     パスワードを打つまで投稿役が全部止まる）。入れ替えるのは投稿役のプロセスだけ。
//   ・動いている投稿役には触らない。入れ替えるのは「動いていない」か「ログが15分以上動いていない」ものだけ。
//     （ディスコードは、投稿の最中に殺すと state.json と posted.log が食い違うため）
//   ・STOP ファイルがある投稿役には触らない。わざと止めているのを、スマホからの1回の操作で外さない。
//   ・サーバーから受け取るのは「いつ依頼したか」だけ。実行するコマンドはここに書いてある決まったものだけで、
//     サーバーから命令の中身を受け取らない。
//   ・30分以上前の依頼は実行しない（Mac が寝ていた間の昔の依頼が、戻ってきた途端に動かないように）。
//
// 呼び出し: node remote.mjs （launchd.sh install で1分ごとの自動起動に入れる）
import { execFile } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { loadCloud } from "../yay/cloud.mjs";

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const TIMEOUT_MS = 10000;
const LAUNCHCTL = "/bin/launchctl";
/** 投稿役のログがこれだけ動いていなければ「固まっている」と見なして入れ替える（分）。 */
export const STALE_LOG_MINUTES = 15;
/** 入れ替えたあと、動き出すのを待つ秒数の上限。 */
const START_WAIT_SECONDS = 30;

const POSTERS = [
  { name: "Yay", dir: join(HERE, "../yay"), label: "local.yay-auto-post" },
  { name: "ディスコード", dir: join(HERE, "../discord"), label: "local.discord-ch-auto-post" },
];

const stamp = () => new Date().toLocaleString("ja-JP", { hour12: false });
const log = (message) => console.log(`[${stamp()}] ${message}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 投稿役1つを、どうするか決める。
 *   skip    … 動いているので、そのまま
 *   restart … 入れ替える
 *   blocked … STOP があるので、触らない（わざと止めているかもしれない）
 */
export function decide({ running, stopExists, logAgeMinutes }) {
  if (stopExists) return { action: "blocked", reason: "STOP ファイルがあるので止めたままです（手で消してから再起動してください）" };
  if (!running) return { action: "restart", reason: "止まっていたので再起動しました" };
  if (logAgeMinutes !== null && logAgeMinutes >= STALE_LOG_MINUTES) {
    return { action: "restart", reason: `記録が${Math.floor(logAgeMinutes)}分動いていなかったので再起動しました` };
  }
  return { action: "skip", reason: "動いているのでそのままです" };
}

const service = (label) => `gui/${process.getuid()}/${label}`;

async function isRunning(label) {
  try {
    const { stdout } = await run(LAUNCHCTL, ["print", service(label)], { timeout: TIMEOUT_MS });
    return /^\s*state = running/m.test(stdout);
  } catch {
    return false; // 登録されていない
  }
}

function logAgeMinutes(dir) {
  try {
    return (Date.now() - statSync(join(dir, "logs", "run.log")).mtimeMs) / 60000;
  } catch {
    return null; // ログが無い（まだ一度も動いていない）
  }
}

/** launchd.sh restart と同じ入れ替え（STOP を消す部分は除く。STOP があれば、ここへ来ない）。 */
async function restartPoster(label) {
  try {
    await run(LAUNCHCTL, ["print", service(label)], { timeout: TIMEOUT_MS });
    await run(LAUNCHCTL, ["kickstart", "-k", service(label)], { timeout: TIMEOUT_MS });
  } catch {
    // 登録が外れていた。登録し直す
    const plist = join(homedir(), "Library/LaunchAgents", `${label}.plist`);
    if (!existsSync(plist)) throw new Error("自動起動の設定ファイルがありません");
    await run(LAUNCHCTL, ["bootstrap", `gui/${process.getuid()}`, plist], { timeout: TIMEOUT_MS });
  }
  for (let i = 0; i < START_WAIT_SECONDS; i++) {
    await sleep(1000);
    if (await isRunning(label)) return true;
  }
  return false;
}

async function handle(poster) {
  const verdict = decide({
    running: await isRunning(poster.label),
    stopExists: existsSync(join(poster.dir, "STOP")),
    logAgeMinutes: logAgeMinutes(poster.dir),
  });
  if (verdict.action !== "restart") return `${poster.name}: ${verdict.reason}`;
  // 動作確認用。「入れ替える」と決めたところまでを見て、実際には触らない
  if (process.env.POSTER_REMOTE_DRY === "1") return `${poster.name}: [確認のみ] ${verdict.reason}`;
  try {
    const started = await restartPoster(poster.label);
    return `${poster.name}: ${started ? verdict.reason : "再起動しましたが、動き出すのを確認できませんでした"}`;
  } catch (e) {
    return `${poster.name}: 再起動に失敗しました（${e.message.split("\n")[0].slice(0, 80)}）`;
  }
}

function cloud() {
  const config = JSON.parse(readFileSync(join(HERE, "../yay/config.json"), "utf8"));
  const c = loadCloud(config);
  if (!c) throw new Error("yay/config.json にクラウドの設定がありません");
  // 動作確認用（手元の偽サーバーにつなぐ）。普段は設定していない
  return process.env.POSTER_REMOTE_URL ? { ...c, url: process.env.POSTER_REMOTE_URL } : c;
}

async function api(c, init = {}) {
  const res = await fetch(`${c.url}/api/poster-command`, {
    ...init,
    headers: { Authorization: `Bearer ${c.token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function main() {
  const c = cloud();
  let pending;
  try {
    pending = (await api(c)).restart;
  } catch {
    // ネットが切れている等。次の1分でまた見に行く。毎分ログを埋めないよう、依頼が無いときと同じく黙る
    return;
  }
  if (!pending) return;

  log(`再起動の依頼を受け取りました（${pending.requestedAt}、${pending.ageSeconds}秒前）`);
  // 昔の依頼は実行しない（サーバー側でも30分で切っているが、念のため）
  if (pending.ageSeconds > 30 * 60) {
    await api(c, { method: "POST", body: JSON.stringify({ requestedAt: pending.requestedAt, result: "古い依頼のため実行しませんでした" }) });
    return;
  }

  const lines = [];
  for (const poster of POSTERS) lines.push(await handle(poster));
  const result = lines.join(" / ");
  log(result);
  // 書き戻せなければ、次の1分にまた同じ依頼が見える。投稿役はもう入れ替わっているので、2回目は「動いているのでそのまま」になる
  await api(c, { method: "POST", body: JSON.stringify({ requestedAt: pending.requestedAt, result }) }).catch((e) =>
    log(`結果を書き戻せませんでした: ${e.message}`)
  );
}

// 読み込んだだけ（テスト）では動かさず、node remote.mjs で起動したときだけ動かす
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    log(`見張りが失敗しました: ${e.message}`);
    process.exitCode = 1;
  });
}

// yay.space の連続運転: 一定間隔ごとに、各場所で「前の自分の投稿を消す → 新しく投稿する」を繰り返す。
//
//   caffeinate -i node run.mjs          … 連続運転（Mac をスリープさせない）
//   node run.mjs --cycles 2 --targets timeline --interval 60 --cleanup   … 動作確認用（有限回で終わる）
// 止めるとき: Ctrl-C、またはこのフォルダに STOP という名前のファイルを作る（いまの周回が終わってから止まる）。
//   アプリの「自動投稿」タブの「投稿を止める」なら、プロセスは動いたまま投稿だけを見合わせる（再開もそこから）。
//   周回の途中で止められたら、そこで打ち切る（いま出ている投稿は、消さずにそのまま残す）。
//
// 安全のため:
//   ・消すのは、この道具が投稿して logs/posted.jsonl に番号を残した投稿だけ（手で投稿した分は触らない）
//   ・前の投稿を消せなかった場所には、新しく投稿しない（同じ場所に何件も積み上がらないように）
//   ・ログイン切れ・HTTP 403/429・「投稿できませんでした」の連続・3回続けての失敗では、止まって通知する
import { execFile } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { connect, createPost, deletePost, listJoinedGroups, openTarget, postState, selfId, waitForCard } from "./yay.mjs";
import { append, pending, stats } from "./ledger.mjs";
import { pickTargets } from "./targets.mjs";
import { loadCloud, pullState, pushStatus } from "./cloud.mjs";
import { createPauseTracker } from "../pause-state.mjs";
import { acquireLock, keepAwake } from "./single-instance.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const LOGS = join(HERE, "logs");
const LEDGER = join(LOGS, "posted.jsonl");
const STOP = join(HERE, "STOP");
const LOCK = join(LOGS, "run.pid");
mkdirSync(LOGS, { recursive: true });

const args = process.argv.slice(2);
const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const config = () => JSON.parse(readFileSync(join(HERE, "config.json"), "utf8"));
// 投稿先: config.json の targets が "auto"（既定）なら、周回の頭ごとに「参加中のサークル」を読み直して決める
// （新しく入ったサークルも次の周回から対象になる）。番号を並べた配列か --targets で渡したときは、その固定の一覧。
const FIXED_TARGETS = arg("--targets")?.split(",") ?? (Array.isArray(config().targets) ? config().targets : null);
const AUTO = !FIXED_TARGETS;
let TARGETS = FIXED_TARGETS ?? ["timeline"]; // auto のときは、最初の周回の頭で参加中のサークルを足す
const INTERVAL = Number(arg("--interval") ?? config().intervalSeconds ?? 300);
const CYCLES = Number(arg("--cycles") ?? Infinity);
const CLEANUP = args.includes("--cleanup"); // 動作確認用: 終わるときに、最後の投稿も消す

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => {
  const line = `[${new Date().toLocaleString("ja-JP", { hour12: false })}] ${m}`;
  console.log(line);
  appendFileSync(join(LOGS, "run.log"), line + "\n");
};
const notify = (msg) => execFile("osascript", ["-e", `display notification "${msg}" with title "yay自動投稿"`], () => {});

// 二重起動の防止と、スリープ防止
acquireLock(LOCK, "run.mjs");
keepAwake();

class Fatal extends Error {}

// 前の投稿を消す。消えたことは「投稿そのもののページ（404）」で確かめてから記録する。
// 一覧に出てこないだけでは、消えたとは見なさない（2026-10-06 に、一覧が読めなかっただけの投稿を
// 「消えた」と早合点して記録を閉じ、2件が数時間残った。その反省）
async function removePrevious(page, target) {
  for (const prev of pending(LEDGER, target)) {
    let inList = true;
    try {
      await waitForCard(page, target, prev.id, 45000);
    } catch {
      inList = false;
    }
    if (!inList) {
      const state = await postState(page, target, prev.id); // 確認できなければここで投げる（新しく投稿しない）
      if (state === "deleted") {
        append(LEDGER, { target, id: prev.id, deleted: true, note: "投稿のページが404（すでに消えている）" });
        log(`前の投稿はすでに消えていました (${target}) ${prev.id}`);
        continue;
      }
      log(`一覧には出ませんが、投稿はまだあります。投稿のページから消します (${target}) ${prev.id}`);
    }
    await deletePost(page, prev.id); // 一覧のカード、または開いている投稿のページのカードから消す
    if ((await postState(page, target, prev.id)) !== "deleted") throw new Error(`削除したのに残っています (${prev.id})`);
    append(LEDGER, { target, id: prev.id, deleted: true });
    log(`消しました (${target}) ${prev.id}`);
  }
}

// 投稿する文は、周回の頭で読み直す（編集画面で保存した文が、次の周回から使われる）。
//   クラウドの設定があれば、クラウドが正。取れたら config.json の text にも控え、届かないときはその控えで続ける。
//   クラウドの設定が無ければ、config.json の text をそのまま読む。
const CLOUD = loadCloud(config());
let currentText = config().text;
let cloudOk = true; // 直前の取得が成功したか。切り替わったときだけ記録する（毎回だと run.log が埋まる）

// アプリの「投稿を止める」。止められているあいだは、プロセスは動いたまま、投稿だけを見合わせる。
//   画面の状態が読めなかったときは、最後に分かっていた状態のまま（止めたはずが、通信の失敗で再開しない）。
//   その状態は logs/paused.json に控えるので、Mac を再起動した直後に通信がつながっていなくても、止めたまま始まる。
const PAUSE_POLL_MS = 15 * 1000;
const pause = createPauseTracker({
  file: CLOUD ? join(LOGS, "paused.json") : null,
  onChange: (paused) => {
    log(paused ? "画面で止められました。投稿を見合わせます" : "画面で再開されました。投稿を再開します");
    reportStatus(); // 画面が「Mac が受け取った」と分かるように、すぐ知らせる
  },
});

function saveLocalText(text) {
  const file = join(HERE, "config.json");
  const next = { ...config(), text };
  writeFileSync(`${file}.tmp`, JSON.stringify(next, null, 2) + "\n");
  renameSync(`${file}.tmp`, file);
}

async function refreshText() {
  if (CLOUD) {
    try {
      const fresh = await pullState(CLOUD);
      pause.observe(fresh.paused);
      // 止められていないのに文が使えないときだけ、失敗として手元の文で続ける
      if (fresh.problem && !fresh.paused) throw new Error(fresh.problem);
      if (!cloudOk) {
        cloudOk = true;
        log("クラウドから文を読めるようになりました");
      }
      if (fresh.text && fresh.text !== currentText) {
        saveLocalText(fresh.text); // 手元にも控える
        currentText = fresh.text;
        log(`文が差し替わりました（クラウド）: ${fresh.text.replace(/\n/g, " / ")}`);
      }
      return;
    } catch (e) {
      if (cloudOk) {
        cloudOk = false;
        log(`クラウドから文を読めません（${e.message}）。手元の文で続けます`);
      }
    }
  }
  const local = config().text;
  if (typeof local === "string" && local.trim() && local !== currentText) {
    currentText = local;
    log(`文が差し替わりました（config.json）: ${local.replace(/\n/g, " / ")}`);
  }
}

// 画面に「Mac は動いている・最後の投稿はこれ」を出すための報告。届かなくても投稿には影響しない
function reportStatus() {
  if (CLOUD) pushStatus(CLOUD, { ...stats(LEDGER), paused: pause.paused }).catch(() => {});
}

// 画面で止められた（再開された）ことを、周回の途中や待ち時間にも早く知るため、一定の間隔で印だけ読み直す。
// 文は読み直さない（文の切り替えは、これまでどおり周回の頭だけ）。
if (CLOUD) {
  setInterval(() => {
    pullState(CLOUD)
      .then((state) => pause.observe(state.paused))
      .catch(() => {}); // 読めなければ、最後に分かっていた状態のまま
  }, PAUSE_POLL_MS).unref();
}

// 周回の頭で、投稿先（タイムライン＋参加中のサークル）を読み直す。
//   ・読めなかったときは、前に読めた一覧で続ける（読めない原因は、ログイン切れなら投稿のほうで止まる）
//   ・一覧が突然空になったときは、読み違いとみなして前の一覧で続ける
//   ・入れない決め（名前の「ショタ」「ロリ」など）は targets.mjs。除外したサークルは、理由と一緒にログへ出す
const TARGETS_FILE = join(LOGS, "targets.json");
let lastGood = null; // 前回うまく決められた投稿先 { targets, excluded }
let listOk = true; // 直前の読み込みが成功したか。切り替わったときだけ記録する

function readSavedTargets() {
  try {
    const saved = JSON.parse(readFileSync(TARGETS_FILE, "utf8"));
    return Array.isArray(saved.targets) && saved.targets[0] === "timeline" ? saved : null;
  } catch {
    return null;
  }
}

const groupsOf = (targets) => targets.filter((t) => t !== "timeline");

async function refreshTargets() {
  if (!AUTO) return;
  try {
    const joined = await listJoinedGroups(page);
    if (joined.length === 0 && groupsOf(lastGood?.targets ?? []).length > 0) throw new Error("参加中のサークルが0件と返ってきました（読み違いの可能性）");
    const picked = pickTargets(joined, config());
    const before = groupsOf(lastGood?.targets ?? TARGETS);
    const after = groupsOf(picked.targets);
    if (!lastGood) {
      log(`投稿先を参加中のサークルから決めました: タイムライン + ${after.length}サークル (${after.join(", ")})`);
    } else {
      const added = after.filter((t) => !before.includes(t));
      const removed = before.filter((t) => !after.includes(t));
      if (added.length || removed.length) log(`参加中のサークルが変わりました: 追加 [${added.join(", ")}] / 外れた [${removed.join(", ")}]`);
    }
    // 除外したものは、変わったときだけ理由つきで記録する（毎周回だと run.log が埋まる）
    const sig = (x) => JSON.stringify([x.excluded.map((e) => e.id), x.truncated]);
    if (!lastGood || sig(lastGood) !== sig(picked)) {
      for (const e of picked.excluded) log(`投稿しないサークル: ${e.id} 「${e.name}」（${e.reason}）`);
      if (picked.truncated > 0) {
        log(`サークルが多いため、上限で${picked.truncated}件は対象にしていません（config.json の maxGroups）`);
        notify(`サークルが多いため${picked.truncated}件は投稿していません`);
      }
    }
    if (!listOk) {
      listOk = true;
      log("参加中のサークルを読めるようになりました");
    }
    lastGood = picked;
    TARGETS = picked.targets;
    writeFileSync(TARGETS_FILE, JSON.stringify({ t: new Date().toISOString(), ...picked }, null, 2) + "\n");
  } catch (e) {
    if (listOk) {
      listOk = false;
      log(`参加中のサークルを読めません（${e.message.split("\n")[0]}）。前の一覧で続けます`);
    }
    if (!lastGood) {
      // 起動してすぐ読めなかったとき: 前に決めた一覧が残っていればそれで、無ければタイムラインだけで続ける
      const saved = readSavedTargets();
      if (saved) {
        lastGood = saved;
        TARGETS = saved.targets;
      }
    }
  }
}

// 同じサークルが3周続けて失敗したら、約1時間（12周）飛ばす。投稿できない設定のサークル（承認制など）が
// 毎周回の失敗を積み上げて、ほかの場所まで巻き込んで止めるのを防ぐ。タイムラインは飛ばさない
const badRounds = new Map();
const skipUntil = new Map();
const SKIP_AFTER = 3;
const SKIP_CYCLES = 12;

async function cycleTarget(page, target) {
  await removePrevious(page, target);
  await openTarget(page, target);
  const text = currentText;
  const made = await createPost(page, text, { target });
  append(LEDGER, { target, id: made.id, text }); // 投稿した直後に、消すための記録を残す
  log(`投稿しました (${target}) ${made.id}`);
}

const fatalPattern = /ログインが切れ|HTTP (403|429)|自分の投稿ではない/;
// 専用 Chrome のウインドウ／タブを閉じられた・Chrome を終了された、というときのエラー
const closedPattern = /has been closed|Target closed|Target page|Browser has been closed|Connection closed|disconnected|Session closed|ECONNREFUSED|Browser context management|Chrome に接続できません/i;
let failures = 0;
let cycles = 0;
let { browser, page } = await connect();
page.on("dialog", (d) => d.accept());

// 画面（ウインドウ／タブ）が閉じられたら、つなぎ直す。Chrome ごと終了されていれば、connect() が起動し直す
async function reattach(reason) {
  log(`Chrome の画面が閉じられたようです（${reason}）。つなぎ直します`);
  await browser.close().catch(() => {});
  ({ browser, page } = await connect());
  page.on("dialog", (d) => d.accept());
  await openTarget(page, TARGETS[0]);
}
try {
  await openTarget(page, TARGETS[0]);
  await selfId(page); // 自分のユーザー番号を、作りの揃った一覧の画面で先に読んで覚えておく
} catch (e) {
  log(`止まります: 起動時の確認に失敗: ${e.message.split("\n")[0]}`);
  notify(`起動できません: ${e.message.slice(0, 60)}`);
  await browser.close().catch(() => {});
  process.exit(1);
}
log(`開始: ${AUTO ? "タイムライン + 参加中のサークル（周回ごとに読み直し）" : TARGETS.join(", ")} / ${INTERVAL}秒ごと${CYCLES === Infinity ? "" : ` / ${CYCLES}周で終了`}`);

try {
  while (cycles < CYCLES) {
    const started = Date.now();
    await refreshText();
    // 画面で止められているあいだは、ブラウザにも触れずに待つ（周回には数えない）。
    // STOP を見逃さないよう、1秒ずつ区切って待つ。
    if (pause.paused) {
      if (existsSync(STOP)) {
        log("STOP ファイルがあるので止めます");
        break;
      }
      reportStatus();
      for (let i = 0; i < PAUSE_POLL_MS / 1000 && !existsSync(STOP); i++) await sleep(1000);
      continue;
    }
    await refreshTargets();
    reportStatus();
    for (const target of TARGETS) {
      if (existsSync(STOP)) break;
      // 周回の途中で止められたら、そこで打ち切る。いま出ている投稿は消さず、そのまま残す
      if (pause.paused) {
        log("画面で止められたので、この周回を途中で打ち切ります");
        break;
      }
      if ((skipUntil.get(target) ?? 0) > cycles) continue;
      try {
        try {
          await cycleTarget(page, target);
        } catch (e) {
          if (!closedPattern.test(e.message)) throw e;
          await reattach(e.message.split("\n")[0].slice(0, 60));
          await cycleTarget(page, target); // 1回だけやり直す（前の投稿は、記録にあるものとして消してから投稿する）
        }
        failures = 0;
        badRounds.delete(target);
      } catch (e) {
        failures++;
        const msg = e.message.split("\n")[0];
        log(`失敗 (${target}) ${failures}回目: ${msg}`);
        if (fatalPattern.test(msg) || failures >= 3) throw new Fatal(msg);
        const bad = (badRounds.get(target) ?? 0) + 1;
        badRounds.set(target, bad);
        if (target !== "timeline" && bad >= SKIP_AFTER) {
          badRounds.delete(target);
          skipUntil.set(target, cycles + SKIP_CYCLES);
          log(`(${target}) は${SKIP_AFTER}周続けて失敗したので、約${Math.round((SKIP_CYCLES * INTERVAL) / 60)}分お休みします`);
        }
      }
    }
    cycles++;
    reportStatus();
    if (existsSync(STOP)) {
      log("STOP ファイルがあるので止めます");
      break;
    }
    // 次の周回まで。1秒ごとに STOP を見る
    while (cycles < CYCLES && Date.now() - started < INTERVAL * 1000) {
      if (existsSync(STOP) || pause.paused) break; // 待っているあいだに止められたら、すぐ次の周回の頭（止めて待つところ）へ
      await sleep(1000);
    }
  }
  if (CLEANUP) {
    for (const target of TARGETS) await removePrevious(page, target);
    log("動作確認の後始末: 残っていた投稿を消しました");
  }
} catch (e) {
  log(`止まります: ${e.message.split("\n")[0]}`);
  notify(`止まりました: ${e.message.slice(0, 60)}`);
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
  log("終了");
}

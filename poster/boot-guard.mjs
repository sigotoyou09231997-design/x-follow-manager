// Mac 本体を再起動したあとは、自動投稿を止めたままにする部品。
// launchd は、ログインのたびに投稿役を自動で起こす。そのままだと、再起動した瞬間に勝手に投稿が再開してしまうので、
// 「前に動いたときと起動時刻（kern.boottime）が違う＝再起動された」と分かったら、STOP を置いて終わる。
// 再開は手で（bash launchd.sh restart）。同じ起動のあいだの再起動（クラッシュの立て直し・launchd.sh restart・install）は止めない。
// 控え（logs/boot-seen.txt）が無い最初の1回は、記録するだけで止めない（入れた直後に止まらないように）。
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

// 起動時刻（秒）。読めなければ null（そのときは止めない）
export function readBootTime() {
  try {
    const m = /sec\s*=\s*(\d+)/.exec(execFileSync("sysctl", ["-n", "kern.boottime"], { encoding: "utf8" }));
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

// 前回記録した起動時刻と今を比べて、止めるべきか。
// 起動時刻は秒の丸めで1〜2秒ずれることがあるので、5秒までの差は同じ起動とみなす
export function rebootedSince(prev, current) {
  if (prev == null || current == null) return false;
  return Math.abs(current - prev) > 5;
}

// 再起動後の最初の起動なら STOP を置いて true を返す。呼んだ側は、そのまま終わること
export function holdAfterReboot({ seenFile, stopFile, boot = readBootTime() }) {
  if (boot == null) return false;
  let prev = null;
  if (existsSync(seenFile)) {
    const n = Number(readFileSync(seenFile, "utf8").trim());
    prev = Number.isFinite(n) && n > 0 ? n : null;
  }
  writeFileSync(seenFile, String(boot));
  if (!rebootedSince(prev, boot)) return false;
  writeFileSync(stopFile, `Mac の再起動で止めました (${new Date().toISOString()})\n`);
  return true;
}

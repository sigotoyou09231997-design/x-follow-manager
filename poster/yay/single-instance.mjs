// 二重起動の防止と、スリープ防止。launchd（自動起動）と手動の起動が重なって、二重に投稿しないための部品。
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

// その番号のプロセスが生きていて、しかも同じスクリプトか（番号が別のプロセスに使い回されていないか）
function alive(pid, name) {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    return execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" }).includes(name);
  } catch {
    return false;
  }
}

export function acquireLock(file, name) {
  if (existsSync(file)) {
    const pid = Number(readFileSync(file, "utf8"));
    if (pid && pid !== process.pid && alive(pid, name)) {
      console.error(`すでに動いています (pid ${pid})`);
      process.exit(1);
    }
  }
  writeFileSync(file, String(process.pid));
  const unlock = () => {
    try {
      if (Number(readFileSync(file, "utf8")) === process.pid) unlinkSync(file);
    } catch {}
  };
  process.on("exit", unlock);
  process.on("SIGINT", () => process.exit(130));
  process.on("SIGTERM", () => process.exit(143));
}

// このプロセスが動いている間だけ、Mac をスリープさせない（caffeinate -w は、指定したプロセスが終わると自分も終わる）。
// unref しないと、子の caffeinate が残る間は node が終われず、caffeinate は node の終了を待つので、お互い待ち合って終われなくなる
export function keepAwake() {
  const child = spawn("/usr/bin/caffeinate", ["-i", "-w", String(process.pid)], { stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
}

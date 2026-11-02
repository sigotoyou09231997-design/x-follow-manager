// node --test poster/boot-guard.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { holdAfterReboot, readBootTime, rebootedSince } from "./boot-guard.mjs";

function withTmp(run) {
  const dir = mkdtempSync(join(tmpdir(), "boot-guard-"));
  try {
    return run({ seenFile: join(dir, "boot-seen.txt"), stopFile: join(dir, "STOP") });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("起動時刻が違えば再起動、同じ（数秒のずれ込み）なら同じ起動", () => {
  assert.equal(rebootedSince(1000, 5000), true);
  assert.equal(rebootedSince(1000, 1002), false);
  assert.equal(rebootedSince(null, 5000), false);
  assert.equal(rebootedSince(1000, null), false);
});

test("控えが無い最初の1回は記録だけして止めない", () => {
  withTmp((f) => {
    assert.equal(holdAfterReboot({ ...f, boot: 1000 }), false);
    assert.equal(existsSync(f.stopFile), false);
    assert.equal(readFileSync(f.seenFile, "utf8"), "1000");
  });
});

test("同じ起動のあいだに何度起こされても止めない（クラッシュの立て直し・launchd.sh restart）", () => {
  withTmp((f) => {
    holdAfterReboot({ ...f, boot: 1000 });
    assert.equal(holdAfterReboot({ ...f, boot: 1000 }), false);
    assert.equal(existsSync(f.stopFile), false);
  });
});

test("再起動のあとの最初の起動は STOP を置いて止め、その次（手で再開したあと）は止めない", () => {
  withTmp((f) => {
    holdAfterReboot({ ...f, boot: 1000 });
    assert.equal(holdAfterReboot({ ...f, boot: 9000 }), true);
    assert.equal(existsSync(f.stopFile), true);
    assert.equal(readFileSync(f.seenFile, "utf8"), "9000");
    rmSync(f.stopFile);
    assert.equal(holdAfterReboot({ ...f, boot: 9000 }), false);
    assert.equal(existsSync(f.stopFile), false);
  });
});

test("控えが壊れていても止めずに直す", () => {
  withTmp((f) => {
    writeFileSync(f.seenFile, "abc");
    assert.equal(holdAfterReboot({ ...f, boot: 1000 }), false);
    assert.equal(readFileSync(f.seenFile, "utf8"), "1000");
  });
});

test("この Mac の起動時刻が読める", () => {
  const t = readBootTime();
  assert.ok(t === null || t > 1_500_000_000);
});

// node --test poster/pause-state.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPauseTracker, readPausedFile } from "./pause-state.mjs";

function withTmp(run) {
  const dir = mkdtempSync(join(tmpdir(), "pause-state-"));
  try {
    return run(join(dir, "paused.json"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("控えが無ければ「止めていない」で始まる", () => {
  withTmp((file) => {
    assert.equal(createPauseTracker({ file }).paused, false);
  });
});

test("画面で止められたと読めたら止まり、変わったときだけ onChange を呼ぶ", () => {
  withTmp((file) => {
    const changes = [];
    const tracker = createPauseTracker({ file, onChange: (p) => changes.push(p) });

    assert.equal(tracker.observe(false), false); // 変わらない
    assert.equal(tracker.observe(true), true);
    assert.equal(tracker.observe(true), false); // 同じ状態は何度読んでも通知しない
    assert.equal(tracker.paused, true);
    assert.equal(tracker.observe(false), true);
    assert.deepEqual(changes, [true, false]);
  });
});

test("止めた状態は控えられ、再起動したあと（まだ画面から読めなくても）止めたまま始まる", () => {
  withTmp((file) => {
    createPauseTracker({ file }).observe(true);
    assert.equal(JSON.parse(readFileSync(file, "utf8")).paused, true);

    const restarted = createPauseTracker({ file }); // 通信がまだつながらない＝observe が呼ばれない
    assert.equal(restarted.paused, true);

    restarted.observe(false); // 読めた時点で、画面の状態（再開）に追いつく
    assert.equal(createPauseTracker({ file }).paused, false);
  });
});

test("控えが壊れていたら「止めていない」（読めた時点で追いつく）", () => {
  withTmp((file) => {
    writeFileSync(file, "{ここは壊れている");
    assert.equal(readPausedFile(file), false);
    writeFileSync(file, JSON.stringify({ paused: "true" })); // 文字列の "true" を真と読み違えない
    assert.equal(readPausedFile(file), false);
  });
});

test("クラウドを使わないとき（file なし）は、控えを作らず、止めた状態も持ち越さない", () => {
  const tracker = createPauseTracker({ file: null });
  assert.equal(tracker.paused, false);
  tracker.observe(true);
  assert.equal(tracker.paused, true); // 動いている間だけ
  assert.equal(createPauseTracker({ file: null }).paused, false);
});

test("控えを書けなくても（置き場所が無い等）、止める・再開するの判断は動く", () => {
  const tracker = createPauseTracker({ file: "/proc/nonexistent/dir/paused.json" });
  assert.doesNotThrow(() => tracker.observe(true));
  assert.equal(tracker.paused, true);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { guardAccount } from "./account-guard.mjs";

const setup = () => {
  const dir = mkdtempSync(join(tmpdir(), "acct-"));
  return { dir, idFile: join(dir, "account.json"), ledgerFile: join(dir, "posted.jsonl") };
};

test("初めては、番号だけ覚えて、控えはそのまま", () => {
  const { idFile, ledgerFile } = setup();
  writeFileSync(ledgerFile, '{"id":"1"}\n');
  assert.deepEqual(guardAccount({ idFile, ledgerFile, id: "111" }), { switched: false, from: null });
  assert.equal(JSON.parse(readFileSync(idFile, "utf8")).id, "111");
  assert.ok(existsSync(ledgerFile));
});

test("同じアカウントなら何もしない", () => {
  const { idFile, ledgerFile } = setup();
  writeFileSync(ledgerFile, '{"id":"1"}\n');
  guardAccount({ idFile, ledgerFile, id: "111" });
  assert.equal(guardAccount({ idFile, ledgerFile, id: "111" }).switched, false);
  assert.ok(existsSync(ledgerFile));
});

test("別のアカウントなら、古い控えを取り分けて（消さない）、新しい番号を覚える", () => {
  const { dir, idFile, ledgerFile } = setup();
  writeFileSync(ledgerFile, '{"id":"1"}\n');
  guardAccount({ idFile, ledgerFile, id: "111" });
  const r = guardAccount({ idFile, ledgerFile, id: "222" });
  assert.equal(r.switched, true);
  assert.equal(r.from, "111");
  assert.equal(existsSync(ledgerFile), false); // 新しい控えから始まる
  assert.equal(readFileSync(r.archived, "utf8"), '{"id":"1"}\n');
  assert.ok(readdirSync(dir).some((f) => f.startsWith("posted-account111-")));
  assert.equal(JSON.parse(readFileSync(idFile, "utf8")).id, "222");
});

test("番号が読めなかったときは、何も変えない", () => {
  const { idFile, ledgerFile } = setup();
  writeFileSync(ledgerFile, '{"id":"1"}\n');
  guardAccount({ idFile, ledgerFile, id: "111" });
  assert.equal(guardAccount({ idFile, ledgerFile, id: null }).switched, false);
  assert.ok(existsSync(ledgerFile));
});

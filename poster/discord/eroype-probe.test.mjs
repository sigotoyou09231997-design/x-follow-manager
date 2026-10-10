// node --test eroype-probe.test.mjs
// 調べる道具の「読むだけ・値を出さない・外へ出ない」の部分を確かめる（本物の画面との一致は、Mac で動かして見る）。
import test from "node:test";
import assert from "node:assert/strict";
import { apiPathsIn, deleteHints, looksLikeDelete, resolveTarget, shapeOf, snippetsAround } from "./eroype-probe.mjs";

test("調べるページは eroype.net の中だけ（別のサイトは受け付けない）", () => {
  assert.equal(resolveTarget("/mypage").href, "https://eroype.net/mypage");
  assert.equal(resolveTarget("https://eroype.net/posts/1").href, "https://eroype.net/posts/1");
  assert.throws(() => resolveTarget("https://example.com/mypage"), /eroype\.net の外/);
  assert.throws(() => resolveTarget("//example.com/mypage"), /eroype\.net の外/);
  assert.throws(() => resolveTarget("https://eroype.net.evil.example/"), /eroype\.net の外/);
});

test("通信の中身は形だけにして、投稿の文などの値は出さない", () => {
  const shape = shapeOf({
    ok: true,
    posts: [
      { id: 12, message: "ひみつの本文", tags: ["a", "b"], createdAt: "2026-10-10T00:00:00Z" },
      { id: 13, message: "もう1件", tags: [], createdAt: "x" },
    ],
    next: null,
  });
  assert.deepEqual(shape, {
    ok: "boolean",
    posts: { _array: 2, _item: { id: "number", message: "string(6)", tags: { _array: 2, _item: "string(1)" }, createdAt: "string(20)" } },
    next: "null",
  });
  assert.ok(!JSON.stringify(shape).includes("ひみつ"));
  assert.deepEqual(shapeOf([]), { _array: 0, _item: null });
  // 深すぎる入れ子で止まる
  let deep = { v: 1 };
  for (let i = 0; i < 10; i++) deep = { child: deep };
  assert.match(JSON.stringify(shapeOf(deep)), /\{…\}/);
});

test("削除らしい文言を見つける", () => {
  for (const t of ["削除", "投稿を削除する", "Delete", "btn-remove", "trash-icon", "ゴミ箱へ", "消す"]) assert.equal(looksLikeDelete(t), true, t);
  for (const t of ["投稿する", "マイページ", "編集", "", null, undefined]) assert.equal(looksLikeDelete(t), false, String(t));
  assert.equal(looksLikeDelete("", null, "aria: 削除"), true);
});

test("圧縮されたスクリプトから API のパスを拾う", () => {
  const src = `a.post("/api/sp/posts",b);fetch(\`/api/sp/posts/\${id}\`,{method:"DELETE"});x="/api/profile";y='/not-api/x';z="/api/me?x=1"`;
  assert.deepEqual(apiPathsIn(src), ["/api/me", "/api/profile", "/api/sp/posts", "/api/sp/posts/${id}"]);
});

test("method: DELETE の呼び出しの周りを切り出す", () => {
  const src = `${"x".repeat(500)}fetch("/api/sp/posts/"+id,{method:"DELETE",credentials:"include"}).then(r=>r.ok)${"y".repeat(500)}`;
  const { calls, labels } = deleteHints(src);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/api\/sp\/posts\/"\+id,\{method:"DELETE"/);
  assert.ok(calls[0].length < 400, "前後は決めた幅で切る");
  assert.deepEqual(labels, []);
  // 小文字でも、シングルクォートでも見つける
  assert.equal(deleteHints(`fetch(u,{method:'delete'})`).calls.length, 1);
  // 文言
  assert.equal(deleteHints(`<button>この投稿を削除しますか？</button>`).labels.length, 1);
});

test("切り出しの件数には上限がある", () => {
  const src = "削除 ".repeat(100);
  assert.equal(snippetsAround(src, /削除/, 5, 3).length, 3);
  assert.equal(deleteHints(src).labels.length, 6);
});

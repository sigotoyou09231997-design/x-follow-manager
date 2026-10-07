// node --test targets.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickTargets } from "./targets.mjs";

const g = (id, name) => ({ id, name });

test("参加中のサークルは全部入る（タイムラインが先頭、順番は一覧のまま）", () => {
  const { targets, excluded, truncated } = pickTargets([g(416294, "耳弱"), g(88567, "電話/通話/寝落ち募集4"), g(330116, "メンヘラ")]);
  assert.deepEqual(targets, ["timeline", "group:416294", "group:88567", "group:330116"]);
  assert.deepEqual(excluded, []);
  assert.equal(truncated, 0);
});

test("名前に「ショタ」「ロリ」を含むサークルは、参加中でも入れない", () => {
  const { targets, excluded } = pickTargets([
    g(387028, "【ショタ】お姉さん甘えたい人来て"),
    g(1, "ロリ好き集まれ"),
    g(2, "ふつうのサークル"),
  ]);
  assert.deepEqual(targets, ["timeline", "group:2"]);
  assert.deepEqual(excluded.map((e) => e.id), ["387028", "1"]);
});

test("ひらがな・全角半角・大小文字の違いでは、すり抜けられない", () => {
  const { targets } = pickTargets([g(1, "しょた集合"), g(2, "ｼｮﾀ募集"), g(3, "ろり"), g(4, "OK")]);
  assert.deepEqual(targets, ["timeline", "group:4"]);
});

test("既知の2つは、名前が変わっても番号で外れる", () => {
  const { targets, excluded } = pickTargets([g(387028, "名前を変えた"), g(264892, "これも変えた")]);
  assert.deepEqual(targets, ["timeline"]);
  assert.equal(excluded.length, 2);
});

test("config.json の除外は足される。固定の除外は config から消しても外れる", () => {
  const joined = [g(10, "入れたくない所"), g(20, "ほかの所"), g(30, "テストの名前NG")];
  const { targets } = pickTargets(joined, { excludeGroups: [10], excludeNameWords: ["NG"] });
  assert.deepEqual(targets, ["timeline", "group:20"]);
  const empty = pickTargets([g(387028, "x"), g(5, "ショタ")], { excludeGroups: [], excludeNameWords: [] });
  assert.deepEqual(empty.targets, ["timeline"]);
});

test("数の上限を超えた分は入れず、いくつ入れなかったかを返す", () => {
  const joined = Array.from({ length: 5 }, (_, i) => g(100 + i, `サークル${i}`));
  const { targets, truncated } = pickTargets(joined, { maxGroups: 3 });
  assert.deepEqual(targets, ["timeline", "group:100", "group:101", "group:102"]);
  assert.equal(truncated, 2);
});

test("参加中のサークルが無ければ、タイムラインだけ", () => {
  assert.deepEqual(pickTargets([]).targets, ["timeline"]);
});

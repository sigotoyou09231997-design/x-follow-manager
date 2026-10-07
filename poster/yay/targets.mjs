// 投稿先を「参加中のサークル」から決める部品。画面操作はせず、一覧を受け取って選ぶだけ（だから単体で試せる）。
//
//   joined : [{ id, name }]   … yay.mjs の listJoinedGroups が返す、参加中のサークル
//   戻り値 : { targets, excluded, truncated }
//     targets   … ["timeline", "group:<番号>", ...]（タイムラインが先頭）
//     excluded  … 対象から外したサークル [{ id, name, reason }]
//     truncated … 数の上限で入れなかった数
//
// 対象から外すもの（コードに固定してあり、config.json から消しても外れる）:
//   ・名前に「ショタ」「ロリ」を含むサークル … 未成年がいる可能性があり、そこへ連絡をうながす投稿を
//     機械で繰り返し出さない（2026-10-05 に本人と合意した決め。参加中でも入れない）
//   ・config.json の excludeGroups に番号を書いたサークル（入れたくない所を本人が足す）
// config.json の excludeNameWords は、この固定の言葉に「足す」ためのもの（減らせない）。

export const FIXED_EXCLUDE_GROUPS = ["387028", "264892"];
export const FIXED_EXCLUDE_WORDS = ["ショタ", "ロリ"];
export const DEFAULT_MAX_GROUPS = 20;

// 全角・半角、ひらがな・カタカナの違いで、除外の言葉をすり抜けないように揃えてから比べる
export function foldName(s) {
  return String(s ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
}

export function pickTargets(joined, config = {}) {
  const excludedIds = new Set([...FIXED_EXCLUDE_GROUPS, ...(config.excludeGroups ?? []).map(String)]);
  const words = [...FIXED_EXCLUDE_WORDS, ...(config.excludeNameWords ?? [])].map(foldName).filter(Boolean);
  const max = Number.isInteger(config.maxGroups) && config.maxGroups > 0 ? config.maxGroups : DEFAULT_MAX_GROUPS;

  const kept = [];
  const excluded = [];
  for (const g of joined) {
    const id = String(g.id);
    const word = words.find((w) => foldName(g.name).includes(w));
    if (excludedIds.has(id)) excluded.push({ id, name: g.name, reason: "除外の番号" });
    else if (word) excluded.push({ id, name: g.name, reason: `名前に「${word}」を含む` });
    else kept.push({ id, name: g.name });
  }
  const limited = kept.slice(0, max);
  return {
    targets: ["timeline", ...limited.map((g) => `group:${g.id}`)],
    excluded,
    truncated: kept.length - limited.length,
  };
}

// 「この道具が投稿した投稿」の記録（logs/posted.jsonl）。
// 消してよいのは、ここに番号が残っていて、まだ「削除済み」の行が無い投稿だけ。
//   投稿: { t, target, id, text }          削除: { t, target, id, deleted: true, note? }
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export function readLedger(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((l) => {
      try {
        return [JSON.parse(l)];
      } catch {
        return [];
      }
    });
}

export function append(file, row) {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify({ t: new Date().toISOString(), ...row }) + "\n");
}

// まだ消していない投稿（古い順）。target を渡せばその場所だけ
export function pending(file, target) {
  const rows = readLedger(file);
  const deleted = new Set(rows.filter((r) => r.deleted).map((r) => `${r.target}:${r.id}`));
  return rows.filter((r) => !r.deleted && r.id && (!target || r.target === target) && !deleted.has(`${r.target}:${r.id}`));
}

// 画面に報告する数字: 最後に投稿した時刻と文、今日の投稿件数（削除の行は数えない）
export function stats(file) {
  const made = readLedger(file).filter((r) => r.id && !r.deleted && r.text);
  const last = made.at(-1) ?? null;
  const today = new Date().toLocaleDateString("ja-JP");
  return {
    lastPost: last ? { t: last.t, text: last.text.replace(/\n/g, " / ") } : null,
    today: made.filter((r) => new Date(r.t).toLocaleDateString("ja-JP") === today).length,
  };
}

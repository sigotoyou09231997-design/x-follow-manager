// アカウントを入れ替えたことに気づく部品（Yay で使う）。
//
// 投稿の記録（posted.jsonl）は「前の投稿を消す」ための控えで、そのアカウントの投稿の番号が入っている。
// アカウントを替えたのに古い控えが残っていると、別のアカウントの投稿を消しに行って「自分の投稿ではない」で止まる
// （安全装置が働いて止まるので壊れはしないが、入れ替えるたびに手で控えを片付けることになる）。
// そこで、起動のたびに「いまログインしているアカウントの番号」を覚えておいた番号と見比べ、違っていたら
// 古い控えを別の名前に取り分けて、新しい控えから始める。取り分けた控えは消さない（戻せる）。
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const readId = (file) => {
  try {
    return JSON.parse(readFileSync(file, "utf8")).id ?? null;
  } catch {
    return null;
  }
};

/**
 * @returns {{ switched: boolean, from: string|null, archived?: string }}
 * 初めて（覚えた番号が無い）ときは、いまの控えをこのアカウントのものとみなして、番号だけ覚える。
 */
export function guardAccount({ idFile, ledgerFile, id, now = () => new Date() }) {
  const known = readId(idFile);
  if (!id) return { switched: false, from: known }; // 番号が読めないときは、何も変えない
  const remember = () => writeFileSync(idFile, JSON.stringify({ id, at: now().toISOString() }) + "\n");
  if (known === id) return { switched: false, from: known };
  if (known === null) {
    remember();
    return { switched: false, from: null };
  }
  let archived;
  if (existsSync(ledgerFile)) {
    const stamp = now().toISOString().replace(/[:.]/g, "-");
    archived = join(dirname(ledgerFile), `posted-account${known}-${stamp}.jsonl`);
    renameSync(ledgerFile, archived);
  }
  remember();
  return { switched: true, from: known, archived };
}

// 「いま書きかけの入力がある」ことを画面から申告しておくための小さな登録所。
//
// 更新バナーは新しいビルドを自動で適用する＝ページを読み込み直すため、投稿の本文を
// 書いている最中にそれをやると入力が消える。予約投稿の下書きはサーバーにもIndexedDBにも
// 保存されないまま画面の状態としてだけ存在するので、失うと取り返せない。
// そこで、書きかけの間だけ真を返す判定をここへ預けてもらい、バナー側が適用を待つ。

type Guard = () => boolean

const guards = new Set<Guard>()

/** 書きかけかどうかを返す関数を登録する。戻り値を呼ぶと解除される。 */
export function registerEditingGuard(guard: Guard): () => void {
  guards.add(guard)
  return () => {
    guards.delete(guard)
  }
}

/** 登録された判定のどれか1つでも「書きかけ」と言えば真。 */
export function isEditing(): boolean {
  for (const guard of guards) {
    try {
      if (guard()) return true
    } catch {
      // 判定側が壊れていても更新を止め続ける理由にはしない
    }
  }
  return false
}

/** テスト用。登録をすべて捨てる。 */
export function resetEditingGuardsForTest(): void {
  guards.clear()
}

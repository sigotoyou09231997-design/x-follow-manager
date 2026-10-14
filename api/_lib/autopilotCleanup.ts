import { DELETED_MARK } from '../../src/lib/xAutopilot/types.js'

// X の自動運転は、次の投稿が出たとき、前に自動運転が出した投稿を X から消す（いつも最新の1本だけが残る）。
// 消すのは「自動運転が出した」と記録のある投稿だけ。本人が自分で書いたツイートや、ふつうの予約投稿には触れない。
// 保存先や X への通信は外から渡す（ここは決まりごとだけ。テストでは偽物を渡す）。

/** 自動運転が出して、まだ消していない投稿1件（予約の行）。 */
export interface PreviousPost {
  id: string
  /** この予約が X に出した投稿の ID（スレッドなら複数）。 */
  tweetIds: string[]
}

export interface CleanupDeps {
  /** 今出した投稿（exceptId）を除く、自動運転が出した・まだ消していない投稿。古い順。 */
  listPrevious(userId: string, exceptId: string): Promise<PreviousPost[]>
  /** X から1件消す。すでに無いときも成功で返す。失敗は throw。 */
  deleteTweet(tweetId: string): Promise<void>
  /** 消し終えた予約の行に、消した印（DELETED_MARK）を付ける。 */
  markDeleted(id: string): Promise<void>
}

/**
 * 1回の実行で消す投稿の上限。過去に出した分がたくさん溜まっているときも、一度に何十件も消さず、
 * 次の投稿のたびに少しずつ片付ける（X の利用制限と、関数の実行時間のため）。
 */
export const MAX_DELETIONS_PER_RUN = 10

export interface CleanupResult {
  /** 消し終えた予約の行の数。 */
  deleted: number
  /** 消せなかった予約の行の数（印を付けないので、次の機会にやり直す）。 */
  failed: number
}

/**
 * 今出した投稿より前の、自動運転の投稿を X から消す。
 * 1件でも消せなかった予約は印を付けずに残し、次の投稿のときにやり直す。1件の失敗で残りを止めない。
 * 投稿そのものの成否には影響させない（呼ぶ側で、失敗を握りつぶして記録するだけにする）。
 */
export async function deletePreviousAutopilotPosts(
  deps: CleanupDeps,
  userId: string,
  justPostedId: string
): Promise<CleanupResult> {
  const previous = (await deps.listPrevious(userId, justPostedId)).filter((post) => post.id !== justPostedId)
  const result: CleanupResult = { deleted: 0, failed: 0 }

  for (const post of previous.slice(0, MAX_DELETIONS_PER_RUN)) {
    if (post.tweetIds.length === 0) continue
    try {
      for (const tweetId of post.tweetIds) await deps.deleteTweet(tweetId)
    } catch (error) {
      result.failed += 1
      console.error(`autopilot cleanup: 投稿の削除に失敗しました (${post.id}):`, (error as Error).message)
      continue
    }
    try {
      await deps.markDeleted(post.id)
      result.deleted += 1
    } catch (error) {
      // X からは消えた。印だけ付けられなかった。次回また消そうとしても、X は「無い」と返す（成功扱い）ので害はない。
      result.failed += 1
      console.error(`autopilot cleanup: 削除済みの印を付けられませんでした (${post.id}):`, (error as Error).message)
    }
  }
  return result
}

export { DELETED_MARK }

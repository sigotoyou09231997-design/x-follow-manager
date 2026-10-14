// 「投稿可能にする」を押したとき、その予約の投稿時刻をどうするか。
// 投稿可能な予約のうちで、これがいちばん早い（これより前の投稿可能な予約が無い）なら、待たせず、できるだけ早く出す。
// これより前の投稿可能な予約があるなら、時刻はそのまま（その後ろに並ぶ）。

/** 押してから投稿までの猶予。押し間違いに気づいて「確認待ちに戻す」を押せるくらいは残す。 */
export const APPROVE_LEAD_MS = 5 * 60_000

interface PostTime {
  id: string
  status: string
  scheduledAt?: string
}

/**
 * 投稿可能にするとき、投稿時刻を前倒しするなら、その新しい時刻（ISO8601）。前倒ししないなら undefined。
 * 他の投稿可能な予約（status が scheduled）の中に、この予約より前の時刻のものがあれば、前倒ししない。
 * すでに「いまから猶予ぶん」より前の時刻（時刻を過ぎている・すぐ出る）なら、これ以上は動かさない。
 */
export function soonestApprovalTime(post: PostTime, others: PostTime[], now: number): string | undefined {
  if (!post.scheduledAt) return undefined
  const current = new Date(post.scheduledAt).getTime()
  const soonest = now + APPROVE_LEAD_MS
  if (current <= soonest) return undefined
  const earlierApproved = others.some(
    (o) => o.id !== post.id && o.status === 'scheduled' && o.scheduledAt && new Date(o.scheduledAt).getTime() < current
  )
  return earlierApproved ? undefined : new Date(soonest).toISOString()
}

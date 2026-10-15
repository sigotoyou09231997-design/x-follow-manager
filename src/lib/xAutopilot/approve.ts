// 「投稿可能」な予約の投稿時刻の決め方。確認してから投稿する設定（requireApproval）のときだけ使う
// （確認なしの自動投稿は、時刻をばらして散らす決まりなので、動かさない）。
//
// 投稿可能な予約は、できるだけ早く出す。ただし、直前の自動運転の投稿から最低限の間隔はあける（連投に見えないため）。
// 動かすのは、本人が「投稿可能にする」を押した、その1回だけ（押す前に、画面のボタンに投稿される時刻を出す）。
// 押していない予約を、あとから自動で動かしたり、早めて投稿したりはしない（勝手に投稿されるのを避けるため）。
//   ・投稿可能な予約の中でいちばん早ければ、いますぐ側へ前倒しする。前に投稿可能な予約があれば、
//     その列のすぐ後ろ（次に空いている枠）へ詰める。

import { toZonedParts } from '../schedule/repeat.js'

/** 1日の投稿数の上限（設定の「1日の投稿数」）と、日の数え方（設定の地域）。 */
export interface DailyCap {
  postsPerDay: number
  timeZone: string
}

const dayKey = (ms: number, timeZone: string): string => {
  const p = toZonedParts(ms, timeZone)
  return `${p.year}-${p.month}-${p.day}`
}

/**
 * その日（ms の属する日）に、すでに出した・出している・投稿可能な、自動運転の投稿が何本あるか。
 * 前倒しや投稿可能にした結果、1日の投稿数を超えないかを見るために数える。except は数えない予約（動かす本人）。
 */
export function postsOnDay(autopilot: PostTime[], ms: number, cap: DailyCap, exceptId?: string): number {
  const key = dayKey(ms, cap.timeZone)
  return autopilot.filter((p) => {
    const t = at(p.scheduledAt)
    return (
      p.id !== exceptId &&
      t !== undefined &&
      (p.status === 'posted' || p.status === 'publishing' || p.status === 'scheduled') &&
      dayKey(t, cap.timeZone) === key
    )
  }).length
}

/** 押してから投稿までの猶予。押し間違いに気づいて「確認待ちに戻す」を押せるくらいは残す。 */
export const APPROVE_LEAD_MS = 5 * 60_000

/** 自動運転の投稿と投稿の、最低限の間隔。枠の最小間隔（LIMITS.minGapMinutes）と同じ。 */
export const MIN_POST_GAP_MS = 30 * 60_000

/**
 * 確認してから投稿する設定で、取り消した枠を作り直す条件: その枠の時刻が、いまからこれ以上先であること。
 * 近い枠（過ぎた枠・すぐの枠）は、消したのにまた同じ時間帯に出てくるのを避けるため、空けたままにする。
 * 遠い枠（たとえば明日）は、候補が減っていく（AIの文章が止まったように見える）のを避けるため、作り直す。
 */
export const REFILL_MIN_LEAD_MS = 2 * 60 * 60_000

interface PostTime {
  id: string
  status: string
  scheduledAt?: string
  /** 本人が投稿時刻を決めた予約。自動では動かさない。 */
  fixedTime?: boolean
}

const at = (iso: string | undefined): number | undefined => {
  if (!iso) return undefined
  const ms = new Date(iso).getTime()
  return Number.isFinite(ms) ? ms : undefined
}

/** 直前に出た（出している途中も含む）自動運転の投稿の時刻（ms）。無ければ undefined。 */
export function lastPostedAt(autopilot: PostTime[]): number | undefined {
  const times = autopilot
    .filter((p) => p.status === 'posted' || p.status === 'publishing')
    .map((p) => at(p.scheduledAt))
    .filter((t): t is number => t !== undefined)
  return times.length > 0 ? Math.max(...times) : undefined
}

/** いまから出せるいちばん早い時刻（ms）。直前の投稿から間隔をあける。 */
export function earliestAllowed(now: number, lastPosted: number | undefined, lead: number): number {
  const base = now + lead
  return lastPosted === undefined ? base : Math.max(base, lastPosted + MIN_POST_GAP_MS)
}

/**
 * 投稿可能にするとき、投稿時刻を前倒しするなら、その新しい時刻（ISO8601）。前倒ししないなら undefined。
 * `autopilot` は、同じ人の自動運転の予約すべて（投稿済みも含む）。
 * 他の投稿可能な予約（status が scheduled）の中に、この予約より前の時刻のものがあれば、前倒ししない。
 * 前倒し先は「いまから猶予ぶん」と「直前の投稿から最低間隔」の遅いほう。それより前の時刻なら、これ以上は動かさない。
 */
export function soonestApprovalTime(
  post: PostTime,
  autopilot: PostTime[],
  now: number,
  slotTimes: number[] = [],
  cap?: DailyCap
): string | undefined {
  // 本人が時刻を決めた予約は、投稿可能にしても、時刻を動かさない。
  if (post.fixedTime) return undefined
  const current = at(post.scheduledAt)
  if (current === undefined) return undefined
  const earlier = autopilot
    .filter((o) => o.id !== post.id && o.status === 'scheduled')
    .map((o) => at(o.scheduledAt))
    .filter((t): t is number => t !== undefined && t < current)

  // これより前の投稿可能な予約が無ければ、できるだけ早く（いまから猶予ぶん、直前の投稿から最低間隔）。
  // どちらも、その日の投稿数が1日の上限（cap）に達している日には置かない（今日すでに上限まで出ているなら、次の日の枠へ）。
  const hasRoom = (ms: number) => !cap || postsOnDay(autopilot, ms, cap, post.id) < cap.postsPerDay
  if (earlier.length === 0) {
    const target = earliestAllowed(now, lastPostedAt(autopilot), APPROVE_LEAD_MS)
    if (hasRoom(target)) return current <= target ? undefined : new Date(target).toISOString()
    const next = slotTimes.filter((t) => t >= target && hasRoom(t)).sort((a, b) => a - b)[0]
    return next !== undefined && next < current ? new Date(next).toISOString() : undefined
  }

  // 前に投稿可能な予約があるなら、その列のすぐ後ろ（最後の予約から最低間隔あけた、次の枠の時刻）へ。
  // 遠い日の予約を投稿可能にしても、間をあけずに、次に空いている枠（たとえば明日の午前）へ詰める。
  const floor = Math.max(Math.max(...earlier) + MIN_POST_GAP_MS, now + APPROVE_LEAD_MS)
  const next = slotTimes.filter((t) => t >= floor && hasRoom(t)).sort((a, b) => a - b)[0]
  return next !== undefined && next < current ? new Date(next).toISOString() : undefined
}

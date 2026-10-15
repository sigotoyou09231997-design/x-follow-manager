import { toZonedParts, zonedTimeToUtc } from '../schedule/repeat.js'

// 確認してから投稿する設定（requireApproval）のとき、「今日の午前中は、もう作らない」。
// 朝（6時）を過ぎてから、今日の午前中の時刻の予約を新しく作っても、確認する頃にはもう過ぎている・消した枠の作り直しで
// 同じ時間帯にまた出てくる、になるだけ。前の日までに作ってあった午前の予約（確認して投稿可能にできる）は、そのまま残す。

/** 朝とみなす時刻（その地域の時）。これ以降、今日の午前中の枠は新しく作らない。 */
export const MORNING_FROM_HOUR = 6
/** 午前の終わり（その地域の時）。 */
export const MORNING_TO_HOUR = 12

/** 今日の午前中の枠か、かつ、もう朝（6時以降）か。この枠は、新しく作らない。 */
export function isLateMorningSlot(slotAtIso: string, now: number, timeZone: string): boolean {
  const slot = toZonedParts(new Date(slotAtIso).getTime(), timeZone)
  const today = toZonedParts(now, timeZone)
  if (today.hour < MORNING_FROM_HOUR) return false
  const sameDay = slot.year === today.year && slot.month === today.month && slot.day === today.day
  return sameDay && slot.hour < MORNING_TO_HOUR
}

export interface MorningWindow {
  /** 今日の午前中の予約を探す範囲（時刻の欄）。 */
  scheduledFrom: string
  scheduledTo: string
  /** この時刻以降に作られた（＝朝になってから作られた）ものだけを取り消す。 */
  createdAfter: string
}

/** 取り消す対象を探す範囲。まだ朝（6時前）なら null（何も取り消さない）。 */
export function morningWindow(now: number, timeZone: string): MorningWindow | null {
  const t = toZonedParts(now, timeZone)
  if (t.hour < MORNING_FROM_HOUR) return null
  const at = (hour: number) => new Date(zonedTimeToUtc(t.year, t.month, t.day, hour, 0, timeZone)).toISOString()
  return { scheduledFrom: at(0), scheduledTo: at(MORNING_TO_HOUR), createdAfter: at(MORNING_FROM_HOUR) }
}

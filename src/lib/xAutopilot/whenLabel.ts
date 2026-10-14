import { toZonedParts } from '../schedule/repeat.js'

// 予約の投稿時刻を、ひと目で分かる形にする: 「今日／明日／10/16(金)」＋「14:16」＋「あと2時間」。
// 時刻は、自動運転の設定の地域の時刻で見せる（端末の時差に左右されない）。

const WEEKDAY = ['日', '月', '火', '水', '木', '金', '土']

export interface WhenParts {
  /** 「今日」「明日」、それ以外は「10/16(金)」。 */
  day: string
  /** 「14:16」。 */
  time: string
  /** 「あと2時間」「あと35分」。1日以上先と、時刻を過ぎたものは空（過ぎたものは過ぎたと別に伝える）。 */
  rel: string
}

const dayKey = (ms: number, timeZone: string) => {
  const p = toZonedParts(ms, timeZone)
  return Date.UTC(p.year, p.month - 1, p.day)
}

export function whenParts(iso: string | undefined, timeZone: string, now: number): WhenParts | null {
  if (!iso) return null
  const at = new Date(iso).getTime()
  if (!Number.isFinite(at)) return null

  const p = toZonedParts(at, timeZone)
  const dayDiff = Math.round((dayKey(at, timeZone) - dayKey(now, timeZone)) / 86_400_000)
  const day = dayDiff === 0 ? '今日' : dayDiff === 1 ? '明日' : `${p.month}/${p.day}(${WEEKDAY[p.weekday]})`
  const time = `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`

  const minutes = Math.round((at - now) / 60_000)
  let rel = ''
  if (minutes > 0 && minutes < 24 * 60) {
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    rel = h === 0 ? `あと${m}分` : m === 0 ? `あと${h}時間` : `あと${h}時間${m}分`
  }
  return { day, time, rel }
}

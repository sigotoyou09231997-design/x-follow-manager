// 「5日前」「1週間前」のような相対時刻。
// タイムラインや一覧では絶対時刻より経過量のほうが読みやすい。
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY

export function relativeTime(timestamp: number | undefined, now: number = Date.now()): string {
  if (!timestamp) return ''
  const diff = Math.max(0, now - timestamp)
  if (diff < MINUTE) return 'たった今'
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}分前`
  if (diff < DAY) return `${Math.floor(diff / HOUR)}時間前`
  if (diff < WEEK) return `${Math.floor(diff / DAY)}日前`
  if (diff < 30 * DAY) return `${Math.floor(diff / WEEK)}週間前`
  if (diff < 365 * DAY) return `${Math.floor(diff / (30 * DAY))}か月前`
  return `${Math.floor(diff / (365 * DAY))}年前`
}

import { toZonedParts, zonedTimeToUtc } from '../schedule/repeat.js'

// 自動運転の予約の時刻を、画面の入力欄（datetime-local）で直すための変換。
// 自動運転の時刻は、設定の地域（日本時間など）で見せている。入力欄も同じ地域の時刻で出し入れしないと、
// 端末の時差しだいで「画面に出ている時刻」と「保存される時刻」がずれる。

const pad = (n: number) => String(n).padStart(2, '0')

/** 予約の時刻（ISO8601）を、その地域の 'YYYY-MM-DDTHH:mm'（datetime-local の値）にする。 */
export function toInputValue(iso: string, timeZone: string): string {
  const p = toZonedParts(new Date(iso).getTime(), timeZone)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`
}

/** その地域の 'YYYY-MM-DDTHH:mm' を、予約に保存する時刻（ISO8601・UTC）にする。読めない値は null。 */
export function fromInputValue(value: string, timeZone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim())
  if (!m) return null
  const [year, month, day, hour, minute] = m.slice(1).map(Number)
  const ms = zonedTimeToUtc(year, month, day, hour, minute, timeZone)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

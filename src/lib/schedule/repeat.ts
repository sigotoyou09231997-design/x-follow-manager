import type { RepeatRule } from './types'

// 繰り返し予約の「次の投稿時刻」を求める。
// 予約時刻はユーザーのタイムゾーンのローカル時刻（例: 毎週月曜9:00 JST）で指定されるため、
// 夏時間のある地域でもズレないよう、ローカル日時→UTC瞬間の変換を Intl 経由で行う。

interface ZonedParts {
  year: number
  month: number // 1-12
  day: number
  weekday: number // 0=日曜
  hour: number
  minute: number
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  })
}

/** UTCの瞬間を、指定タイムゾーンでのカレンダー上の値に分解する。 */
export function toZonedParts(timestamp: number, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(new Date(timestamp))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0'
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    weekday: WEEKDAY_INDEX[get('weekday')] ?? 0,
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  }
}

/** 指定タイムゾーンにおけるUTCオフセット(ミリ秒)。 */
function offsetAt(timestamp: number, timeZone: string): number {
  const p = toZonedParts(timestamp, timeZone)
  const secondsPart = formatterFor(timeZone)
    .formatToParts(new Date(timestamp))
    .find((x) => x.type === 'second')?.value
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, Number(secondsPart ?? 0))
  return asUtc - timestamp
}

/**
 * 「そのタイムゾーンでのローカル日時」をUTCの瞬間(ms)に変換する。
 * オフセットは変換先の瞬間によって変わる（夏時間）ため、一度推定してから
 * その結果で再計算する2段階にしている。
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): number {
  const naive = Date.UTC(year, month - 1, day, hour, minute)
  const firstGuess = naive - offsetAt(naive, timeZone)
  return naive - offsetAt(firstGuess, timeZone)
}

function parseTime(time: string): { hour: number; minute: number } {
  const [h, m] = time.split(':')
  return { hour: Number(h) || 0, minute: Number(m) || 0 }
}

/** 日付だけを取り出した通し日数。interval の判定に使う。 */
function daysSinceEpoch(year: number, month: number, day: number): number {
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000)
}

/**
 * 繰り返しルールに従って、`after` より後の最初の投稿時刻を返す。
 * 見つからない場合（until を過ぎている等）は undefined。
 *
 * @param anchorIso interval の起点。テンプレートを作成した日時。
 *                  「隔週」は、この週から数えて偶数週に投稿する、という意味になる。
 */
export function nextOccurrence(
  rule: RepeatRule,
  afterIso: string,
  anchorIso: string
): string | undefined {
  const after = new Date(afterIso).getTime()
  const anchor = new Date(anchorIso).getTime()
  if (Number.isNaN(after) || Number.isNaN(anchor)) return undefined

  const { hour, minute } = parseTime(rule.time)
  const interval = Math.max(1, Math.floor(rule.interval || 1))
  const tz = rule.timeZone
  const anchorParts = toZonedParts(anchor, tz)
  const anchorDays = daysSinceEpoch(anchorParts.year, anchorParts.month, anchorParts.day)

  const untilTs = rule.until
    ? zonedTimeToUtc(
        Number(rule.until.slice(0, 4)),
        Number(rule.until.slice(5, 7)),
        Number(rule.until.slice(8, 10)),
        23,
        59,
        tz
      )
    : undefined

  // `after` の当日から順に前進して、条件に合う最初の日を探す。
  // monthly で「31日」を指定した場合に短い月を飛ばすため、余裕を持って約2年分見る。
  const start = toZonedParts(after, tz)
  const cursor = new Date(Date.UTC(start.year, start.month - 1, start.day))

  for (let i = 0; i < 800; i += 1) {
    const year = cursor.getUTCFullYear()
    const month = cursor.getUTCMonth() + 1
    const day = cursor.getUTCDate()
    const weekday = cursor.getUTCDay()

    if (matchesRule(rule, interval, anchorParts, anchorDays, { year, month, day, weekday })) {
      const ts = zonedTimeToUtc(year, month, day, hour, minute, tz)
      if (ts > after) {
        if (untilTs !== undefined && ts > untilTs) return undefined
        return new Date(ts).toISOString()
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return undefined
}

function matchesRule(
  rule: RepeatRule,
  interval: number,
  anchorParts: ZonedParts,
  anchorDays: number,
  candidate: { year: number; month: number; day: number; weekday: number }
): boolean {
  if (rule.freq === 'daily') {
    const diff = daysSinceEpoch(candidate.year, candidate.month, candidate.day) - anchorDays
    return diff >= 0 && diff % interval === 0
  }

  if (rule.freq === 'weekly') {
    const weekdays = rule.byWeekday?.length ? rule.byWeekday : [anchorParts.weekday]
    if (!weekdays.includes(candidate.weekday)) return false
    if (interval === 1) return true
    // その週の日曜を基準にして、アンカー週から何週離れているかで判定する。
    const candidateWeekStart =
      daysSinceEpoch(candidate.year, candidate.month, candidate.day) - candidate.weekday
    const anchorWeekStart = anchorDays - anchorParts.weekday
    const weeks = Math.round((candidateWeekStart - anchorWeekStart) / 7)
    return weeks >= 0 && weeks % interval === 0
  }

  // monthly
  const targetDay = rule.byMonthday ?? anchorParts.day
  if (candidate.day !== targetDay) return false
  const months =
    (candidate.year - anchorParts.year) * 12 + (candidate.month - anchorParts.month)
  return months >= 0 && months % interval === 0
}

/** 画面表示用に「毎週月・水 9:00」のような日本語の説明文を作る。 */
export function describeRepeatRule(rule: RepeatRule): string {
  const names = ['日', '月', '火', '水', '木', '金', '土']
  const every = rule.interval > 1 ? `${rule.interval}` : ''
  if (rule.freq === 'daily') {
    return `${every ? `${every}日ごと` : '毎日'} ${rule.time}`
  }
  if (rule.freq === 'weekly') {
    const days = (rule.byWeekday ?? []).map((d) => names[d]).join('・')
    const prefix = every ? `${every}週ごと` : '毎週'
    return `${prefix}${days ? ` ${days}曜` : ''} ${rule.time}`
  }
  const prefix = every ? `${every}か月ごと` : '毎月'
  return `${prefix}${rule.byMonthday ? ` ${rule.byMonthday}日` : ''} ${rule.time}`
}

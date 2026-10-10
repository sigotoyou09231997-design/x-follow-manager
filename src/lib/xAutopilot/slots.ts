// 相対 import に .js を付けているのは、このファイルをサーバー関数（api/）も読むため。
// Vercel では拡張子の無い相対 import が ERR_MODULE_NOT_FOUND で落ちる（api/serverImports.test.ts が見張っている）。
import { toZonedParts, zonedTimeToUtc } from '../schedule/repeat.js'
import { DEFAULT_SETTINGS, LIMITS, type AutopilotSettings } from './types.js'

// 投稿する「枠」（日付＋何番目か＋時刻）の決め方。
// 枠は日付と番号から決まる（乱数ではなく、決まった式）ので、何度計算しても同じ時刻になる。
// 何度も計算しても、すでに作った枠を二重に作らず、作り直す必要も出ない。

export interface Slot {
  /** 'YYYY-MM-DD#番号'（その地域の日付）。scheduled_posts.ai_prompt と、作成済みの枠の記録に使う。 */
  key: string
  /** 投稿する時刻（ISO8601, UTC）。 */
  at: string
}

const HM = /^([01]\d|2[0-3]):([0-5]\d)$/

function toMinutes(hm: string): number {
  const m = HM.exec(hm)
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false
  }
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

/** 数として読めれば整数に丸める。読めない（未入力・文字）ときだけ既定値。0 は有効な入力として範囲に収める。 */
const toInt = (value: unknown, fallback: number): number => {
  if (value === undefined || value === null || value === '') return fallback
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n) : fallback
}

/**
 * 画面や保存先から来た設定を、使える形に直す。範囲外・形の違うものは既定に戻し、
 * 投稿数は時間帯に収まる数までに抑える（枠の間隔の下限があるため、狭い時間帯に8本は入らない）。
 */
export function normalizeSettings(input: Partial<AutopilotSettings> | null | undefined): AutopilotSettings {
  const d = DEFAULT_SETTINGS
  const raw = input ?? {}

  let windowStart = typeof raw.windowStart === 'string' && HM.test(raw.windowStart) ? raw.windowStart : d.windowStart
  let windowEnd = typeof raw.windowEnd === 'string' && HM.test(raw.windowEnd) ? raw.windowEnd : d.windowEnd
  // 終わりが始まりより後でない・狭すぎる（1時間未満）と枠が作れない。
  if (toMinutes(windowEnd) - toMinutes(windowStart) < 60) {
    windowStart = d.windowStart
    windowEnd = d.windowEnd
  }

  const span = toMinutes(windowEnd) - toMinutes(windowStart)
  const maxByWindow = Math.max(1, Math.floor(span / LIMITS.minGapMinutes))
  const postsPerDay = clamp(
    toInt(raw.postsPerDay, d.postsPerDay),
    LIMITS.postsPerDay.min,
    Math.min(LIMITS.postsPerDay.max, maxByWindow)
  )

  return {
    postsPerDay,
    windowStart,
    windowEnd,
    timeZone: typeof raw.timeZone === 'string' && isValidTimeZone(raw.timeZone) ? raw.timeZone : d.timeZone,
    horizonDays: clamp(toInt(raw.horizonDays, d.horizonDays), LIMITS.horizonDays.min, LIMITS.horizonDays.max),
    monthlyBudgetYen: clamp(
      toInt(raw.monthlyBudgetYen, d.monthlyBudgetYen),
      LIMITS.monthlyBudgetYen.min,
      LIMITS.monthlyBudgetYen.max
    ),
    quality: raw.quality === 'saver' ? 'saver' : 'standard',
  }
}

/**
 * 設定が成り立たない理由を日本語で返す（空なら大丈夫）。
 * normalizeSettings は「保存済みの値を読む」ときに使う寛容な直し方（範囲外は既定へ）で、
 * 画面から来た入力にそれを使うと、入力の途中の値や押し間違いが、黙って別の設定に化ける
 * （時間帯が既定の 8:00〜23:00 に戻る・回数が減る、など）。ユーザーが選んだ設定は、
 * 直さずに理由を見せて止める。
 */
export function settingsProblems(input: Partial<AutopilotSettings>): string[] {
  const problems: string[] = []
  const { postsPerDay, horizonDays, monthlyBudgetYen, windowStart, windowEnd } = input

  // 渡された項目だけを調べる（保存では保存済みの設定と合わせた全項目、画面では全項目が来る）。
  const startOk = typeof windowStart === 'string' && HM.test(windowStart)
  const endOk = typeof windowEnd === 'string' && HM.test(windowEnd)
  if ((windowStart !== undefined && !startOk) || (windowEnd !== undefined && !endOk)) {
    problems.push('投稿する時間帯の時刻を入力してください')
  } else if (startOk && endOk) {
    const span = toMinutes(windowEnd) - toMinutes(windowStart)
    if (span < 60) {
      problems.push('時間帯は1時間以上あけてください（終わりを、始めより後にしてください）')
    } else if (typeof postsPerDay === 'number') {
      const max = Math.floor(span / LIMITS.minGapMinutes)
      if (postsPerDay > max) {
        problems.push(
          `この時間帯には、1日${max}回までしか入りません（投稿と投稿の間を${LIMITS.minGapMinutes}分以上あけるため）。時間帯を広げるか、回数を減らしてください`
        )
      }
    }
  }
  if (postsPerDay !== undefined && !(Number.isInteger(postsPerDay) && postsPerDay >= LIMITS.postsPerDay.min && postsPerDay <= LIMITS.postsPerDay.max)) {
    problems.push(`1日の投稿数は${LIMITS.postsPerDay.min}〜${LIMITS.postsPerDay.max}回にしてください`)
  }
  if (horizonDays !== undefined && !(Number.isInteger(horizonDays) && horizonDays >= LIMITS.horizonDays.min && horizonDays <= LIMITS.horizonDays.max)) {
    problems.push(`何日先まで並べるかは${LIMITS.horizonDays.min}〜${LIMITS.horizonDays.max}日にしてください`)
  }
  if (
    monthlyBudgetYen !== undefined &&
    !(Number.isFinite(monthlyBudgetYen) && monthlyBudgetYen >= LIMITS.monthlyBudgetYen.min && monthlyBudgetYen <= LIMITS.monthlyBudgetYen.max)
  ) {
    problems.push(`月の上限は${LIMITS.monthlyBudgetYen.min.toLocaleString('ja-JP')}〜${LIMITS.monthlyBudgetYen.max.toLocaleString('ja-JP')}円で入力してください`)
  }
  return problems
}

const pad = (n: number) => String(n).padStart(2, '0')

/** その地域の日付 'YYYY-MM-DD'。 */
export function localDate(timestamp: number, timeZone: string): string {
  const p = toZonedParts(timestamp, timeZone)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

/** その地域の月 'YYYY-MM'。使用状況を月ごとに数えるため。 */
export function localMonth(timestamp: number, timeZone: string): string {
  return localDate(timestamp, timeZone).slice(0, 7)
}

/** 文字列から 0 以上 1 未満の数を決まった式で作る（FNV-1a）。枠の時刻をばらつかせるため。 */
function hash01(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) / 0x1_0000_0000
}

/** この時間より近い枠は作らない（作ってすぐの投稿は、書いた文を見て止める猶予が無い）。 */
const MIN_LEAD_MINUTES = 5

/**
 * 今から horizonDays 日ぶんの枠を、時刻の早い順に返す（過去の枠は含まない）。
 * 1日の枠は、時間帯を投稿数で等分した真ん中を基準に、日付と番号から決まるずれを加えて散らす。
 * 毎日同じ時刻に出ると機械的に見え、X側にも自動投稿と気づかれやすいため。
 */
export function planSlots(now: Date, settings: AutopilotSettings): Slot[] {
  const { postsPerDay: count, timeZone } = settings
  const gap = LIMITS.minGapMinutes
  const start = toMinutes(settings.windowStart)
  const end = toMinutes(settings.windowEnd)
  const segment = (end - start) / count

  const today = toZonedParts(now.getTime(), timeZone)
  const earliest = now.getTime() + MIN_LEAD_MINUTES * 60_000
  const slots: Slot[] = []

  for (let day = 0; day < settings.horizonDays; day++) {
    // 月末をまたいでも暦どおりに進めるため、UTCの暦で日数を足してから取り出す。
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + day))
    const [y, m, d] = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()]
    const dateKey = `${y}-${pad(m)}-${pad(d)}`

    let previous = start - gap
    for (let i = 0; i < count; i++) {
      const jitter = (hash01(`${dateKey}#${i}`) * 2 - 1) * segment * 0.3
      let minute = Math.round(start + (i + 0.5) * segment + jitter)
      // 前の枠から最小間隔を空け、後ろの枠が時間帯に収まる余地も残す。
      const latest = end - (count - 1 - i) * gap
      minute = Math.min(Math.max(minute, previous + gap), latest)
      previous = minute

      const at = zonedTimeToUtc(y, m, d, Math.floor(minute / 60), minute % 60, timeZone)
      if (at < earliest) continue
      slots.push({ key: `${dateKey}#${i}`, at: new Date(at).toISOString() })
    }
  }
  return slots
}

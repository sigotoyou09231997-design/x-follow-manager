import { createHash } from 'node:crypto'

// 掲示板・Yay の自動投稿で使う、文と状態の決まりごと（画面からも Mac の投稿役からも同じ決まりで通す）。
// 保存先に依存しない部分だけをここに置く。保存は autopostStore.ts。

export const MAX_LENGTH = 1000
const MAX_ARCHIVE = 100

export type ChannelName = 'discord' | 'yay'

/**
 * 投稿先ごとに持てる文の数。discord は順に回す（最大10）。
 * yay は1回に1つだけ投稿する。複数持てるのは「時間帯ごとに文を変える」ため（いまの時間に合う、いちばん上の1つが使われる）。
 */
export const CHANNELS: Record<ChannelName, { maxMessages: number }> = {
  discord: { maxMessages: 10 },
  yay: { maxMessages: 5 },
}

export function isChannelName(value: unknown): value is ChannelName {
  // Vercel が関数を組み立てるときの型の設定は ES2022 より古く、Object.hasOwn が通らない
  return typeof value === 'string' && Object.keys(CHANNELS).includes(value)
}

export class DocError extends Error {}

/** 文を整える。形が違えば DocError（画面にそのまま出せる日本語）。 */
export function cleanMessages(input: unknown, maxMessages: number): string[] {
  if (!Array.isArray(input) || input.length === 0) throw new DocError('文が1つもありません')
  if (input.length > maxMessages) {
    throw new DocError(maxMessages === 1 ? 'この投稿先は文を1つだけ設定できます' : `文は${maxMessages}個までです`)
  }
  return input.map((m, i) => {
    if (typeof m !== 'string') throw new DocError('文は文字列で送ってください')
    const text = m.replace(/\r\n?/g, '\n').trim()
    if (!text) throw new DocError(input.length === 1 ? '文が空です' : `${i + 1}つ目の文が空です`)
    if (text.length > MAX_LENGTH) {
      throw new DocError(`文が長すぎます（${text.length}文字。上限${MAX_LENGTH}文字）`)
    }
    return text
  })
}

/**
 * 文を投稿してよい時間帯。日本時間の「時」（0〜23）を小さい順に並べたもの。null は終日（いつでも）。
 * 「9」なら 9:00〜9:59。24時間ぜんぶ選んだものは null に直す（同じ意味を2通りで持たない）。
 */
export type Hours = number[] | null

const HOUR_ZONE = 'Asia/Tokyo'

/** 時間帯を整える。形が違えば DocError（画面にそのまま出せる日本語）。 */
export function cleanHours(input: unknown, count: number): Hours[] {
  if (!Array.isArray(input) || input.length !== count) throw new DocError('時間帯の数が文の数と合いません')
  return input.map((h, i) => {
    if (h === null) return null
    const name = count === 1 ? '時間帯' : `${i + 1}つ目の時間帯`
    if (!Array.isArray(h) || h.length === 0) {
      throw new DocError(`${name}が選ばれていません。時間を1つ以上選ぶか、「終日」にしてください`)
    }
    if (!h.every((n) => Number.isInteger(n) && n >= 0 && n <= 23)) throw new DocError(`${name}が正しくありません`)
    const sorted = [...new Set(h as number[])].sort((a, b) => a - b)
    return sorted.length === 24 ? null : sorted
  })
}

/**
 * 文を差し替えたあとの messages・hours・archive。外れた古い文は archive（履歴）へ移す。
 * hoursInput が無いとき（時間帯を知らない古い画面からの保存）は、同じ文に付いていた時間帯を引き継ぐ。
 * 黙って終日に戻してしまうと、休ませていた時間にも投稿が始まってしまうため。
 */
export function applySave(
  current: { messages: string[]; hours: Hours[]; archive: string[] },
  input: unknown,
  maxMessages: number,
  hoursInput?: unknown
): { messages: string[]; hours: Hours[]; archive: string[] } {
  const messages = cleanMessages(input, maxMessages)
  const hours =
    hoursInput === undefined
      ? messages.map((m) => {
          const at = current.messages.indexOf(m)
          return at >= 0 ? (current.hours[at] ?? null) : null
        })
      : cleanHours(hoursInput, messages.length)
  const archive = [...current.archive]
  for (const old of current.messages) {
    if (!messages.includes(old) && !archive.includes(old)) archive.push(old)
  }
  return {
    messages,
    hours,
    archive: archive.filter((a) => !messages.includes(a)).slice(-MAX_ARCHIVE),
  }
}

/** いまの日本時間の「時」（0〜23）。Mac や Vercel の時計の地域には頼らない。 */
export function hourInJapan(date: Date): number {
  const text = new Intl.DateTimeFormat('en-US', { timeZone: HOUR_ZONE, hour: 'numeric', hourCycle: 'h23' }).format(date)
  return Number(text) % 24
}

export interface Schedule {
  /** 判定に使った日本時間の「時」。 */
  hour: number
  /** いま投稿に使う文（messages の何番目か）。 */
  activeIndexes: number[]
  /** 文はあるのに、この時間に使える文が無く、投稿を休んでいる。 */
  idle: boolean
  /** 休んでいるとき、次に投稿が始まる「時」。この先も使える文が無ければ null。 */
  nextHour: number | null
}

/**
 * その「時」に投稿に使う文。時間を決めた文が当たっていれば、その文だけを使う（朝の文を決めたら、朝は朝の文だけになる）。
 * 当たる文が無い時間は、時間を決めていない文を使う。それも無ければ空（＝その時間は投稿を休む）。
 */
export function activeIndexesAt(hours: Hours[], hour: number): number[] {
  const timed = hours.flatMap((h, i) => (h?.includes(hour) ? [i] : []))
  if (timed.length > 0) return timed
  return hours.flatMap((h, i) => (h === null ? [i] : []))
}

/** 投稿先ごとの、いまの時間に使う文。yay は1回に1つだけ投稿するので、当たった文の先頭だけ。 */
export function scheduleAt(channel: ChannelName, hours: Hours[], date: Date): Schedule {
  const limit = (indexes: number[]) => (channel === 'yay' ? indexes.slice(0, 1) : indexes)
  const hour = hourInJapan(date)
  const activeIndexes = limit(activeIndexesAt(hours, hour))
  const idle = hours.length > 0 && activeIndexes.length === 0
  let nextHour: number | null = null
  if (idle) {
    for (let step = 1; step <= 24; step++) {
      const h = (hour + step) % 24
      if (activeIndexesAt(hours, h).length > 0) {
        nextHour = h
        break
      }
    }
  }
  return { hour, activeIndexes, idle, nextHour }
}

export interface PosterStatus {
  lastPost: { t: string; text: string } | null
  today: number
  /**
   * 投稿役が「いま止まっている」と受け止めているか。画面で止めたあと、本当に止まったかを確かめる印。
   * 止める機能より前の投稿役は送ってこない（無いときは「まだ受け取っていない」と扱う）。
   */
  paused?: boolean
  /** サーバーが受け取った時刻。Mac の時計には頼らない。 */
  at: string
  /**
   * 「止まっている」とスマホへ通知した時刻（api/_lib/posterWatch.ts が書く）。同じ止まりで毎分通知しないための印。
   * Mac の報告は status ごと入れ替わるので、投稿役が戻って報告すれば自然に消える。Mac は送ってこない。
   */
  alertedAt?: string
}

/** Mac の投稿役からの報告を検める。形が違えば DocError。 */
export function readPosterReport(body: unknown): Omit<PosterStatus, 'at'> {
  const { lastPost, today, paused } = (body ?? {}) as { lastPost?: unknown; today?: unknown; paused?: unknown }
  const last = lastPost as { t?: unknown; text?: unknown } | null | undefined
  const okLast =
    last === null ||
    (!!last &&
      typeof last.t === 'string' &&
      typeof last.text === 'string' &&
      last.text.length <= MAX_LENGTH * 2)
  if (!okLast || typeof today !== 'number' || !Number.isInteger(today) || today < 0) {
    throw new DocError('形が違います')
  }
  // paused は無くてもよいが、あるなら真偽値。文字列の "false" などを真と読み違えて止まったことにしない。
  if (paused !== undefined && typeof paused !== 'boolean') throw new DocError('形が違います')
  return {
    lastPost: last ? { t: last.t as string, text: last.text as string } : null,
    today,
    ...(paused === undefined ? {} : { paused }),
  }
}

/** 合鍵の保存形。合鍵そのものは置かず、この値だけを突き合わせる。 */
export function hashPosterKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

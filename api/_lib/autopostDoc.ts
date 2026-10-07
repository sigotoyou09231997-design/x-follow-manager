import { createHash } from 'node:crypto'

// 掲示板・Yay の自動投稿で使う、文と状態の決まりごと（画面からも Mac の投稿役からも同じ決まりで通す）。
// 保存先に依存しない部分だけをここに置く。保存は autopostStore.ts。

export const MAX_LENGTH = 1000
const MAX_ARCHIVE = 100

export type ChannelName = 'discord' | 'yay'

/** 投稿先ごとに回せる文の数。discord は順に回す（最大10）、yay は1つだけ。 */
export const CHANNELS: Record<ChannelName, { maxMessages: number }> = {
  discord: { maxMessages: 10 },
  yay: { maxMessages: 1 },
}

export function isChannelName(value: unknown): value is ChannelName {
  return typeof value === 'string' && Object.hasOwn(CHANNELS, value)
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

/** 文を差し替えたあとの messages と archive。外れた古い文は archive（履歴）へ移す。 */
export function applySave(
  current: { messages: string[]; archive: string[] },
  input: unknown,
  maxMessages: number
): { messages: string[]; archive: string[] } {
  const messages = cleanMessages(input, maxMessages)
  const archive = [...current.archive]
  for (const old of current.messages) {
    if (!messages.includes(old) && !archive.includes(old)) archive.push(old)
  }
  return {
    messages,
    archive: archive.filter((a) => !messages.includes(a)).slice(-MAX_ARCHIVE),
  }
}

export interface PosterStatus {
  lastPost: { t: string; text: string } | null
  today: number
  /** サーバーが受け取った時刻。Mac の時計には頼らない。 */
  at: string
}

/** Mac の投稿役からの報告を検める。形が違えば DocError。 */
export function readPosterReport(body: unknown): Omit<PosterStatus, 'at'> {
  const { lastPost, today } = (body ?? {}) as { lastPost?: unknown; today?: unknown }
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
  return {
    lastPost: last ? { t: last.t as string, text: last.text as string } : null,
    today,
  }
}

/** 合鍵の保存形。合鍵そのものは置かず、この値だけを突き合わせる。 */
export function hashPosterKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

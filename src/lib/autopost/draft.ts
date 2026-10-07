import type { ChannelSnapshot, PosterStatus } from './api'

// 自動投稿の「書きかけ」の扱い。画面の部品から切り離してあるので、そのまま単体で確かめられる。

export const normalize = (list: string[]): string[] => list.map((s) => s.replace(/\r\n?/g, '\n').trim())

/** 空の入力欄だけが付いている状態は「編集中」とは数えない（まだ何も書いていない）。 */
export const contentOf = (list: string[]): string[] => normalize(list).filter(Boolean)

export function isDirty(draft: string[], saved: string[]): boolean {
  return JSON.stringify(contentOf(draft)) !== JSON.stringify(contentOf(saved))
}

/** 保存できる形か。空の欄・長すぎる文があれば保存できない。 */
export function isValid(draft: string[], maxLength: number): boolean {
  const list = normalize(draft)
  return list.length > 0 && list.every((t) => t.length > 0 && t.length <= maxLength)
}

/** 履歴の文を使うとき。1つしか回せない投稿先と、欄が1つだけのときは置き換え、そうでなければ足す。 */
export function withArchived(draft: string[], text: string, maxMessages: number): string[] {
  if (draft.length <= 1 || maxMessages <= 1) return [text]
  return draft.length >= maxMessages ? draft : [...draft, text]
}

/** 改行を「 / 」に直して1行で見せる。 */
export const flat = (text: string): string => text.replace(/\n/g, ' / ')

export function minutesAgo(iso: string, now: number): number {
  return Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000))
}

export function agoLabel(iso: string, now: number): string {
  const mins = minutesAgo(iso, now)
  return mins < 60 ? `${mins}分前` : `${Math.floor(mins / 60)}時間${mins % 60}分前`
}

/** Mac は数分おきに報告してくる。これより長く途絶えたら、止まっている可能性がある。 */
export const ALIVE_WITHIN_MINUTES = 20

export type Liveness = 'never' | 'alive' | 'silent'

export function livenessOf(status: PosterStatus | null, now: number): Liveness {
  if (!status) return 'never'
  return minutesAgo(status.at, now) < ALIVE_WITHIN_MINUTES ? 'alive' : 'silent'
}

/**
 * 保存した文が、まだ1度も投稿に使われていないか。
 * 最後に投稿された文が、いま保存してある文のどれでもなければ「次の投稿から」になる。
 * 投稿側は改行を「 / 」に直した形で報告してくることがあるので、どちらの形でも照らす。
 */
export function notYetPosted(snapshot: ChannelSnapshot): boolean {
  const last = snapshot.status?.lastPost
  if (!last || snapshot.messages.length === 0) return false
  return !snapshot.messages.some((m) => m === last.text || flat(m) === last.text)
}

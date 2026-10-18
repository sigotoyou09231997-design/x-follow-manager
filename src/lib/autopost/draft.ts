import type { ChannelSnapshot, PosterStatus } from './api'
import { normalizeHours, type Hours } from './hours'

// 自動投稿の「書きかけ」の扱い。画面の部品から切り離してあるので、そのまま単体で確かめられる。

/** 書きかけの1つぶん。文と、その文を投稿する時間帯（null は終日）。 */
export interface Slot {
  text: string
  hours: Hours
}

/** 保存済みの文と時間帯を、書きかけと同じ形にする。 */
export const slotsOf = (snapshot: Pick<ChannelSnapshot, 'messages' | 'hours'>): Slot[] =>
  snapshot.messages.map((text, i) => ({ text, hours: snapshot.hours[i] ?? null }))

export const normalize = (list: Slot[]): Slot[] =>
  list.map((s) => ({ text: s.text.replace(/\r\n?/g, '\n').trim(), hours: normalizeHours(s.hours) }))

/** 空の入力欄だけが付いている状態は「編集中」とは数えない（まだ何も書いていない）。 */
export const contentOf = (list: Slot[]): Slot[] => normalize(list).filter((s) => s.text)

export function isDirty(draft: Slot[], saved: Slot[]): boolean {
  return JSON.stringify(contentOf(draft)) !== JSON.stringify(contentOf(saved))
}

/** 保存できる形か。空の欄・長すぎる文・時間を1つも選んでいない時間帯があれば保存できない。 */
export function isValid(draft: Slot[], maxLength: number): boolean {
  const list = normalize(draft)
  return (
    list.length > 0 &&
    list.every((s) => s.text.length > 0 && s.text.length <= maxLength && (s.hours === null || s.hours.length > 0))
  )
}

/**
 * 履歴の文を使うとき。1つしか回せない投稿先と、欄が1つだけのときは置き換え、そうでなければ足す。
 * 欄が1つだけの置き換えは、その欄の時間帯を引き継ぐ（文を替えただけで、時間帯まで終日に戻さない）。足すときは終日で入る。
 */
export function withArchived(draft: Slot[], text: string, maxMessages: number): Slot[] {
  if (draft.length <= 1 || maxMessages <= 1) return [{ text, hours: draft.length === 1 ? draft[0].hours : null }]
  return draft.length >= maxMessages ? draft : [...draft, { text, hours: null }]
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
 * 止める／再開するの状態。画面で押したこと（snapshot.paused）と、投稿役が受け取ったこと（status.paused）を
 * 突き合わせる。押しただけでは、Mac が次に確かめに来るまで投稿が続くことがあるので、
 * 「停止中」と言い切れるのは投稿役が「止まっています」と報告してから。
 *   running  … 動いている
 *   pausing  … 止めると押した。Mac はまだ受け取っていない
 *   paused   … 止まっている（Mac も受け取った）
 *   resuming … 再開すると押した。Mac はまだ止まったまま
 * 止める機能より前の投稿役は paused を報告しない。そういう投稿役は止まらないので、
 * pausing のまま変わらない（＝止まったと誤解させない）。
 */
export type PauseState = 'running' | 'pausing' | 'paused' | 'resuming'

export function pauseStateOf(snapshot: ChannelSnapshot): PauseState {
  const acknowledged = snapshot.status?.paused === true
  // 文の時間帯の外で投稿を休んでいるあいだは、サーバーが投稿役に「止まっている」と答えるので、投稿役もそう報告する。
  // 押して止めたわけではないので、「再開待ち」とは見せない（時間帯の外は、ふだんどおり動いている状態）。
  if (!snapshot.paused && snapshot.schedule.idle) return 'running'
  if (snapshot.paused) return acknowledged ? 'paused' : 'pausing'
  return acknowledged ? 'resuming' : 'running'
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

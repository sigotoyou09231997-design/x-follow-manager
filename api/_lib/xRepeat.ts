import type { SupabaseClient } from '@supabase/supabase-js'
import { scheduleAt, type PosterProblem, type PosterStatus } from './autopostDoc.js'
import { supabaseAutopostStore, type ChannelRow } from './autopostStore.js'
import { getSupabaseAdmin } from './supabaseAdmin.js'
import { createPost, deletePost, XApiError } from './xClient.js'
import { getAccessToken } from './xToken.js'

// 決めた文を、X へくり返し投稿する（ディスコード・Yay の自動投稿の X 版）。
// Mac は使わず、publishDue の毎分の実行から呼ばれる。投稿の前に、前回このしくみが出した投稿を消す
// （ディスコード・Yay と同じく「いま出ているのは最新の1件だけ」にする。同じ文が並ぶと X に重複として断られやすい）。
//
// 状態（次に消す投稿の番号・次の文の順番・今日の件数・最後に試した時刻）は autopost_channels.status に置く。
// 画面の「最後の投稿・今日の件数・投稿できていない理由」も同じ status から出るので、ディスコード・Yay と同じ見え方になる。

/** 失敗したあと、次に試すまでの間（分）。間隔が長くても、直ったらすぐ戻るように短めにやり直す。 */
export const RETRY_AFTER_FAILURE_MINUTES = 15

export interface XRepeatDeps {
  list(): Promise<{ userId: string; row: ChannelRow }[]>
  /**
   * status を書く。expectTriedAt を渡したときは、保存されている triedAt がそれと同じときだけ書き、書けたかを返す
   * （毎分の実行が重なっても、同じ回を2回投稿しないための早い者勝ち）。
   */
  write(userId: string, status: PosterStatus, expectTriedAt?: string | null): Promise<boolean>
  token(userId: string): Promise<string>
  post(token: string, text: string): Promise<string>
  remove(token: string, id: string): Promise<void>
}

export type XRepeatOutcome = 'posted' | 'failed' | 'waiting' | 'idle' | 'paused' | 'skipped'

/** 日本時間の日付（YYYY-MM-DD）。今日の件数を数え直す境目。 */
export function dayInJapan(date: Date): string {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/** いま使える文のうち、start 番目以降で最初のもの（無ければ先頭に戻る）。順に回すため。 */
export function pickIndex(active: number[], start: number): number {
  const sorted = [...active].sort((a, b) => a - b)
  return sorted.find((i) => i >= start) ?? sorted[0]
}

/** 次に試してよい時刻を過ぎたか。失敗が続いているあいだは、間隔より短い RETRY_AFTER_FAILURE_MINUTES でやり直す。 */
export function isDue(status: PosterStatus | null, intervalMinutes: number, now: Date): boolean {
  if (!status?.triedAt) return true
  const wait = status.problem ? Math.min(intervalMinutes, RETRY_AFTER_FAILURE_MINUTES) : intervalMinutes
  return now.getTime() - Date.parse(status.triedAt) >= wait * 60_000
}

/** X の失敗を、画面で読んで次に何をすればよいか分かる言い方にする。 */
export function describeXFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const status = error instanceof XApiError ? error.status : 0
  if (/duplicate/i.test(message)) return '同じ文が続いたため、X に断られました（文を2つ以上にすると通りやすくなります）'
  if (status === 401) return 'X との連携が切れています。設定の「X と連携」からつなぎ直してください'
  if (status === 429) return 'X の回数制限にかかっています（時間をおいて、自動でやり直します）'
  if (status === 402 || /credit/i.test(message)) return 'X API の残高（クレジット）が足りません'
  if (/連携されていません/.test(message)) return 'X と連携していません。設定の「X と連携」からつないでください'
  return message.replace(/\s+/g, ' ').slice(0, 200)
}

/** 1人ぶん。投稿したか・なぜしなかったかを返す。投げない（1人の失敗で、ほかの人や予約の投稿を止めない）。 */
export async function runOne(deps: XRepeatDeps, userId: string, row: ChannelRow, now: Date): Promise<XRepeatOutcome> {
  const prev = row.status
  const day = dayInJapan(now)
  const base: PosterStatus = {
    lastPost: prev?.lastPost ?? null,
    today: prev?.day === day ? (prev?.today ?? 0) : 0,
    at: now.toISOString(),
    server: true,
    paused: row.paused,
    problem: prev?.problem ?? null,
    lastId: prev?.lastId ?? null,
    nextIndex: prev?.nextIndex ?? 0,
    day,
    ...(prev?.triedAt ? { triedAt: prev.triedAt } : {}),
  }
  // 画面の「止める／再開する」は、投稿役（ここではサーバー）が受け取ったと報告するまで「依頼中」と出る。
  // 状態が変わったときだけ書いて、受け取ったことを知らせる（毎分書くと、通信量がかさむ）
  const ackNeeded = (prev?.paused === true) !== row.paused || prev?.server !== true

  if (row.paused) {
    if (ackNeeded) await deps.write(userId, base)
    return 'paused'
  }
  const schedule = scheduleAt('xrepeat', row.hours, now)
  if (row.messages.length === 0 || schedule.activeIndexes.length === 0) {
    if (ackNeeded) await deps.write(userId, base)
    return 'idle'
  }
  if (!isDue(prev, row.settings.intervalMinutes, now)) {
    if (ackNeeded) await deps.write(userId, base)
    return 'waiting'
  }

  // この回は自分が出す、という印を先に置く。別の実行が先に置いていたら何もしない
  const claimed = await deps.write(userId, { ...base, triedAt: now.toISOString() }, prev?.triedAt ?? null)
  if (!claimed) return 'skipped'

  const index = pickIndex(schedule.activeIndexes, base.nextIndex ?? 0)
  const text = row.messages[index]
  const next: PosterStatus = { ...base, triedAt: now.toISOString() }
  try {
    const token = await deps.token(userId)
    // 前の投稿を先に消す。消せないまま同じ文を出すと、X に重複で断られ、出せても同じ文が2つ並ぶ
    if (next.lastId) {
      await deps.remove(token, next.lastId)
      next.lastId = null
    }
    const id = await deps.post(token, text)
    next.lastId = id
    next.lastPost = { t: now.toISOString(), text }
    next.today = (next.today ?? 0) + 1
    next.nextIndex = index + 1
    next.problem = null
  } catch (error) {
    const problem: PosterProblem = {
      message: describeXFailure(error),
      since: prev?.problem?.since ?? now.toISOString(),
      count: (prev?.problem?.count ?? 0) + 1,
      stopped: false,
    }
    next.problem = problem
  }
  await deps.write(userId, next)
  return next.problem ? 'failed' : 'posted'
}

export async function runXRepeats(deps: XRepeatDeps, now: Date): Promise<{ posted: number; failed: number }> {
  const result = { posted: 0, failed: 0 }
  for (const { userId, row } of await deps.list()) {
    try {
      const outcome = await runOne(deps, userId, row, now)
      if (outcome === 'posted') result.posted += 1
      if (outcome === 'failed') result.failed += 1
    } catch (error) {
      // 状態を書けなかった等。次の分にやり直す
      console.error('xRepeat failed:', userId, error)
      result.failed += 1
    }
  }
  return result
}

export function supabaseXRepeatDeps(client: SupabaseClient = getSupabaseAdmin()): XRepeatDeps {
  const store = supabaseAutopostStore(client)
  const tokens = new Map<string, string>()
  return {
    list: () => store.listChannel('xrepeat'),
    async write(userId, status, expectTriedAt) {
      if (expectTriedAt === undefined) {
        await store.writeStatus(userId, 'xrepeat', status)
        return true
      }
      let query = client.from('autopost_channels').update({ status }).eq('user_id', userId).eq('channel', 'xrepeat')
      query = expectTriedAt === null ? query.is('status->>triedAt', null) : query.eq('status->>triedAt', expectTriedAt)
      const { data, error } = await query.select('channel')
      if (error) throw new Error(`状態を保存できませんでした: ${error.message}`)
      return (data ?? []).length > 0
    },
    token: (userId) => getAccessToken(userId, tokens),
    post: (token, text) => createPost(token, { text }),
    remove: (token, id) => deletePost(token, id),
  }
}

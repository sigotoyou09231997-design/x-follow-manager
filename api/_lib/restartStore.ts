import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from './supabaseAdmin.js'

// スマホの画面の「投稿役を再起動する」を、Mac に伝えるための預かり場所。
//   画面（本人確認あり）が依頼を置く → Mac の見張り（合鍵あり。poster/remote/）が1分ごとに見に来て、
//   あれば投稿役を入れ替え、結果を書き戻す。依頼は1人に1件だけ（新しい依頼が古い依頼を置き換える）。
// 表は autopost_restart（supabase/sql/008_autopost_restart.sql）。

export interface RestartState {
  /** 表（SQL 008）があるか。無ければ画面は、ボタンの代わりに SQL を案内する。 */
  ready: boolean
  requestedAt: string | null
  handledAt: string | null
  /** Mac が書き戻した結果（例: 「Yay: 再起動しました / ディスコード: 動いているのでそのまま」）。 */
  result: string | null
}

export const NOT_READY: RestartState = { ready: false, requestedAt: null, handledAt: null, result: null }

/** 依頼してから、Mac が受け取るまでの有効期間。これを過ぎた依頼は、Mac が戻ってきても実行しない。 */
export const REQUEST_VALID_SECONDS = 30 * 60

/** この間に出し直された依頼は、新しい依頼として数えない（連打で何度も入れ替わらないように）。 */
export const REQUEST_COOLDOWN_SECONDS = 60

export class RestartNotReadyError extends Error {
  constructor() {
    super('再起動の依頼の表（autopost_restart）がまだありません')
  }
}

export interface PendingRestart {
  requestedAt: string
  /** 依頼からの経過秒（サーバーの時計で数える。Mac の時計には頼らない）。 */
  ageSeconds: number
}

export interface RestartStore {
  get(userId: string): Promise<RestartState>
  /** 依頼を置く。直前（REQUEST_COOLDOWN_SECONDS 以内）に未処理の依頼があれば、それをそのまま返す。 */
  request(userId: string, now: Date): Promise<RestartState>
  /** 未処理の依頼（有効期間の中のものだけ）。無ければ null。 */
  pending(userId: string, now: Date): Promise<PendingRestart | null>
  /** 依頼を処理したと書き戻す。依頼の時刻が合うときだけ（その間に新しい依頼が入っていたら書かない）。 */
  ack(userId: string, requestedAt: string, result: string, now: Date): Promise<boolean>
}

interface DbRow {
  requested_at: string | null
  handled_at: string | null
  result: string | null
}

const TABLE = 'autopost_restart'
const MISSING_TABLE_CODES = ['PGRST205', '42P01']

function isMissingTable(error: { code?: string; message?: string }): boolean {
  if (error.code && MISSING_TABLE_CODES.includes(error.code)) return true
  return !!error.message?.includes(TABLE) && /not find|does not exist/i.test(error.message)
}

const toState = (row: DbRow | null): RestartState => ({
  ready: true,
  requestedAt: row?.requested_at ?? null,
  handledAt: row?.handled_at ?? null,
  result: row?.result ?? null,
})

export function isPending(state: RestartState): boolean {
  return state.ready && !!state.requestedAt && !state.handledAt
}

const secondsSince = (iso: string, now: Date): number => Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 1000))

export function supabaseRestartStore(client: SupabaseClient = getSupabaseAdmin()): RestartStore {
  async function read(userId: string): Promise<DbRow | null> {
    const { data, error } = await client
      .from(TABLE)
      .select('requested_at, handled_at, result')
      .eq('user_id', userId)
      .maybeSingle<DbRow>()
    if (error) {
      if (isMissingTable(error)) throw new RestartNotReadyError()
      throw new Error(`${TABLE} の読み込みに失敗しました: ${error.message}`)
    }
    return data
  }

  const store: RestartStore = {
    async get(userId) {
      try {
        return toState(await read(userId))
      } catch (error) {
        if (error instanceof RestartNotReadyError) return NOT_READY
        throw error
      }
    },

    async request(userId, now) {
      const current = toState(await read(userId))
      if (isPending(current) && secondsSince(current.requestedAt!, now) < REQUEST_COOLDOWN_SECONDS) return current
      const { error } = await client
        .from(TABLE)
        .upsert(
          { user_id: userId, requested_at: now.toISOString(), handled_at: null, result: null },
          { onConflict: 'user_id' }
        )
      if (error) {
        if (isMissingTable(error)) throw new RestartNotReadyError()
        throw new Error(`再起動の依頼を保存できませんでした: ${error.message}`)
      }
      return store.get(userId)
    },

    async pending(userId, now) {
      let state: RestartState
      try {
        state = toState(await read(userId))
      } catch (error) {
        if (error instanceof RestartNotReadyError) return null
        throw error
      }
      if (!isPending(state)) return null
      const age = secondsSince(state.requestedAt!, now)
      return age <= REQUEST_VALID_SECONDS ? { requestedAt: state.requestedAt!, ageSeconds: age } : null
    },

    async ack(userId, requestedAt, result, now) {
      const { data, error } = await client
        .from(TABLE)
        .update({ handled_at: now.toISOString(), result })
        .eq('user_id', userId)
        .eq('requested_at', requestedAt)
        .is('handled_at', null)
        .select('user_id')
      if (error) {
        if (isMissingTable(error)) return false
        throw new Error(`再起動の結果を保存できませんでした: ${error.message}`)
      }
      return (data?.length ?? 0) > 0
    },
  }
  return store
}

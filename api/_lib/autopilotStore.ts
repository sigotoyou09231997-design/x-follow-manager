import type { SupabaseClient } from '@supabase/supabase-js'
import {
  AUTOPILOT_PREFIX,
  DEFAULT_SETTINGS,
  emptyUsage,
  type AutopilotSettings,
  type AutopilotUsage,
  type HistoryPost,
  type StyleProfile,
} from '../../src/lib/xAutopilot/types.js'
import { normalizeSettings } from '../../src/lib/xAutopilot/slots.js'
import { getSupabaseAdmin } from './supabaseAdmin.js'

// X の自動運転の保存先。設定・読み込んだ履歴・文体のまとめ・使用状況は x_autopilot（SQL 007）、
// 作った投稿は、ふつうの予約と同じ scheduled_posts に入れる（予約一覧・投稿・編集・削除をそのまま使うため）。

export interface AutopilotRow {
  userId: string
  enabled: boolean
  settings: AutopilotSettings
  /** 読み込んだ自分の投稿（新しい順）。 */
  history: HistoryPost[]
  historyFetchedAt: string | null
  profile: StyleProfile | null
  profileBuiltAt: string | null
  /** 作成済みの枠の印。消された投稿の枠を作り直さないために、枠そのものを覚えておく。 */
  slots: string[]
  usage: AutopilotUsage
  lastError: string | null
}

export type AutopilotPatch = Partial<Omit<AutopilotRow, 'userId'>>

/** 自動運転の表（SQL 007）がまだ無い。予約や他の機能には影響しない。 */
export class AutopilotNotReadyError extends Error {
  constructor() {
    super('自動運転の表（x_autopilot）がまだありません')
  }
}

export interface AutopilotStore {
  /** まだ何も保存していない人は、既定の設定の空の状態で返す。表が無ければ AutopilotNotReadyError。 */
  get(userId: string): Promise<AutopilotRow>
  /** 渡した項目だけ書き換える（行が無ければ作る）。 */
  save(userId: string, patch: AutopilotPatch): Promise<void>
  /** 自動運転が ON の人。毎分の補充の対象。 */
  listEnabled(limit: number): Promise<AutopilotRow[]>
  /** 連携中の X アカウント（トークンは返さない）。 */
  xAccount(userId: string): Promise<{ xUserId: string; username: string } | null>
  /** 予約に1本入れる。同じ枠がすでにあれば 'duplicate'（同時に走った別の実行が先に入れた）。 */
  insertPost(input: { userId: string; at: string; text: string; slotKey: string }): Promise<'inserted' | 'duplicate'>
  /** 自動運転で作った（予約中・投稿済み）本文を、投稿時刻の新しい順に。内容の重なりを避けるため。 */
  recentTexts(userId: string, limit: number): Promise<{ text: string; at: string }[]>
  /** まだ出ていない自動運転の予約を取り消す。取り消した件数を返す。 */
  cancelUpcoming(userId: string): Promise<number>
  /**
   * いま予約として生きている（予約中・投稿処理中・投稿済み）自動運転の枠の印。昨日以降ぶん。
   * 設定の作り直しで「作った枠の記録」だけが空になっても、今日すでに投稿した枠を、AIに書かせてから
   * 重複と分かって費用だけがかかる、ということが起きないように。
   */
  activeSlotKeys(userId: string, sinceDate: string): Promise<string[]>
}

interface DbRow {
  user_id: string
  enabled: boolean
  settings: Partial<AutopilotSettings> | null
  history: HistoryPost[] | null
  history_fetched_at: string | null
  profile: StyleProfile | null
  profile_built_at: string | null
  slots: string[] | null
  usage: Partial<AutopilotUsage> | null
  last_error: string | null
}

const TABLE = 'x_autopilot'
const COLUMNS =
  'user_id, enabled, settings, history, history_fetched_at, profile, profile_built_at, slots, usage, last_error'
/** 表が見つからないときのコード。PostgREST は PGRST205、直接の問い合わせは Postgres の 42P01。 */
const MISSING_TABLE_CODES = ['PGRST205', '42P01']
const UNIQUE_VIOLATION = '23505'

function isMissingTable(error: { code?: string; message?: string }): boolean {
  if (error.code && MISSING_TABLE_CODES.includes(error.code)) return true
  return !!error.message?.includes(TABLE) && /not find|does not exist/i.test(error.message)
}

export function emptyRow(userId: string): AutopilotRow {
  return {
    userId,
    enabled: false,
    settings: { ...DEFAULT_SETTINGS },
    history: [],
    historyFetchedAt: null,
    profile: null,
    profileBuiltAt: null,
    slots: [],
    usage: emptyUsage(''),
    lastError: null,
  }
}

function toRow(row: DbRow): AutopilotRow {
  return {
    userId: row.user_id,
    enabled: row.enabled,
    settings: normalizeSettings(row.settings),
    history: row.history ?? [],
    historyFetchedAt: row.history_fetched_at,
    profile: row.profile,
    profileBuiltAt: row.profile_built_at,
    slots: row.slots ?? [],
    usage: { ...emptyUsage(''), ...(row.usage ?? {}) },
    lastError: row.last_error,
  }
}

/** AutopilotPatch を列名に直す。渡された項目だけを含める（他の列を上書きしない）。 */
function toColumns(patch: AutopilotPatch): Record<string, unknown> {
  const columns: Record<string, unknown> = {}
  if (patch.enabled !== undefined) columns.enabled = patch.enabled
  if (patch.settings !== undefined) columns.settings = patch.settings
  if (patch.history !== undefined) columns.history = patch.history
  if (patch.historyFetchedAt !== undefined) columns.history_fetched_at = patch.historyFetchedAt
  if (patch.profile !== undefined) columns.profile = patch.profile
  if (patch.profileBuiltAt !== undefined) columns.profile_built_at = patch.profileBuiltAt
  if (patch.slots !== undefined) columns.slots = patch.slots
  if (patch.usage !== undefined) columns.usage = patch.usage
  if (patch.lastError !== undefined) columns.last_error = patch.lastError
  return columns
}

export function supabaseAutopilotStore(client: SupabaseClient = getSupabaseAdmin()): AutopilotStore {
  return {
    async get(userId) {
      const { data, error } = await client.from(TABLE).select(COLUMNS).eq('user_id', userId).maybeSingle<DbRow>()
      if (error) {
        if (isMissingTable(error)) throw new AutopilotNotReadyError()
        throw new Error(`${TABLE} の読み込みに失敗しました: ${error.message}`)
      }
      return data ? toRow(data) : emptyRow(userId)
    },

    async save(userId, patch) {
      const { error } = await client
        .from(TABLE)
        .upsert({ user_id: userId, ...toColumns(patch), updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
      if (error) {
        if (isMissingTable(error)) throw new AutopilotNotReadyError()
        throw new Error(`自動運転の設定を保存できませんでした: ${error.message}`)
      }
    },

    async listEnabled(limit) {
      const { data, error } = await client.from(TABLE).select(COLUMNS).eq('enabled', true).limit(limit).returns<DbRow[]>()
      if (error) {
        // 表がまだ無いあいだは、毎分の実行（予約の投稿そのもの）を巻き込まない。何も補充しないだけ。
        if (isMissingTable(error)) return []
        throw new Error(`${TABLE} の読み込みに失敗しました: ${error.message}`)
      }
      return (data ?? []).map(toRow)
    },

    async xAccount(userId) {
      const { data, error } = await client
        .from('x_accounts')
        .select('x_user_id, username')
        .eq('user_id', userId)
        .maybeSingle<{ x_user_id: string; username: string }>()
      if (error) throw new Error(`X連携情報の取得に失敗しました: ${error.message}`)
      return data ? { xUserId: data.x_user_id, username: data.username } : null
    },

    async insertPost({ userId, at, text, slotKey }) {
      const { error } = await client.from('scheduled_posts').insert({
        id: crypto.randomUUID(),
        user_id: userId,
        status: 'scheduled',
        scheduled_at: at,
        segments: [{ text, media: [] }],
        ai_prompt: `${AUTOPILOT_PREFIX}${slotKey}`,
        updated_at: new Date().toISOString(),
      })
      if (error) {
        if (error.code === UNIQUE_VIOLATION) return 'duplicate'
        throw new Error(`予約への追加に失敗しました: ${error.message}`)
      }
      return 'inserted'
    },

    async recentTexts(userId, limit) {
      const { data, error } = await client
        .from('scheduled_posts')
        .select('segments, scheduled_at')
        .eq('user_id', userId)
        .like('ai_prompt', `${AUTOPILOT_PREFIX}%`)
        .in('status', ['scheduled', 'publishing', 'posted'])
        .order('scheduled_at', { ascending: false })
        .limit(limit)
        .returns<{ segments: { text: string }[]; scheduled_at: string }[]>()
      if (error) {
        // 過去分が読めなくても投稿は作れる。内容が似る可能性が上がるだけなので止めない。
        console.error('autopilot recentTexts failed:', error.message)
        return []
      }
      return (data ?? [])
        .map((r) => ({ text: (r.segments ?? []).map((s) => s.text).join('\n'), at: r.scheduled_at }))
        .filter((r) => r.text.trim())
    },

    async cancelUpcoming(userId) {
      const { data, error } = await client
        .from('scheduled_posts')
        .update({ status: 'canceled', updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .like('ai_prompt', `${AUTOPILOT_PREFIX}%`)
        .eq('status', 'scheduled')
        .select('id')
        .returns<{ id: string }[]>()
      if (error) throw new Error(`予約の取り消しに失敗しました: ${error.message}`)
      return data?.length ?? 0
    },

    async activeSlotKeys(userId, sinceDate) {
      // 枠の印は 'autopilot:YYYY-MM-DD#番号'。日付で始まるので、文字列の大小で昨日以降に絞れる。
      const { data, error } = await client
        .from('scheduled_posts')
        .select('ai_prompt')
        .eq('user_id', userId)
        .like('ai_prompt', `${AUTOPILOT_PREFIX}%`)
        .in('status', ['scheduled', 'publishing', 'posted'])
        .gte('ai_prompt', `${AUTOPILOT_PREFIX}${sinceDate}`)
        .returns<{ ai_prompt: string }[]>()
      if (error) {
        // 読めなくても止めない。最悪、重複を後で弾く（今までの動き）だけ。
        console.error('autopilot activeSlotKeys failed:', error.message)
        return []
      }
      return (data ?? []).map((r) => r.ai_prompt.slice(AUTOPILOT_PREFIX.length))
    },
  }
}

import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from './supabaseAdmin.js'
import type { ChannelName, PosterStatus } from './autopostDoc.js'

/** 投稿先1つぶん。まだ何も保存していない投稿先は version 0・文なしで返す。 */
export interface ChannelRow {
  channel: ChannelName
  messages: string[]
  archive: string[]
  version: number
  savedAt: string | null
  status: PosterStatus | null
}

export function emptyChannel(channel: ChannelName): ChannelRow {
  return { channel, messages: [], archive: [], version: 0, savedAt: null, status: null }
}

/**
 * 保存先。ハンドラはこの形だけを知っていて、本番は Supabase、テストでは手元のメモリに差し替える。
 */
export interface AutopostStore {
  getChannel(userId: string, channel: ChannelName): Promise<ChannelRow>
  /**
   * 文を保存する。baseVersion は「この画面が見ていた版」。別の端末で先に保存されて
   * 版が進んでいたら、上書きせず null を返す。
   */
  saveText(
    userId: string,
    channel: ChannelName,
    next: { messages: string[]; archive: string[] },
    baseVersion: number
  ): Promise<ChannelRow | null>
  writeStatus(userId: string, channel: ChannelName, status: PosterStatus): Promise<void>
  /** 合鍵（の sha256）から持ち主を引く。無ければ null。 */
  userIdForPosterKey(tokenHash: string): Promise<string | null>
}

interface DbRow {
  channel: ChannelName
  messages: string[] | null
  archive: string[] | null
  version: number
  saved_at: string | null
  status: PosterStatus | null
}

function toChannelRow(row: DbRow): ChannelRow {
  return {
    channel: row.channel,
    messages: row.messages ?? [],
    archive: row.archive ?? [],
    version: row.version,
    savedAt: row.saved_at,
    status: row.status,
  }
}

const COLUMNS = 'channel, messages, archive, version, saved_at, status'
/** Postgres の unique_violation。別の端末が先に最初の保存をした。 */
const UNIQUE_VIOLATION = '23505'

export function supabaseAutopostStore(client: SupabaseClient = getSupabaseAdmin()): AutopostStore {
  return {
    async getChannel(userId, channel) {
      const { data, error } = await client
        .from('autopost_channels')
        .select(COLUMNS)
        .eq('user_id', userId)
        .eq('channel', channel)
        .maybeSingle<DbRow>()
      if (error) throw new Error(`autopost_channels の読み込みに失敗しました: ${error.message}`)
      return data ? toChannelRow(data) : emptyChannel(channel)
    },

    async saveText(userId, channel, next, baseVersion) {
      const patch = {
        messages: next.messages,
        archive: next.archive,
        version: baseVersion + 1,
        saved_at: new Date().toISOString(),
      }

      // 版が見ていたものと同じときだけ書き換える（読んで→書くの間に別の保存が入れば0行になる）。
      // version 0 は「行がまだ無い」か「Mac の報告だけで行ができている」のどちらか。
      const { data: updated, error: updateError } = await client
        .from('autopost_channels')
        .update(patch)
        .eq('user_id', userId)
        .eq('channel', channel)
        .eq('version', baseVersion)
        .select(COLUMNS)
        .returns<DbRow[]>()
      if (updateError) throw new Error(`文の保存に失敗しました: ${updateError.message}`)
      if (updated && updated.length > 0) return toChannelRow(updated[0])

      if (baseVersion !== 0) return null

      const { data: inserted, error: insertError } = await client
        .from('autopost_channels')
        .insert({ user_id: userId, channel, ...patch })
        .select(COLUMNS)
        .single<DbRow>()
      if (insertError) {
        if (insertError.code === UNIQUE_VIOLATION) return null
        throw new Error(`文の保存に失敗しました: ${insertError.message}`)
      }
      return toChannelRow(inserted)
    },

    async writeStatus(userId, channel, status) {
      // 列を絞って upsert する。行が既にあれば status だけが書き換わり、文には触らない。
      const { error } = await client
        .from('autopost_channels')
        .upsert({ user_id: userId, channel, status }, { onConflict: 'user_id,channel' })
      if (error) throw new Error(`状態の報告を保存できませんでした: ${error.message}`)
    },

    async userIdForPosterKey(tokenHash) {
      const { data, error } = await client
        .from('autopost_poster_keys')
        .select('user_id')
        .eq('token_hash', tokenHash)
        .maybeSingle<{ user_id: string }>()
      if (error) throw new Error(`合鍵の確認に失敗しました: ${error.message}`)
      return data?.user_id ?? null
    },
  }
}

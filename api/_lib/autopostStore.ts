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
  /** 画面で「止める」にしているか。止める機能の表（SQL 006）が無いあいだは常に false。 */
  paused: boolean
  /** 止めた時刻。止めていなければ null。 */
  pausedAt: string | null
  /** 止める機能の表があるか。無ければ画面は、止めるボタンの代わりに SQL 006 を案内する。 */
  pauseReady: boolean
}

export function emptyChannel(channel: ChannelName): ChannelRow {
  return {
    channel,
    messages: [],
    archive: [],
    version: 0,
    savedAt: null,
    status: null,
    paused: false,
    pausedAt: null,
    pauseReady: true,
  }
}

/** 止める機能の表（SQL 006）がまだ無い。文の保存や投稿には影響しない。 */
export class PauseNotReadyError extends Error {
  constructor() {
    super('止める機能の表（autopost_pause）がまだありません')
  }
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
  /**
   * 止める／再開する。文の版（version）は動かさない（止めても、書きかけの文の取り合いには関係しないため）。
   * 表が無ければ PauseNotReadyError。
   */
  setPaused(userId: string, channel: ChannelName, paused: boolean): Promise<ChannelRow>
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

type PauseLookup = { ready: true; paused: boolean; pausedAt: string | null } | { ready: false }

/** 文の行（まだ保存していない投稿先は null）と、止めているかの読み取りを、画面に返す1つの形にする。 */
function toChannelRow(channel: ChannelName, row: DbRow | null, pause: PauseLookup): ChannelRow {
  const base: ChannelRow = row
    ? {
        ...emptyChannel(channel),
        messages: row.messages ?? [],
        archive: row.archive ?? [],
        version: row.version,
        savedAt: row.saved_at,
        status: row.status,
      }
    : emptyChannel(channel)
  return {
    ...base,
    paused: pause.ready && pause.paused,
    pausedAt: pause.ready ? pause.pausedAt : null,
    pauseReady: pause.ready,
  }
}

const COLUMNS = 'channel, messages, archive, version, saved_at, status'
/** Postgres の unique_violation。別の端末が先に最初の保存をした。 */
const UNIQUE_VIOLATION = '23505'

const PAUSE_TABLE = 'autopost_pause'
/** 表が見つからないときのコード。PostgREST は PGRST205、古い版や直接の問い合わせは Postgres の 42P01。 */
const MISSING_TABLE_CODES = ['PGRST205', '42P01']

interface PauseRow {
  paused: boolean
  paused_at: string | null
}

/** 「表が無い」だけを見分ける。通信の失敗などは別物として投げ、止まっていないことにしてしまわない。 */
function isMissingPauseTable(error: { code?: string; message?: string }): boolean {
  if (error.code && MISSING_TABLE_CODES.includes(error.code)) return true
  return !!error.message?.includes(PAUSE_TABLE) && /not find|does not exist/i.test(error.message)
}

export function supabaseAutopostStore(client: SupabaseClient = getSupabaseAdmin()): AutopostStore {
  /**
   * 止めているかを別の表から読む。文の表とは別にしてあるので、表（SQL 006）が無くても文の読み書きは通る。
   * 表が無いときだけ ready: false。それ以外の失敗は投げる（読めなかったのに「止めていない」と答えると、
   * 止めたはずの投稿役がまた投稿してしまうため）。
   */
  async function readPause(userId: string, channel: ChannelName): Promise<PauseLookup> {
    const { data, error } = await client
      .from(PAUSE_TABLE)
      .select('paused, paused_at')
      .eq('user_id', userId)
      .eq('channel', channel)
      .maybeSingle<PauseRow>()
    if (error) {
      if (isMissingPauseTable(error)) return { ready: false }
      throw new Error(`${PAUSE_TABLE} の読み込みに失敗しました: ${error.message}`)
    }
    return { ready: true, paused: data?.paused ?? false, pausedAt: data?.paused_at ?? null }
  }

  const store: AutopostStore = {
    async getChannel(userId, channel) {
      const [{ data, error }, pause] = await Promise.all([
        client
          .from('autopost_channels')
          .select(COLUMNS)
          .eq('user_id', userId)
          .eq('channel', channel)
          .maybeSingle<DbRow>(),
        readPause(userId, channel),
      ])
      if (error) throw new Error(`autopost_channels の読み込みに失敗しました: ${error.message}`)
      return toChannelRow(channel, data, pause)
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
      if (updated && updated.length > 0) return toChannelRow(channel, updated[0], await readPause(userId, channel))

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
      return toChannelRow(channel, inserted, await readPause(userId, channel))
    },

    async writeStatus(userId, channel, status) {
      // 列を絞って upsert する。行が既にあれば status だけが書き換わり、文には触らない。
      const { error } = await client
        .from('autopost_channels')
        .upsert({ user_id: userId, channel, status }, { onConflict: 'user_id,channel' })
      if (error) throw new Error(`状態の報告を保存できませんでした: ${error.message}`)
    },

    async setPaused(userId, channel, paused) {
      const before = await readPause(userId, channel)
      if (!before.ready) throw new PauseNotReadyError()
      // すでにその状態なら書き換えない（止めた時刻を、押し直しのたびに更新しないため）。
      if (before.paused !== paused) {
        const { error } = await client
          .from(PAUSE_TABLE)
          .upsert(
            { user_id: userId, channel, paused, paused_at: paused ? new Date().toISOString() : null },
            { onConflict: 'user_id,channel' }
          )
        if (error) {
          if (isMissingPauseTable(error)) throw new PauseNotReadyError()
          throw new Error(`停止の切り替えを保存できませんでした: ${error.message}`)
        }
      }
      return store.getChannel(userId, channel)
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
  return store
}

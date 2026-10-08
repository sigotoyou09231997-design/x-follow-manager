import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireUserId, UnauthorizedError } from './auth.js'
import {
  CHANNELS,
  DocError,
  MAX_LENGTH,
  applySave,
  hashPosterKey,
  isChannelName,
  readPosterReport,
  type ChannelName,
} from './autopostDoc.js'
import { PauseNotReadyError, supabaseAutopostStore, type AutopostStore, type ChannelRow } from './autopostStore.js'

// 掲示板・Yay の自動投稿の受け口。
//   画面（X のアプリ。Supabase のログインが要る）…… api/autopost.ts
//     GET  = 全投稿先の文・履歴・状態   POST = 文の保存、または止める／再開する（{ channel, paused }）
//   投稿側（Mac。合鍵が要る）…………………………… api/poster-text.ts / api/poster-status.ts
//     GET  = 投稿する文と、止められているかを読む
//     POST = 「動いている・最後の投稿・いま止まっているか」を報告する
//
// 投稿側の2つは、以前の編集画面（ch-post-editor）と同じ URL・同じ返し方にしてある。
// そのため Mac 側は config.json の cloud.url を差し替えるだけでつなぎ替えられる。

export interface Deps {
  store: AutopostStore
  /** Authorization ヘッダーからユーザーIDを引く。通らなければ UnauthorizedError。 */
  authenticate: (authorization: string | undefined) => Promise<string>
}

function defaultDeps(): Deps {
  return { store: supabaseAutopostStore(), authenticate: requireUserId }
}

function readBody(req: VercelRequest): Record<string, unknown> | null {
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function snapshot(row: ChannelRow) {
  return {
    channel: row.channel,
    messages: row.messages,
    archive: [...row.archive].reverse(), // 新しいものが先
    version: row.version,
    savedAt: row.savedAt,
    status: row.status,
    paused: row.paused,
    pausedAt: row.pausedAt,
    pauseReady: row.pauseReady,
    limits: { maxLength: MAX_LENGTH, maxMessages: CHANNELS[row.channel].maxMessages },
  }
}

const PAUSE_SETUP_MESSAGE =
  '止める機能の準備がまだです。Supabase の SQL Editor で supabase/sql/006_autopost_pause.sql を実行すると使えるようになります'

function channelOf(req: VercelRequest, body: Record<string, unknown> | null): ChannelName | null {
  const q = req.query?.ch
  const fromQuery = Array.isArray(q) ? q[0] : q
  // 指定が無ければ discord。以前の投稿側（ディスコード用）はこの形で呼んでくる。
  const name = fromQuery ?? body?.channel ?? 'discord'
  return isChannelName(name) ? name : null
}

function failure(res: VercelResponse, error: unknown) {
  if (error instanceof UnauthorizedError) return res.status(401).json({ error: error.message })
  console.error(error)
  return res.status(500).json({ error: 'サーバーでエラーが起きました' })
}

export function createAutopostHandler(deps?: Deps) {
  return async function autopost(req: VercelRequest, res: VercelResponse) {
    res.setHeader('cache-control', 'no-store')
    if (req.method !== 'GET' && req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' })
    }
    const { store, authenticate } = deps ?? defaultDeps()

    let userId: string
    try {
      userId = await authenticate(req.headers.authorization)
    } catch (error) {
      return failure(res, error)
    }

    try {
      if (req.method === 'GET') {
        const names = Object.keys(CHANNELS) as ChannelName[]
        const rows = await Promise.all(names.map((name) => store.getChannel(userId, name)))
        return res.status(200).json({ channels: Object.fromEntries(rows.map((r) => [r.channel, snapshot(r)])) })
      }

      const body = readBody(req)
      if (!body) return res.status(400).json({ error: 'リクエストの形式が不正です' })
      const channel = channelOf(req, body)
      if (!channel) return res.status(400).json({ error: '投稿先が正しくありません' })

      if (body.paused !== undefined) {
        // 止める／再開するは、文の保存とは別の操作。1回の送信に文を混ぜない
        // （どちらをしたかったのか分からなくなり、止めたつもりで文だけ変わる、が起きうる）。
        if (typeof body.paused !== 'boolean' || body.messages !== undefined) {
          return res.status(400).json({ error: 'リクエストの形式が不正です' })
        }
        try {
          return res.status(200).json({ snapshot: snapshot(await store.setPaused(userId, channel, body.paused)) })
        } catch (error) {
          if (error instanceof PauseNotReadyError) return res.status(503).json({ error: PAUSE_SETUP_MESSAGE })
          throw error
        }
      }

      const baseVersion = body.baseVersion
      if (typeof baseVersion !== 'number' || !Number.isInteger(baseVersion) || baseVersion < 0) {
        return res.status(400).json({ error: '画面が見ていた版が分かりません。読み直してください' })
      }

      const current = await store.getChannel(userId, channel)
      let next: { messages: string[]; archive: string[] }
      try {
        next = applySave(current, body.messages, CHANNELS[channel].maxMessages)
      } catch (error) {
        if (error instanceof DocError) return res.status(400).json({ error: error.message })
        throw error
      }

      const saved = await store.saveText(userId, channel, next, baseVersion)
      if (!saved) {
        // 別の端末で先に保存されていた。書いた内容は画面に残したまま、最新だけ渡す。
        const latest = await store.getChannel(userId, channel)
        return res.status(409).json({
          error: '別の端末で先に更新されています。内容を確かめてから、もう一度保存してください',
          snapshot: snapshot(latest),
        })
      }
      return res.status(200).json({ snapshot: snapshot(saved) })
    } catch (error) {
      return failure(res, error)
    }
  }
}

/** 合鍵から持ち主を引く。合鍵が無い・合わないときは null。 */
async function posterUserId(store: AutopostStore, authorization: string | undefined): Promise<string | null> {
  const key = authorization?.replace(/^Bearer\s+/i, '').trim()
  if (!key) return null
  return store.userIdForPosterKey(hashPosterKey(key))
}

export function createPosterTextHandler(deps?: Pick<Deps, 'store'>) {
  return async function posterText(req: VercelRequest, res: VercelResponse) {
    res.setHeader('cache-control', 'no-store')
    if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' })
    try {
      const store = (deps ?? defaultDeps()).store
      const userId = await posterUserId(store, req.headers.authorization)
      if (!userId) return res.status(401).json({ error: 'unauthorized' })
      const channel = channelOf(req, null)
      if (!channel) return res.status(400).json({ error: '投稿先が正しくありません' })

      const row = await store.getChannel(userId, channel)
      // 止めているあいだは、文が無くても答える（投稿役が知りたいのは「止められているか」のほう）。
      if (row.messages.length === 0 && !row.paused) return res.status(404).json({ error: '文がまだ保存されていません' })
      // paused は、止める機能より前の投稿役は読まない。そういう投稿役は止まらないので、
      // 画面は投稿役の報告（status.paused）が返るまで「停止中」と言い切らない。
      return res.status(200).json({
        messages: row.messages,
        updatedAt: row.savedAt,
        paused: row.paused,
        pausedAt: row.pausedAt,
      })
    } catch (error) {
      return failure(res, error)
    }
  }
}

export function createPosterStatusHandler(deps?: Pick<Deps, 'store'>, now: () => Date = () => new Date()) {
  return async function posterStatus(req: VercelRequest, res: VercelResponse) {
    res.setHeader('cache-control', 'no-store')
    if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
    try {
      const store = (deps ?? defaultDeps()).store
      const userId = await posterUserId(store, req.headers.authorization)
      if (!userId) return res.status(401).json({ error: 'unauthorized' })
      const body = readBody(req)
      const channel = channelOf(req, body)
      if (!body || !channel) return res.status(400).json({ error: '形が違います' })

      let report: ReturnType<typeof readPosterReport>
      try {
        report = readPosterReport(body)
      } catch (error) {
        if (error instanceof DocError) return res.status(400).json({ error: error.message })
        throw error
      }
      await store.writeStatus(userId, channel, { ...report, at: now().toISOString() })
      return res.status(200).json({ ok: true })
    } catch (error) {
      return failure(res, error)
    }
  }
}

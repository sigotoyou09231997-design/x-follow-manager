// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { UnauthorizedError } from './auth.js'
import { hashPosterKey, type ChannelName, type PosterStatus } from './autopostDoc.js'
import {
  createAutopostHandler,
  createPosterStatusHandler,
  createPosterTextHandler,
  type Deps,
} from './autopostHandlers.js'
import { emptyChannel, PauseNotReadyError, type AutopostStore, type ChannelRow } from './autopostStore.js'

// 保存先を手元のメモリに差し替えて、画面と Mac の投稿役が使う3つの受け口を通す。
// Supabase 側の「読んで→書く」の取り合い（版が違えば書かない）は、本番の SQL でしか確かめられないので、
// ここでは同じ約束をメモリで再現して、ハンドラが約束どおりに使っているかを見る。

function memoryStore(): AutopostStore & {
  rows: Map<string, ChannelRow>
  keys: Map<string, string>
  /** 止める機能の表（SQL 006）があるか。false にすると、本番で表がまだ無いときを再現する。 */
  pauseTable: { ready: boolean }
} {
  const rows = new Map<string, ChannelRow>()
  const keys = new Map<string, string>()
  const pauseTable = { ready: true }
  const id = (userId: string, channel: ChannelName) => `${userId}/${channel}`
  return {
    rows,
    keys,
    pauseTable,
    async getChannel(userId, channel) {
      const row = rows.get(id(userId, channel)) ?? emptyChannel(channel)
      // 表が無いあいだは、止めている行があっても読めない（常に「止めていない」・pauseReady false）
      return structuredClone(
        pauseTable.ready ? row : { ...row, paused: false, pausedAt: null, pauseReady: false }
      )
    },
    async saveText(userId, channel, next, baseVersion) {
      const current = rows.get(id(userId, channel)) ?? emptyChannel(channel)
      if (current.version !== baseVersion) return null
      const saved: ChannelRow = { ...current, ...next, version: baseVersion + 1, savedAt: '2026-10-07T12:00:00.000Z' }
      rows.set(id(userId, channel), saved)
      return structuredClone(saved)
    },
    async writeStatus(userId, channel, status: PosterStatus) {
      const current = rows.get(id(userId, channel)) ?? emptyChannel(channel)
      rows.set(id(userId, channel), { ...current, status })
    },
    async setPaused(userId, channel, paused) {
      if (!pauseTable.ready) throw new PauseNotReadyError()
      const current = rows.get(id(userId, channel)) ?? emptyChannel(channel)
      const next: ChannelRow = {
        ...current,
        paused,
        // すでに止めているなら、止めた時刻は動かさない
        pausedAt: paused ? (current.paused ? current.pausedAt : '2026-10-07T12:10:00.000Z') : null,
      }
      rows.set(id(userId, channel), next)
      return structuredClone(next)
    },
    async userIdForPosterKey(tokenHash) {
      return keys.get(tokenHash) ?? null
    },
  }
}

interface Reply {
  status: number
  body: unknown
}

async function call(
  handler: (req: VercelRequest, res: VercelResponse) => Promise<unknown>,
  init: { method: string; authorization?: string; query?: Record<string, string>; body?: unknown }
): Promise<Reply> {
  const reply: Reply = { status: 200, body: undefined }
  const res = {
    setHeader: () => res,
    status(code: number) {
      reply.status = code
      return res
    },
    json(body: unknown) {
      reply.body = body
      return res
    },
  } as unknown as VercelResponse
  const req = {
    method: init.method,
    headers: { authorization: init.authorization },
    query: init.query ?? {},
    body: init.body,
  } as unknown as VercelRequest
  await handler(req, res)
  return reply
}

const OWNER = 'user-owner'
const OTHER = 'user-other'

function setup() {
  const store = memoryStore()
  store.keys.set(hashPosterKey('mac-key'), OWNER)
  const deps: Deps = {
    store,
    authenticate: async (header) => {
      if (header === 'Bearer owner-token') return OWNER
      if (header === 'Bearer other-token') return OTHER
      throw new UnauthorizedError('ログインが必要です')
    },
  }
  return {
    store,
    screen: createAutopostHandler(deps),
    posterText: createPosterTextHandler(deps),
    posterStatus: createPosterStatusHandler(deps, () => new Date('2026-10-07T12:30:00.000Z')),
  }
}

const AS_OWNER = { authorization: 'Bearer owner-token' }
const AS_MAC = { authorization: 'Bearer mac-key' }

describe('画面向け /api/autopost', () => {
  let t: ReturnType<typeof setup>
  beforeEach(() => {
    t = setup()
  })

  it('ログインしていなければ読めない・書けない', async () => {
    expect((await call(t.screen, { method: 'GET' })).status).toBe(401)
    expect((await call(t.screen, { method: 'POST', body: { messages: ['a'], baseVersion: 0 } })).status).toBe(401)
    expect(t.store.rows.size).toBe(0)
  })

  it('まだ何も保存していなくても、全投稿先を空の状態で返す', async () => {
    const r = await call(t.screen, { method: 'GET', ...AS_OWNER })
    expect(r.status).toBe(200)
    const { channels } = r.body as { channels: Record<string, { messages: string[]; version: number; limits: { maxMessages: number } }> }
    expect(Object.keys(channels).sort()).toEqual(['discord', 'yay'])
    expect(channels.discord).toMatchObject({ messages: [], version: 0, limits: { maxMessages: 10 } })
    expect(channels.yay.limits.maxMessages).toBe(1)
  })

  it('保存すると版が進み、差し替えで外れた文が履歴に残る（新しい順）', async () => {
    const save = (messages: string[], baseVersion: number, channel = 'discord') =>
      call(t.screen, { method: 'POST', ...AS_OWNER, body: { channel, messages, baseVersion } })

    const first = await save(['一つ目'], 0)
    expect(first.status).toBe(200)
    expect((first.body as { snapshot: { version: number } }).snapshot.version).toBe(1)

    await save(['二つ目'], 1)
    const third = await save(['三つ目'], 2)
    expect((third.body as { snapshot: { messages: string[]; archive: string[] } }).snapshot).toMatchObject({
      messages: ['三つ目'],
      archive: ['二つ目', '一つ目'],
    })
  })

  it('別の端末で先に保存されていたら上書きせず、最新を添えて409を返す', async () => {
    await call(t.screen, { method: 'POST', ...AS_OWNER, body: { channel: 'discord', messages: ['先に保存'], baseVersion: 0 } })
    const stale = await call(t.screen, {
      method: 'POST',
      ...AS_OWNER,
      body: { channel: 'discord', messages: ['古い画面の内容'], baseVersion: 0 },
    })
    expect(stale.status).toBe(409)
    expect((stale.body as { snapshot: { messages: string[] } }).snapshot.messages).toEqual(['先に保存'])
    expect(t.store.rows.get(`${OWNER}/discord`)?.messages).toEqual(['先に保存'])
  })

  it('空の文・長すぎる文・多すぎる文は保存しない', async () => {
    const save = (messages: unknown, channel = 'discord') =>
      call(t.screen, { method: 'POST', ...AS_OWNER, body: { channel, messages, baseVersion: 0 } })
    expect((await save([])).status).toBe(400)
    expect((await save(['  \n '])).status).toBe(400)
    expect((await save(['あ'.repeat(1001)])).status).toBe(400)
    expect((await save(Array.from({ length: 11 }, (_, i) => `文${i}`))).status).toBe(400)
    expect((await save(['1つ目', '2つ目'], 'yay')).status).toBe(400) // yay は1つだけ
    expect(t.store.rows.size).toBe(0)
  })

  it('見ていた版が分からない・投稿先が違う送信は受けない', async () => {
    const post = (body: unknown) => call(t.screen, { method: 'POST', ...AS_OWNER, body })
    expect((await post({ channel: 'discord', messages: ['a'] })).status).toBe(400)
    expect((await post({ channel: 'discord', messages: ['a'], baseVersion: -1 })).status).toBe(400)
    expect((await post({ channel: 'twitter', messages: ['a'], baseVersion: 0 })).status).toBe(400)
  })

  describe('止める／再開する', () => {
    const pause = (paused: unknown, channel = 'discord', extra: object = {}) =>
      call(t.screen, { method: 'POST', ...AS_OWNER, body: { channel, paused, ...extra } })
    const snapshotOf = (r: Reply) =>
      (r.body as { snapshot: { paused: boolean; pausedAt: string | null; version: number; messages: string[] } }).snapshot

    it('止めると印が付き、再開すると外れる。文の版は動かない', async () => {
      await call(t.screen, { method: 'POST', ...AS_OWNER, body: { channel: 'discord', messages: ['a'], baseVersion: 0 } })

      const stopped = snapshotOf(await pause(true))
      expect(stopped).toMatchObject({ paused: true, pausedAt: '2026-10-07T12:10:00.000Z', version: 1, messages: ['a'] })

      const listed = (await call(t.screen, { method: 'GET', ...AS_OWNER })).body as {
        channels: Record<string, { paused: boolean }>
      }
      expect(listed.channels.discord.paused).toBe(true)

      const resumed = snapshotOf(await pause(false))
      expect(resumed).toMatchObject({ paused: false, pausedAt: null, version: 1 })
    })

    it('止めた投稿先だけが止まる（もう一方は動いたまま）', async () => {
      await pause(true, 'yay')
      const listed = (await call(t.screen, { method: 'GET', ...AS_OWNER })).body as {
        channels: Record<string, { paused: boolean }>
      }
      expect(listed.channels.yay.paused).toBe(true)
      expect(listed.channels.discord.paused).toBe(false)
    })

    it('止めたまま押し直しても、止めた時刻は変わらない', async () => {
      await pause(true)
      const again = snapshotOf(await pause(true))
      expect(again.pausedAt).toBe('2026-10-07T12:10:00.000Z')
    })

    it('文の保存とは混ぜられない・真偽値以外は受けない', async () => {
      expect((await pause('true')).status).toBe(400)
      expect((await pause(1)).status).toBe(400)
      expect((await pause(null)).status).toBe(400)
      expect((await pause(true, 'discord', { messages: ['a'], baseVersion: 0 })).status).toBe(400)
      expect((await pause(true, 'twitter')).status).toBe(400)
      expect(t.store.rows.size).toBe(0)
    })

    it('ログインしていない人・合鍵では止められない', async () => {
      expect((await call(t.screen, { method: 'POST', body: { channel: 'discord', paused: true } })).status).toBe(401)
      expect((await call(t.screen, { method: 'POST', ...AS_MAC, body: { channel: 'discord', paused: true } })).status).toBe(401)
      expect(t.store.rows.size).toBe(0)
    })

    it('ほかの人が止めた印は見えない', async () => {
      await pause(true)
      const r = await call(t.screen, { method: 'GET', authorization: 'Bearer other-token' })
      const { channels } = r.body as { channels: Record<string, { paused: boolean }> }
      expect(channels.discord.paused).toBe(false)
    })

    it('表（SQL 006）が無いあいだは、止める操作だけが断られ、文の保存と読み込みは通る', async () => {
      t.store.pauseTable.ready = false

      const refused = await pause(true)
      expect(refused.status).toBe(503)
      expect((refused.body as { error: string }).error).toContain('006_autopost_pause.sql')

      const listed = await call(t.screen, { method: 'GET', ...AS_OWNER })
      expect(listed.status).toBe(200)
      const { channels } = listed.body as { channels: Record<string, { paused: boolean; pauseReady: boolean }> }
      expect(channels.discord).toMatchObject({ paused: false, pauseReady: false })

      const saved = await call(t.screen, { method: 'POST', ...AS_OWNER, body: { channel: 'discord', messages: ['a'], baseVersion: 0 } })
      expect(saved.status).toBe(200)
    })
  })

  it('ほかの人の文は見えない', async () => {
    await call(t.screen, { method: 'POST', ...AS_OWNER, body: { channel: 'discord', messages: ['自分の文'], baseVersion: 0 } })
    const r = await call(t.screen, { method: 'GET', authorization: 'Bearer other-token' })
    const { channels } = r.body as { channels: Record<string, { messages: string[] }> }
    expect(channels.discord.messages).toEqual([])
  })
})

describe('Mac の投稿役向け（合鍵）', () => {
  let t: ReturnType<typeof setup>
  beforeEach(() => {
    t = setup()
  })

  it('合鍵が無い・違うときは401', async () => {
    expect((await call(t.posterText, { method: 'GET' })).status).toBe(401)
    expect((await call(t.posterText, { method: 'GET', authorization: 'Bearer wrong' })).status).toBe(401)
    expect((await call(t.posterStatus, { method: 'POST', authorization: 'Bearer wrong', body: { lastPost: null, today: 0 } })).status).toBe(401)
    // 画面のログイン用トークンでは、合鍵の受け口に入れない
    expect((await call(t.posterText, { method: 'GET', ...AS_OWNER })).status).toBe(401)
  })

  it('文がまだ無ければ404、保存すれば以前の編集画面と同じ形で返す', async () => {
    expect((await call(t.posterText, { method: 'GET', ...AS_MAC })).status).toBe(404)

    await call(t.screen, { method: 'POST', ...AS_OWNER, body: { channel: 'discord', messages: ['a', 'b'], baseVersion: 0 } })
    await call(t.screen, { method: 'POST', ...AS_OWNER, body: { channel: 'yay', messages: ['やっほー'], baseVersion: 0 } })

    // 投稿先を付けない呼び方は、以前どおりディスコード
    const discord = await call(t.posterText, { method: 'GET', ...AS_MAC })
    expect(discord).toEqual({
      status: 200,
      body: { messages: ['a', 'b'], updatedAt: '2026-10-07T12:00:00.000Z', paused: false, pausedAt: null },
    })

    const yay = await call(t.posterText, { method: 'GET', ...AS_MAC, query: { ch: 'yay' } })
    expect((yay.body as { messages: string[] }).messages).toEqual(['やっほー'])
  })

  describe('止められているか', () => {
    const stop = (channel = 'discord') =>
      call(t.screen, { method: 'POST', ...AS_OWNER, body: { channel, paused: true } })

    it('止めているあいだは paused: true で返し、再開すれば false に戻る', async () => {
      await call(t.screen, { method: 'POST', ...AS_OWNER, body: { channel: 'discord', messages: ['a'], baseVersion: 0 } })
      expect(((await call(t.posterText, { method: 'GET', ...AS_MAC })).body as { paused: boolean }).paused).toBe(false)

      await stop()
      const stopped = (await call(t.posterText, { method: 'GET', ...AS_MAC })).body as { paused: boolean; messages: string[] }
      expect(stopped).toMatchObject({ paused: true, messages: ['a'] })

      await call(t.screen, { method: 'POST', ...AS_OWNER, body: { channel: 'discord', paused: false } })
      expect(((await call(t.posterText, { method: 'GET', ...AS_MAC })).body as { paused: boolean }).paused).toBe(false)
    })

    it('止めたのは、その投稿先だけ', async () => {
      await call(t.screen, { method: 'POST', ...AS_OWNER, body: { channel: 'discord', messages: ['a'], baseVersion: 0 } })
      await call(t.screen, { method: 'POST', ...AS_OWNER, body: { channel: 'yay', messages: ['やっほー'], baseVersion: 0 } })
      await stop('yay')
      const discord = (await call(t.posterText, { method: 'GET', ...AS_MAC })).body as { paused: boolean }
      const yay = (await call(t.posterText, { method: 'GET', ...AS_MAC, query: { ch: 'yay' } })).body as { paused: boolean }
      expect(discord.paused).toBe(false)
      expect(yay.paused).toBe(true)
    })

    it('文をまだ保存していなくても、止めていれば404にせず止めていることを伝える', async () => {
      await stop()
      const r = await call(t.posterText, { method: 'GET', ...AS_MAC })
      expect(r.status).toBe(200)
      expect(r.body).toMatchObject({ messages: [], paused: true })
    })

    it('投稿役の「いま止まっています」の報告を保存し、画面に返す', async () => {
      const report = { lastPost: null, today: 3, paused: true }
      expect((await call(t.posterStatus, { method: 'POST', ...AS_MAC, body: report })).status).toBe(200)
      const r = await call(t.screen, { method: 'GET', ...AS_OWNER })
      const { channels } = r.body as { channels: Record<string, { status: PosterStatus | null }> }
      expect(channels.discord.status).toEqual({ ...report, at: '2026-10-07T12:30:00.000Z' })
    })

    it('止める機能より前の投稿役は paused を送らない（それでも受ける）', async () => {
      expect((await call(t.posterStatus, { method: 'POST', ...AS_MAC, body: { lastPost: null, today: 0 } })).status).toBe(200)
      const r = await call(t.screen, { method: 'GET', ...AS_OWNER })
      const { channels } = r.body as { channels: Record<string, { status: PosterStatus | null }> }
      expect(channels.discord.status).not.toHaveProperty('paused')
    })

    it('paused が真偽値でない報告は受けない（"false" を真と読み違えない）', async () => {
      const post = (paused: unknown) =>
        call(t.posterStatus, { method: 'POST', ...AS_MAC, body: { lastPost: null, today: 0, paused } })
      expect((await post('false')).status).toBe(400)
      expect((await post(0)).status).toBe(400)
      expect((await post(null)).status).toBe(400)
      expect(t.store.rows.size).toBe(0)
    })
  })

  it('状態の報告は文に触らず、画面の状態に反映される', async () => {
    await call(t.screen, { method: 'POST', ...AS_OWNER, body: { channel: 'yay', messages: ['やっほー'], baseVersion: 0 } })
    const report = { lastPost: { t: '2026-10-07T12:25:00.000Z', text: 'やっほー' }, today: 12 }
    expect((await call(t.posterStatus, { method: 'POST', ...AS_MAC, query: { ch: 'yay' }, body: report })).status).toBe(200)

    const r = await call(t.screen, { method: 'GET', ...AS_OWNER })
    const { channels } = r.body as { channels: Record<string, { messages: string[]; version: number; status: PosterStatus | null }> }
    expect(channels.yay.messages).toEqual(['やっほー'])
    expect(channels.yay.version).toBe(1)
    expect(channels.yay.status).toEqual({ ...report, at: '2026-10-07T12:30:00.000Z' })
  })

  it('文を保存する前に報告が来ても、その後の保存ができる（版0のまま）', async () => {
    await call(t.posterStatus, { method: 'POST', ...AS_MAC, body: { lastPost: null, today: 0 } })
    const r = await call(t.screen, { method: 'GET', ...AS_OWNER })
    expect((r.body as { channels: { discord: { version: number } } }).channels.discord.version).toBe(0)

    const saved = await call(t.screen, { method: 'POST', ...AS_OWNER, body: { channel: 'discord', messages: ['初めての文'], baseVersion: 0 } })
    expect(saved.status).toBe(200)
  })

  it('形のおかしい報告は受けない', async () => {
    const post = (body: unknown) => call(t.posterStatus, { method: 'POST', ...AS_MAC, body })
    expect((await post({ lastPost: null, today: -1 })).status).toBe(400)
    expect((await post({ lastPost: null, today: 1.5 })).status).toBe(400)
    expect((await post({ lastPost: { t: 1, text: 'x' }, today: 0 })).status).toBe(400)
    expect((await post({ lastPost: { t: 'x', text: 'あ'.repeat(2001) }, today: 0 })).status).toBe(400)
    expect(t.store.rows.size).toBe(0)
  })
})

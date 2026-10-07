// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { UnauthorizedError } from './_lib/auth.js'
import { hashPosterKey, type ChannelName, type PosterStatus } from './_lib/autopostDoc.js'
import {
  createAutopostHandler,
  createPosterStatusHandler,
  createPosterTextHandler,
  type Deps,
} from './_lib/autopostHandlers.js'
import { emptyChannel, type AutopostStore, type ChannelRow } from './_lib/autopostStore.js'

// 保存先を手元のメモリに差し替えて、画面と Mac の投稿役が使う3つの受け口を通す。
// Supabase 側の「読んで→書く」の取り合い（版が違えば書かない）は、本番の SQL でしか確かめられないので、
// ここでは同じ約束をメモリで再現して、ハンドラが約束どおりに使っているかを見る。

function memoryStore(): AutopostStore & { rows: Map<string, ChannelRow>; keys: Map<string, string> } {
  const rows = new Map<string, ChannelRow>()
  const keys = new Map<string, string>()
  const id = (userId: string, channel: ChannelName) => `${userId}/${channel}`
  return {
    rows,
    keys,
    async getChannel(userId, channel) {
      return structuredClone(rows.get(id(userId, channel)) ?? emptyChannel(channel))
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
    expect(discord).toEqual({ status: 200, body: { messages: ['a', 'b'], updatedAt: '2026-10-07T12:00:00.000Z' } })

    const yay = await call(t.posterText, { method: 'GET', ...AS_MAC, query: { ch: 'yay' } })
    expect((yay.body as { messages: string[] }).messages).toEqual(['やっほー'])
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

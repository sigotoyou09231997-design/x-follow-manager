// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { UnauthorizedError } from './auth.js'
import { hashPosterKey } from './autopostDoc.js'
import { createAutopostHandler, type Deps } from './autopostHandlers.js'
import { emptyChannel, type AutopostStore } from './autopostStore.js'
import { createPosterCommandHandler } from './posterCommandHandler.js'
import {
  isPending,
  NOT_READY,
  REQUEST_COOLDOWN_SECONDS,
  REQUEST_VALID_SECONDS,
  RestartNotReadyError,
  type RestartState,
  type RestartStore,
} from './restartStore.js'

// 画面の「投稿役を再起動する」と、Mac の見張りが使う受け口を、保存先を手元のメモリに差し替えて通す。
// Supabase の upsert / 条件つき update は本番でしか確かめられないので、ここでは同じ約束をメモリで再現して、
// ハンドラが約束どおりに使っているか（本人だけが依頼できる・Mac は合鍵で・古い依頼は実行しない）を見る。

function memoryRestartStore(): RestartStore & {
  rows: Map<string, RestartState>
  table: { ready: boolean }
} {
  const rows = new Map<string, RestartState>()
  const table = { ready: true }
  const row = (userId: string): RestartState =>
    rows.get(userId) ?? { ready: true, requestedAt: null, handledAt: null, result: null }
  const age = (iso: string, now: Date) => Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 1000))
  return {
    rows,
    table,
    async get(userId) {
      return table.ready ? structuredClone(row(userId)) : NOT_READY
    },
    async request(userId, now) {
      if (!table.ready) throw new RestartNotReadyError()
      const current = row(userId)
      if (isPending(current) && age(current.requestedAt!, now) < REQUEST_COOLDOWN_SECONDS) return structuredClone(current)
      const next: RestartState = { ready: true, requestedAt: now.toISOString(), handledAt: null, result: null }
      rows.set(userId, next)
      return structuredClone(next)
    },
    async pending(userId, now) {
      if (!table.ready) return null
      const current = row(userId)
      if (!isPending(current)) return null
      const seconds = age(current.requestedAt!, now)
      return seconds <= REQUEST_VALID_SECONDS ? { requestedAt: current.requestedAt!, ageSeconds: seconds } : null
    },
    async ack(userId, requestedAt, result, now) {
      const current = row(userId)
      if (!isPending(current) || current.requestedAt !== requestedAt) return false
      rows.set(userId, { ...current, handledAt: now.toISOString(), result })
      return true
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
const AS_OWNER = { authorization: 'Bearer owner-token' }
const AS_OTHER = { authorization: 'Bearer other-token' }
const AS_MAC = { authorization: 'Bearer mac-key' }

function setup() {
  const clock = { now: new Date('2026-10-12T07:00:00.000Z') }
  const restart = memoryRestartStore()
  // 投稿役の合鍵から持ち主を引く部分だけがあればよい（文や状態の保存は、この受け口では使わない）
  const keys = new Map<string, string>([[hashPosterKey('mac-key'), OWNER]])
  const store = { userIdForPosterKey: async (hash: string) => keys.get(hash) ?? null } as unknown as AutopostStore
  const deps: Deps = {
    store: { ...store, getChannel: async (_u, channel) => emptyChannel(channel) } as AutopostStore,
    restart,
    authenticate: async (header) => {
      if (header === 'Bearer owner-token') return OWNER
      if (header === 'Bearer other-token') return OTHER
      throw new UnauthorizedError('ログインが必要です')
    },
  }
  return {
    clock,
    restart,
    screen: createAutopostHandler(deps, () => clock.now),
    mac: createPosterCommandHandler(deps, () => clock.now),
    /** 画面の依頼の受け口を、再起動の表を持たない作りで作り直す（古いテストの Deps と同じ形）。 */
    screenWithoutRestart: createAutopostHandler({ ...deps, restart: undefined }, () => clock.now),
  }
}

const advance = (clock: { now: Date }, seconds: number) => {
  clock.now = new Date(clock.now.getTime() + seconds * 1000)
}

describe('画面から再起動を依頼する（POST /api/autopost { restart: true }）', () => {
  let t: ReturnType<typeof setup>
  beforeEach(() => {
    t = setup()
  })

  it('ログインしていなければ依頼できない', async () => {
    expect((await call(t.screen, { method: 'POST', body: { restart: true } })).status).toBe(401)
    expect(t.restart.rows.size).toBe(0)
  })

  it('依頼すると「依頼中」になる（Mac が処理するまで handledAt は空）', async () => {
    const r = await call(t.screen, { method: 'POST', ...AS_OWNER, body: { restart: true } })
    expect(r.status).toBe(200)
    expect((r.body as { restart: RestartState }).restart).toEqual({
      ready: true,
      requestedAt: '2026-10-12T07:00:00.000Z',
      handledAt: null,
      result: null,
    })
  })

  it('1分以内に押し直しても、依頼は新しくならない（連打で何度も入れ替わらない）', async () => {
    await call(t.screen, { method: 'POST', ...AS_OWNER, body: { restart: true } })
    advance(t.clock, REQUEST_COOLDOWN_SECONDS - 1)
    const again = await call(t.screen, { method: 'POST', ...AS_OWNER, body: { restart: true } })
    expect((again.body as { restart: RestartState }).restart.requestedAt).toBe('2026-10-12T07:00:00.000Z')
  })

  it('1分たてば、新しい依頼として置き直せる', async () => {
    await call(t.screen, { method: 'POST', ...AS_OWNER, body: { restart: true } })
    advance(t.clock, REQUEST_COOLDOWN_SECONDS + 1)
    const again = await call(t.screen, { method: 'POST', ...AS_OWNER, body: { restart: true } })
    expect((again.body as { restart: RestartState }).restart.requestedAt).toBe('2026-10-12T07:01:01.000Z')
  })

  it('ほかの操作（文の保存・止める）とは混ぜられない／true 以外は受け付けない', async () => {
    for (const body of [{ restart: true, messages: ['a'] }, { restart: true, paused: true }, { restart: 'yes' }, { restart: false }]) {
      expect((await call(t.screen, { method: 'POST', ...AS_OWNER, body })).status).toBe(400)
    }
    expect(t.restart.rows.size).toBe(0)
  })

  it('表（SQL 008）がまだ無いときは、SQL を案内する 503', async () => {
    t.restart.table.ready = false
    const r = await call(t.screen, { method: 'POST', ...AS_OWNER, body: { restart: true } })
    expect(r.status).toBe(503)
    expect((r.body as { error: string }).error).toContain('008_autopost_restart.sql')
  })

  it('再起動の表を持たない作りでも、落ちずに「準備中」として答える', async () => {
    expect((await call(t.screenWithoutRestart, { method: 'POST', ...AS_OWNER, body: { restart: true } })).status).toBe(503)
    const r = await call(t.screenWithoutRestart, { method: 'GET', ...AS_OWNER, query: { part: 'restart' } })
    expect((r.body as { restart: RestartState }).restart.ready).toBe(false)
  })
})

describe('画面が状態を見る（GET /api/autopost?part=restart）', () => {
  it('依頼のあと・処理されたあとの状態が見える。ほかの人の依頼は見えない', async () => {
    const t = setup()
    await call(t.screen, { method: 'POST', ...AS_OWNER, body: { restart: true } })
    const requestedAt = '2026-10-12T07:00:00.000Z'

    const pending = await call(t.screen, { method: 'GET', ...AS_OWNER, query: { part: 'restart' } })
    expect((pending.body as { restart: RestartState }).restart).toMatchObject({ requestedAt, handledAt: null })

    advance(t.clock, 30)
    await call(t.mac, { method: 'POST', ...AS_MAC, body: { requestedAt, result: 'Yay: 再起動しました' } })
    const done = await call(t.screen, { method: 'GET', ...AS_OWNER, query: { part: 'restart' } })
    expect((done.body as { restart: RestartState }).restart).toMatchObject({
      requestedAt,
      handledAt: '2026-10-12T07:00:30.000Z',
      result: 'Yay: 再起動しました',
    })

    const other = await call(t.screen, { method: 'GET', ...AS_OTHER, query: { part: 'restart' } })
    expect((other.body as { restart: RestartState }).restart.requestedAt).toBeNull()
  })

  it('part=restart のときは、文や状態は読まない（短い間隔で見ても重くならない）', async () => {
    const t = setup()
    const r = await call(t.screen, { method: 'GET', ...AS_OWNER, query: { part: 'restart' } })
    expect(Object.keys(r.body as object)).toEqual(['restart'])
  })
})

describe('Mac の見張りが受け取る（/api/poster-command）', () => {
  let t: ReturnType<typeof setup>
  beforeEach(async () => {
    t = setup()
    await call(t.screen, { method: 'POST', ...AS_OWNER, body: { restart: true } })
  })

  it('合鍵が無い・合わなければ、依頼を読めず、書き戻せない', async () => {
    expect((await call(t.mac, { method: 'GET' })).status).toBe(401)
    expect((await call(t.mac, { method: 'GET', authorization: 'Bearer wrong' })).status).toBe(401)
    expect((await call(t.mac, { method: 'POST', body: { requestedAt: 'x', result: 'y' } })).status).toBe(401)
    // 画面のログイン用トークンでは通らない（Mac 用の合鍵とは別物）
    expect((await call(t.mac, { method: 'GET', ...AS_OWNER })).status).toBe(401)
  })

  it('未処理の依頼と、依頼からの経過秒が読める', async () => {
    advance(t.clock, 45)
    const r = await call(t.mac, { method: 'GET', ...AS_MAC })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ restart: { requestedAt: '2026-10-12T07:00:00.000Z', ageSeconds: 45 } })
  })

  it('依頼が無いときは null', async () => {
    const empty = setup()
    expect((await call(empty.mac, { method: 'GET', ...AS_MAC })).body).toEqual({ restart: null })
  })

  it('有効期間（30分）を過ぎた依頼は渡さない（Mac が戻ってきても、昔の依頼を実行しない）', async () => {
    advance(t.clock, REQUEST_VALID_SECONDS + 1)
    expect((await call(t.mac, { method: 'GET', ...AS_MAC })).body).toEqual({ restart: null })
  })

  it('処理結果を書き戻すと、もう未処理ではなくなる', async () => {
    const requestedAt = '2026-10-12T07:00:00.000Z'
    const r = await call(t.mac, { method: 'POST', ...AS_MAC, body: { requestedAt, result: 'ok' } })
    expect(r.body).toEqual({ ok: true, acked: true })
    expect((await call(t.mac, { method: 'GET', ...AS_MAC })).body).toEqual({ restart: null })
  })

  it('古い依頼の結果は、新しい依頼を処理済みにしない', async () => {
    const old = '2026-10-12T07:00:00.000Z'
    advance(t.clock, REQUEST_COOLDOWN_SECONDS + 1)
    await call(t.screen, { method: 'POST', ...AS_OWNER, body: { restart: true } }) // 新しい依頼
    const r = await call(t.mac, { method: 'POST', ...AS_MAC, body: { requestedAt: old, result: 'ok' } })
    expect(r.body).toEqual({ ok: true, acked: false })
    expect((await call(t.mac, { method: 'GET', ...AS_MAC })).body).toMatchObject({ restart: { requestedAt: '2026-10-12T07:01:01.000Z' } })
  })

  it('書き戻しの形が違えば 400。結果は長すぎれば切る', async () => {
    expect((await call(t.mac, { method: 'POST', ...AS_MAC, body: { result: 'ok' } })).status).toBe(400)
    expect((await call(t.mac, { method: 'POST', ...AS_MAC, body: { requestedAt: 'x', result: 1 } })).status).toBe(400)
    await call(t.mac, { method: 'POST', ...AS_MAC, body: { requestedAt: '2026-10-12T07:00:00.000Z', result: 'あ'.repeat(1000) } })
    expect(t.restart.rows.get(OWNER)?.result).toHaveLength(300)
  })

  it('GET / POST 以外は 405', async () => {
    expect((await call(t.mac, { method: 'DELETE', ...AS_MAC })).status).toBe(405)
  })
})

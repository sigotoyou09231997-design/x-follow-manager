// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { UnauthorizedError } from './auth.js'
import { createAutopilotHandler, SETUP_MESSAGE, type HandlerDeps } from './autopilotHandler.js'
import { AutopilotNotReadyError } from './autopilotStore.js'
import { EngineError } from './autopilotEngine.js'
import { history, makeDeps, memoryStore, OWNER, ready, resetWritten } from './autopilotTestKit.js'
import { XApiError } from './xClient.js'

// 画面向けの受け口: ログインの確認・操作の受け付け・失敗の日本語化・他人の設定に触れないこと。

interface Reply {
  status: number
  body: any
}

async function call(
  handler: (req: VercelRequest, res: VercelResponse) => Promise<unknown>,
  init: { method?: string; authorization?: string; body?: unknown }
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
    method: init.method ?? 'POST',
    headers: { authorization: init.authorization },
    body: init.body,
  } as unknown as VercelRequest
  await handler(req, res)
  return reply
}

const AS_OWNER = { authorization: 'Bearer owner' }

function setup(store = ready({ enabled: false })) {
  const made = makeDeps(store)
  const deps: HandlerDeps = {
    engine: made.deps,
    authenticate: async (header) => {
      if (header === 'Bearer owner') return OWNER
      throw new UnauthorizedError('ログインが必要です')
    },
  }
  return { store, ...made, handler: createAutopilotHandler(deps) }
}

beforeEach(() => resetWritten())

describe('ログインと形式', () => {
  it('ログインしていなければ、何も読めない・できない', async () => {
    const { handler, writeProfile, fetchOwnPosts } = setup()
    expect((await call(handler, { method: 'GET' })).status).toBe(401)
    expect((await call(handler, { body: { action: 'buildProfile' } })).status).toBe(401)
    expect((await call(handler, { body: { action: 'enable' } })).status).toBe(401)
    expect(writeProfile).not.toHaveBeenCalled()
    expect(fetchOwnPosts).not.toHaveBeenCalled()
  })

  it('GET と POST 以外は受けない。不明な操作・壊れた本文は 400', async () => {
    const { handler } = setup()
    expect((await call(handler, { method: 'DELETE', ...AS_OWNER })).status).toBe(405)
    expect((await call(handler, { ...AS_OWNER, body: { action: 'nope' } })).status).toBe(400)
    expect((await call(handler, { ...AS_OWNER, body: '{壊れた' })).status).toBe(400)
    expect((await call(handler, { ...AS_OWNER, body: [1, 2] })).status).toBe(400)
  })
})

describe('状態', () => {
  it('GET で、設定・履歴の件数と日付・文体のまとめの有無・今月の使用額を返す（履歴の本文は返さない。まとめの中身と最近の傾向は返す）', async () => {
    const { handler } = setup(ready())
    const r = await call(handler, { method: 'GET', ...AS_OWNER })
    expect(r.status).toBe(200)
    const { state } = r.body
    expect(state.enabled).toBe(true)
    expect(state.settings.postsPerDay).toBe(3)
    expect(state.history).toMatchObject({ total: 40 })
    expect(state.history.newestAt > state.history.oldestAt).toBe(true)
    expect(state.profileReady).toBe(true)
    expect(state.xAccount).toEqual({ username: 'me' })
    expect(state.usage.yen).toBe(0)
    expect(JSON.stringify(state)).not.toContain('過去の投稿その') // 履歴の本文は送らない
    // 文体のまとめの中身（要約・語尾・話題）と最近の傾向は、本人の希望（2026-10-25）で、画面に出すために返す。
    expect(state.profile.summary).toBe('ゆるい独り言が多い')
    expect(state.recentStyle).toEqual(expect.any(String))
  })

  it('文体のまとめが無ければ profileReady は false', async () => {
    const r = await call(setup(memoryStore({ history: history(40) })).handler, { method: 'GET', ...AS_OWNER })
    expect(r.body.state.profileReady).toBe(false)
  })

  it('Xと連携していなければ xAccount は null', async () => {
    const store = ready()
    store.hasAccount = false
    const r = await call(setup(store).handler, { method: 'GET', ...AS_OWNER })
    expect(r.body.state.xAccount).toBeNull()
  })
})

describe('操作', () => {
  it('履歴を読み込む: 件数と費用が状態に反映される', async () => {
    const { handler, fetchOwnPosts, store } = setup(memoryStore())
    fetchOwnPosts.mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => ({ id: String(500 + i), text: `朝の気づきその${i}をつぶやく`, created_at: `2026-09-${String((i % 28) + 1).padStart(2, '0')}T00:00:00.000Z` }))
    )
    const r = await call(handler, { ...AS_OWNER, body: { action: 'readHistory', limit: 100 } })
    expect(r.status).toBe(200)
    expect(r.body.result).toMatchObject({ fetched: 30, total: 30 })
    expect(r.body.state.history.total).toBe(30)
    expect(store.rows.get(OWNER)?.usage.yen).toBeGreaterThan(0)
  })

  it('読み込む件数は 20〜400 に収める（課金の上限）', async () => {
    const { handler, fetchOwnPosts } = setup(memoryStore())
    await call(handler, { ...AS_OWNER, body: { action: 'readHistory', limit: 100000 } })
    expect(fetchOwnPosts).toHaveBeenCalledWith('token', '555', { limit: 400, sinceId: undefined })
  })

  it('文体をまとめる', async () => {
    const store = memoryStore({ history: history(40) })
    const r = await call(setup(store).handler, { ...AS_OWNER, body: { action: 'buildProfile' } })
    expect(r.status).toBe(200)
    expect(r.body.state.profileReady).toBe(true)
    expect(r.body.state.profile.summary).toBe('ゆるい独り言が多い') // 画面に出すので、中身も返す
    expect(store.rows.get(OWNER)?.profile?.summary).toBe('ゆるい独り言が多い')
  })

  it('試し書き: 本文と、検査に落ちた理由（あれば）を返す。予約は作らない', async () => {
    const { handler, store } = setup(ready())
    const r = await call(handler, { ...AS_OWNER, body: { action: 'preview' } })
    expect(r.status).toBe(200)
    expect(r.body.preview.text).toBeTruthy()
    expect(r.body.preview.problems).toEqual([])
    expect(store.posts).toHaveLength(0)
  })

  it('文章を整える: 直した案と、検査に落ちた理由（あれば）を返す。予約は作らない・文章が無ければ断る', async () => {
    const { handler, store } = setup(ready())
    const r = await call(handler, { ...AS_OWNER, body: { action: 'revise', text: '明日健康診断あるんだけ', instruction: '短く' } })
    expect(r.status).toBe(200)
    expect(r.body.revised.text).toBe('明日健康診断あるんだけ（整えた）')
    expect(r.body.revised.problems).toEqual([])
    expect(store.posts).toHaveLength(0)
    const bad = await call(handler, { ...AS_OWNER, body: { action: 'revise' } })
    expect(bad.status).toBe(400)
  })

  it('ON にすると最初の1本ができ、OFF にすると取り消される', async () => {
    const { handler, store } = setup(ready({ enabled: false }))
    const on = await call(handler, { ...AS_OWNER, body: { action: 'enable' } })
    expect(on.status).toBe(200)
    expect(on.body.state.enabled).toBe(true)
    expect(on.body.result.created).toBe(1)

    const off = await call(handler, { ...AS_OWNER, body: { action: 'disable' } })
    expect(off.body.state.enabled).toBe(false)
    expect(off.body.result.canceled).toBe(1)
    expect(store.posts.every((p) => p.status === 'canceled')).toBe(true)
  })

  it('取り消した枠を、いますぐ別の文で作り直す（refill）。ログインが要る', async () => {
    const { handler, store } = setup(ready())
    const anon = await call(handler, { body: { action: 'refill' } })
    expect(anon.status).toBe(401)

    await call(handler, { ...AS_OWNER, body: { action: 'enable' } })
    const first = store.posts[0]
    first.status = 'canceled' // 画面の「取り消す」（削除せず、印を付けて残す）
    first.rejected = true

    const r = await call(handler, { ...AS_OWNER, body: { action: 'refill' } })
    expect(r.status).toBe(200)
    expect(r.body.result.created).toBe(1)
    const replacement = store.posts.find((p) => p.slotKey === first.slotKey && p.status === 'scheduled')
    expect(replacement).toBeTruthy()
    expect(replacement!.text).not.toBe(first.text)
  })

  it('設定を保存する: 枠が変わったかも返す。範囲外は直さず、理由つきで400', async () => {
    const { handler } = setup(ready())
    const r = await call(handler, { ...AS_OWNER, body: { action: 'saveSettings', settings: { postsPerDay: 2 } } })
    expect(r.status).toBe(200)
    expect(r.body.state.settings.postsPerDay).toBe(2)
    expect(r.body.rebuilt).toBe(true)

    const bad = await call(handler, { ...AS_OWNER, body: { action: 'saveSettings', settings: { postsPerDay: 99 } } })
    expect(bad.status).toBe(400)
    expect(bad.body.error).toMatch(/1〜8回/)

    expect((await call(handler, { ...AS_OWNER, body: { action: 'saveSettings', settings: 'x' } })).status).toBe(400)
    expect((await call(handler, { ...AS_OWNER, body: { action: 'saveSettings' } })).status).toBe(400)
  })
})

describe('失敗の伝え方', () => {
  it('表（SQL 007）が無ければ 503 と SQL の案内', async () => {
    const store = memoryStore()
    store.get = async () => {
      throw new AutopilotNotReadyError()
    }
    const r = await call(setup(store).handler, { method: 'GET', ...AS_OWNER })
    expect(r.status).toBe(503)
    expect(r.body).toEqual({ error: SETUP_MESSAGE, setup: true })
    expect(SETUP_MESSAGE).toContain('007_x_autopilot.sql')
  })

  it('エンジンの案内つきの失敗は、その状態の番号と文でそのまま返す', async () => {
    const store = memoryStore()
    store.hasAccount = false
    const r = await call(setup(store).handler, { ...AS_OWNER, body: { action: 'readHistory' } })
    expect(r.status).toBe(400)
    expect(r.body.error).toContain('Xと連携していません')
  })

  it('Xの読み取りの失敗（クレジット不足など）は、理由を日本語のまま 502 で返す', async () => {
    const { handler, fetchOwnPosts } = setup(memoryStore())
    fetchOwnPosts.mockRejectedValue(new XApiError('X APIのクレジットが足りません（402）', 402, false))
    const r = await call(handler, { ...AS_OWNER, body: { action: 'readHistory' } })
    expect(r.status).toBe(502)
    expect(r.body.error).toContain('クレジットが足りません')
  })

  it('利用制限は 429', async () => {
    const { handler, fetchOwnPosts } = setup(memoryStore())
    fetchOwnPosts.mockRejectedValue(new XApiError('Xの利用制限に達しました', 429, true))
    expect((await call(handler, { ...AS_OWNER, body: { action: 'readHistory' } })).status).toBe(429)
  })

  it('想定外のエラーは中身を出さず 500', async () => {
    const { handler, writeProfile } = setup(memoryStore({ history: history(40) }))
    writeProfile.mockRejectedValue(new Error('内部の秘密の詳細'))
    const r = await call(handler, { ...AS_OWNER, body: { action: 'buildProfile' } })
    expect(r.status).toBe(500)
    expect(JSON.stringify(r.body)).not.toContain('秘密')
  })

  it('EngineError は、渡した状態の番号になる', () => {
    expect(new EngineError('x', 429).status).toBe(429)
    expect(new EngineError('x').status).toBe(400)
  })
})

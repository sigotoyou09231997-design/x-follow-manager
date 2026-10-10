import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({ value: { access_token: 'tok' } as { access_token: string } | null }))
vi.mock('../supabase', () => ({
  requireSupabase: async () => ({ auth: { getSession: async () => ({ data: { session: session.value } }) } }),
}))

import {
  buildAutopilotProfile,
  fetchAutopilot,
  previewAutopilotPost,
  readAutopilotHistory,
  saveAutopilotSettings,
  startAutopilot,
  stopAutopilot,
  XAutopilotError,
} from './api'

const realFetch = globalThis.fetch
let calls: { url: string; init?: RequestInit }[] = []

function reply(status: number, body: unknown) {
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
  }) as unknown as typeof fetch
}

const STATE = { enabled: false }

beforeEach(() => {
  calls = []
  session.value = { access_token: 'tok' }
})
afterEach(() => {
  globalThis.fetch = realFetch
})

describe('自動運転の通信', () => {
  it('状態の取得は GET。ログインのトークンを添える', async () => {
    reply(200, { state: STATE })
    await fetchAutopilot()
    expect(calls[0].url).toBe('/api/xAutopilot')
    expect(calls[0].init?.method).toBe('GET')
    expect(((calls[0].init?.headers ?? {}) as Record<string, string>).authorization).toBe('Bearer tok')
    expect(calls[0].init?.body).toBeUndefined()
  })

  it('操作は POST で、action と必要な値だけを送る', async () => {
    reply(200, { state: STATE })
    await saveAutopilotSettings({ postsPerDay: 5 })
    await readAutopilotHistory({ full: true })
    await readAutopilotHistory()
    await buildAutopilotProfile()
    await previewAutopilotPost()
    await startAutopilot()
    await stopAutopilot()
    const bodies = calls.map((c) => JSON.parse(String(c.init?.body)))
    expect(bodies).toEqual([
      { action: 'saveSettings', settings: { postsPerDay: 5 } },
      { action: 'readHistory', full: true },
      { action: 'readHistory' },
      { action: 'buildProfile' },
      { action: 'preview' },
      { action: 'enable' },
      { action: 'disable' },
    ])
    expect(calls.every((c) => c.init?.method === 'POST')).toBe(true)
  })

  it('ログインしていなければ、送らずに断る', async () => {
    session.value = null
    reply(200, { state: STATE })
    await expect(fetchAutopilot()).rejects.toMatchObject({ status: 401 })
    expect(calls).toHaveLength(0)
  })

  it('失敗は、サーバーの日本語の理由と番号つきの XAutopilotError', async () => {
    reply(502, { error: 'X APIのクレジットが足りません（402）' })
    const error = await readAutopilotHistory().catch((e) => e)
    expect(error).toBeInstanceOf(XAutopilotError)
    expect(error.message).toContain('クレジットが足りません')
    expect(error.status).toBe(502)
    expect(error.setup).toBe(false)
  })

  it('保存先の表（SQL 007）が無いときは setup の印がつく', async () => {
    reply(503, { error: '準備がまだです', setup: true })
    const error = await fetchAutopilot().catch((e) => e)
    expect(error.setup).toBe(true)
  })

  it('受け口が無い版（HTML が返る）は、予期しない応答として伝える', async () => {
    reply(200, '<!doctype html><html></html>')
    await expect(fetchAutopilot()).rejects.toThrow('予期しない応答')
  })
})

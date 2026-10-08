// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { PauseNotReadyError, supabaseAutopostStore } from './autopostStore.js'

// Supabase（PostgREST）に実際に送る要求の形を確かめる。
// 「版が見ていたものと同じときだけ書き換える」「状態の報告は文の列に触らない」は、
// この要求の形（絞り込みと送る列）で決まる。手元には本物のデータベースが無いので、
// 返事は偽物にして、送った中身だけを見る。

interface Sent {
  method: string
  url: URL
  body: unknown
  prefer: string | null
}

type Reply = { status: number; body: unknown }

// 止めているかは別の表（autopost_pause）。既定では「その行は無い（＝止めていない）」と返す。
const NO_PAUSE_ROW = () => ({ status: 200, body: null })
const isPauseRequest = (sent: Sent) => sent.url.pathname === '/rest/v1/autopost_pause'

function fakeStore(respond: (sent: Sent) => Reply, respondPause: (sent: Sent) => Reply = NO_PAUSE_ROW) {
  const sent: Sent[] = []
  const fetchStub: typeof fetch = async (input, init) => {
    const request = new Request(input, init)
    const raw = request.method === 'GET' ? '' : await request.text()
    const entry: Sent = {
      method: request.method,
      url: new URL(request.url),
      body: raw ? JSON.parse(raw) : undefined,
      prefer: request.headers.get('prefer'),
    }
    sent.push(entry)
    const reply = isPauseRequest(entry) ? respondPause(entry) : respond(entry)
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'content-type': 'application/json' },
    })
  }
  const client = createClient('http://supabase.test', 'service-key', {
    auth: { persistSession: false },
    global: { fetch: fetchStub },
  })
  return { store: supabaseAutopostStore(client), sent }
}

/** 文の表（autopost_channels）への要求だけ。止める表の読み取りは別に数える。 */
const channelRequests = (sent: Sent[]) => sent.filter((s) => s.url.pathname === '/rest/v1/autopost_channels')

const ROW = {
  channel: 'discord',
  messages: ['新しい文'],
  archive: ['古い文'],
  version: 4,
  saved_at: '2026-10-07T12:00:00+00:00',
  status: null,
}

describe('supabaseAutopostStore の送る要求', () => {
  it('保存は「見ていた版のときだけ」書き換え、版を1つ進める', async () => {
    const { store, sent } = fakeStore(() => ({ status: 200, body: [ROW] }))
    const saved = await store.saveText('u1', 'discord', { messages: ['新しい文'], archive: ['古い文'] }, 3)

    expect(saved).toMatchObject({ version: 4, messages: ['新しい文'], archive: ['古い文'] })
    expect(channelRequests(sent)).toHaveLength(1)
    const [req] = channelRequests(sent)
    expect(req.method).toBe('PATCH')
    expect(req.url.pathname).toBe('/rest/v1/autopost_channels')
    expect(req.url.searchParams.get('user_id')).toBe('eq.u1')
    expect(req.url.searchParams.get('channel')).toBe('eq.discord')
    expect(req.url.searchParams.get('version')).toBe('eq.3')
    expect(req.body).toMatchObject({ version: 4, messages: ['新しい文'], archive: ['古い文'] })
  })

  it('版が進んでいて0行しか更新できなかったら、作り直さず null（取り合いに負けた）', async () => {
    const { store, sent } = fakeStore(() => ({ status: 200, body: [] }))
    expect(await store.saveText('u1', 'discord', { messages: ['a'], archive: [] }, 3)).toBeNull()
    expect(sent).toHaveLength(1) // 版が0でなければ、新しい行を作りにいかない
  })

  it('最初の保存（版0）は、更新で0行なら行を作る。先に作られていたら null', async () => {
    const created = fakeStore((sent) =>
      sent.method === 'PATCH' ? { status: 200, body: [] } : { status: 201, body: { ...ROW, version: 1 } }
    )
    const saved = await created.store.saveText('u1', 'discord', { messages: ['a'], archive: [] }, 0)
    expect(saved?.version).toBe(1)
    expect(channelRequests(created.sent).map((s) => s.method)).toEqual(['PATCH', 'POST'])
    expect(channelRequests(created.sent)[1].body).toMatchObject({ user_id: 'u1', channel: 'discord', version: 1 })

    const raced = fakeStore((sent) =>
      sent.method === 'PATCH'
        ? { status: 200, body: [] }
        : { status: 409, body: { code: '23505', message: 'duplicate key value', details: '', hint: '' } }
    )
    expect(await raced.store.saveText('u1', 'discord', { messages: ['a'], archive: [] }, 0)).toBeNull()
  })

  it('状態の報告は status の列だけを送る（文・履歴・版を上書きしない）', async () => {
    const { store, sent } = fakeStore(() => ({ status: 201, body: null }))
    const status = { lastPost: { t: '2026-10-07T12:25:00.000Z', text: 'a' }, today: 3, at: '2026-10-07T12:30:00.000Z' }
    await store.writeStatus('u1', 'yay', status)

    const [req] = sent
    expect(req.method).toBe('POST')
    expect(req.url.searchParams.get('on_conflict')).toBe('user_id,channel')
    expect(req.prefer).toContain('resolution=merge-duplicates')
    expect(Object.keys(req.body as object).sort()).toEqual(['channel', 'status', 'user_id'])
  })

  it('行が無い投稿先は、版0・文なしで返す', async () => {
    const { store } = fakeStore(() => ({ status: 200, body: null }))
    // maybeSingle は 0 行のとき null を返す
    expect(await store.getChannel('u1', 'yay')).toEqual({
      channel: 'yay',
      messages: [],
      archive: [],
      version: 0,
      savedAt: null,
      status: null,
      paused: false,
      pausedAt: null,
      pauseReady: true,
    })
  })

  it('合鍵は sha256 の値で引く', async () => {
    const { store, sent } = fakeStore(() => ({ status: 200, body: { user_id: 'u1' } }))
    expect(await store.userIdForPosterKey('abc123')).toBe('u1')
    expect(sent[0].url.pathname).toBe('/rest/v1/autopost_poster_keys')
    expect(sent[0].url.searchParams.get('token_hash')).toBe('eq.abc123')
  })
  describe('止める印（autopost_pause）', () => {
    const MISSING = { status: 404, body: { code: 'PGRST205', message: "Could not find the table 'public.autopost_pause' in the schema cache", details: null, hint: null } }
    const channelRow = () => ({ status: 200, body: ROW })

    it('文と一緒に、止めているかも読む（持ち主と投稿先で引く）', async () => {
      const { store, sent } = fakeStore(channelRow, () => ({
        status: 200,
        body: { paused: true, paused_at: '2026-10-07T12:10:00+00:00' },
      }))
      const row = await store.getChannel('u1', 'discord')

      expect(row).toMatchObject({ messages: ['新しい文'], paused: true, pausedAt: '2026-10-07T12:10:00+00:00', pauseReady: true })
      const pause = sent.find(isPauseRequest)
      expect(pause?.method).toBe('GET')
      expect(pause?.url.searchParams.get('user_id')).toBe('eq.u1')
      expect(pause?.url.searchParams.get('channel')).toBe('eq.discord')
    })

    it('止める表がまだ無くても、文は読める（止めていない・pauseReady: false）', async () => {
      const { store } = fakeStore(channelRow, () => MISSING)
      expect(await store.getChannel('u1', 'discord')).toMatchObject({
        messages: ['新しい文'],
        paused: false,
        pausedAt: null,
        pauseReady: false,
      })
    })

    it('Postgres 本体の「表が無い」(42P01) でも同じ扱いにする', async () => {
      const { store } = fakeStore(channelRow, () => ({
        status: 404,
        body: { code: '42P01', message: 'relation "public.autopost_pause" does not exist', details: null, hint: null },
      }))
      expect((await store.getChannel('u1', 'discord')).pauseReady).toBe(false)
    })

    it('表が無いのではなく読めなかったときは、止めていないことにせず失敗にする', async () => {
      // 止めたはずの投稿役が、読み取りの失敗を「止めていない」と受け取って投稿を再開してしまうのを防ぐ。
      const { store } = fakeStore(channelRow, () => ({
        status: 500,
        body: { code: 'XX000', message: 'connection reset', details: null, hint: null },
      }))
      await expect(store.getChannel('u1', 'discord')).rejects.toThrow('autopost_pause の読み込みに失敗しました')
    })

    it('止めるときは paused と止めた時刻だけを、持ち主・投稿先ごとの1行に書く', async () => {
      const { store, sent } = fakeStore(channelRow, (s) =>
        s.method === 'POST' ? { status: 201, body: null } : { status: 200, body: null }
      )
      await store.setPaused('u1', 'yay', true)

      const write = sent.find((s) => isPauseRequest(s) && s.method === 'POST')
      expect(write?.url.searchParams.get('on_conflict')).toBe('user_id,channel')
      expect(write?.prefer).toContain('resolution=merge-duplicates')
      expect(write?.body).toMatchObject({ user_id: 'u1', channel: 'yay', paused: true })
      expect(typeof (write?.body as { paused_at?: unknown } | undefined)?.paused_at).toBe('string')
      // 文の表には何も書かない（止めても、書きかけの文の取り合いに関わらない）
      expect(channelRequests(sent).every((s) => s.method === 'GET')).toBe(true)
    })

    it('再開するときは止めた時刻を消す', async () => {
      const { store, sent } = fakeStore(channelRow, (s) =>
        s.method === 'POST' ? { status: 201, body: null } : { status: 200, body: { paused: true, paused_at: '2026-10-07T12:10:00+00:00' } }
      )
      await store.setPaused('u1', 'discord', false)
      const write = sent.find((s) => isPauseRequest(s) && s.method === 'POST')
      expect(write?.body).toMatchObject({ paused: false, paused_at: null })
    })

    it('すでにその状態なら書き換えない（押し直しで止めた時刻を更新しない）', async () => {
      const { store, sent } = fakeStore(channelRow, () => ({
        status: 200,
        body: { paused: true, paused_at: '2026-10-07T12:10:00+00:00' },
      }))
      await store.setPaused('u1', 'discord', true)
      expect(sent.some((s) => isPauseRequest(s) && s.method === 'POST')).toBe(false)
    })

    it('止める表が無ければ、止める・再開するは PauseNotReadyError', async () => {
      const { store, sent } = fakeStore(channelRow, () => MISSING)
      await expect(store.setPaused('u1', 'discord', true)).rejects.toBeInstanceOf(PauseNotReadyError)
      expect(sent.some((s) => s.method === 'POST')).toBe(false)
    })
  })
})

// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { supabaseAutopostStore } from './_lib/autopostStore.js'

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

function fakeStore(respond: (sent: Sent) => { status: number; body: unknown }) {
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
    const reply = respond(entry)
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
    expect(sent).toHaveLength(1)
    const [req] = sent
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
    expect(created.sent.map((s) => s.method)).toEqual(['PATCH', 'POST'])
    expect(created.sent[1].body).toMatchObject({ user_id: 'u1', channel: 'discord', version: 1 })

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
    })
  })

  it('合鍵は sha256 の値で引く', async () => {
    const { store, sent } = fakeStore(() => ({ status: 200, body: { user_id: 'u1' } }))
    expect(await store.userIdForPosterKey('abc123')).toBe('u1')
    expect(sent[0].url.pathname).toBe('/rest/v1/autopost_poster_keys')
    expect(sent[0].url.searchParams.get('token_hash')).toBe('eq.abc123')
  })
})

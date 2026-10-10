// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { AutopilotNotReadyError, supabaseAutopilotStore } from './autopilotStore.js'

// Supabase に実際に送る要求の形を確かめる。手元には本物のデータベースが無いので、返事は偽物にして、送った中身を見る。
//   ・設定の保存は「渡した列だけ」を送る（履歴や文体のまとめを上書きしない）
//   ・予約への追加は、自動運転の印（ai_prompt）つき。同じ枠が先にあれば 'duplicate'
//   ・取り消しは「自分の・自動運転の・まだ出ていない」予約だけ
//   ・表（SQL 007）が無いときは、予約の投稿そのものを巻き込まない

interface Sent {
  method: string
  url: URL
  body: any
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
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } })
  }
  const client = createClient('http://supabase.test', 'service-key', {
    auth: { persistSession: false },
    global: { fetch: fetchStub },
  })
  return { store: supabaseAutopilotStore(client), sent }
}

const MISSING = {
  status: 404,
  body: { code: 'PGRST205', message: "Could not find the table 'public.x_autopilot' in the schema cache", details: null, hint: null },
}

const DB_ROW = {
  user_id: 'u1',
  enabled: true,
  settings: { postsPerDay: 99, quality: 'saver' },
  history: [{ id: '1', text: '過去の投稿です', at: '2026-10-01T00:00:00.000Z', likes: 2, reposts: 0 }],
  history_fetched_at: '2026-10-09T00:00:00+00:00',
  profile: null,
  profile_built_at: null,
  slots: ['2026-10-10#0'],
  usage: { month: '2026-10', yen: 12.5, posts: 1, generations: 2 },
  last_error: null,
}

describe('autopilot store が送る要求', () => {
  it('設定を読む: 範囲外の値は使える範囲に直し、足りない項目は既定で補う', async () => {
    const { store, sent } = fakeStore(() => ({ status: 200, body: DB_ROW }))
    const row = await store.get('u1')
    expect(sent[0].url.pathname).toBe('/rest/v1/x_autopilot')
    expect(sent[0].url.searchParams.get('user_id')).toBe('eq.u1')
    expect(row.settings.postsPerDay).toBe(8) // 99 → 上限
    expect(row.settings.quality).toBe('saver')
    expect(row.settings.windowStart).toBe('08:00') // 無い項目は既定
    expect(row.slots).toEqual(['2026-10-10#0'])
    expect(row.usage).toMatchObject({ month: '2026-10', yen: 12.5 })
  })

  it('まだ何も保存していない人は、既定の設定の空の状態', async () => {
    const { store } = fakeStore(() => ({ status: 200, body: null }))
    const row = await store.get('u9')
    expect(row).toMatchObject({ userId: 'u9', enabled: false, history: [], profile: null, slots: [] })
    expect(row.settings.postsPerDay).toBe(3)
  })

  it('表（SQL 007）が無ければ AutopilotNotReadyError（他の機能は巻き込まない）', async () => {
    const { store } = fakeStore(() => MISSING)
    await expect(store.get('u1')).rejects.toBeInstanceOf(AutopilotNotReadyError)
    await expect(store.save('u1', { enabled: true })).rejects.toBeInstanceOf(AutopilotNotReadyError)
    // 毎分の補充は、表が無くてもエラーにせず「対象なし」。予約の投稿（同じ関数）を止めない。
    expect(await store.listEnabled(20)).toEqual([])
  })

  it('読めなかった（表が無いのではない）ときは、失敗として投げる', async () => {
    const { store } = fakeStore(() => ({ status: 500, body: { code: 'XX000', message: 'connection reset', details: null, hint: null } }))
    await expect(store.get('u1')).rejects.toThrow('x_autopilot の読み込みに失敗しました')
    await expect(store.listEnabled(20)).rejects.toThrow()
  })

  it('保存は、渡した項目の列だけを送る（ほかの列を上書きしない）', async () => {
    const { store, sent } = fakeStore(() => ({ status: 201, body: null }))
    await store.save('u1', { enabled: true, lastError: null })
    const req = sent[0]
    expect(req.method).toBe('POST')
    expect(req.url.searchParams.get('on_conflict')).toBe('user_id')
    expect(req.prefer).toContain('resolution=merge-duplicates')
    expect(Object.keys(req.body).sort()).toEqual(['enabled', 'last_error', 'updated_at', 'user_id'])
    expect(req.body).not.toHaveProperty('history')
    expect(req.body).not.toHaveProperty('profile')
  })

  it('ON の人だけを探す', async () => {
    const { store, sent } = fakeStore(() => ({ status: 200, body: [DB_ROW] }))
    const rows = await store.listEnabled(20)
    expect(rows).toHaveLength(1)
    expect(sent[0].url.searchParams.get('enabled')).toBe('eq.true')
    expect(sent[0].url.searchParams.get('limit')).toBe('20')
  })

  it('予約に入れるとき: 自動運転の印つきの scheduled。同じ枠が先にあれば duplicate', async () => {
    const ok = fakeStore(() => ({ status: 201, body: null }))
    expect(await ok.store.insertPost({ userId: 'u1', at: '2026-10-10T09:00:00.000Z', text: '本文です', slotKey: '2026-10-10#1' })).toBe('inserted')
    const body = ok.sent[0].body
    expect(ok.sent[0].url.pathname).toBe('/rest/v1/scheduled_posts')
    expect(body).toMatchObject({
      user_id: 'u1',
      status: 'scheduled',
      scheduled_at: '2026-10-10T09:00:00.000Z',
      segments: [{ text: '本文です', media: [] }],
      ai_prompt: 'autopilot:2026-10-10#1',
    })

    const dup = fakeStore(() => ({ status: 409, body: { code: '23505', message: 'duplicate key', details: '', hint: '' } }))
    expect(await dup.store.insertPost({ userId: 'u1', at: '2026-10-10T09:00:00.000Z', text: 'x', slotKey: '2026-10-10#1' })).toBe('duplicate')

    const broken = fakeStore(() => ({ status: 500, body: { code: 'XX000', message: 'boom', details: '', hint: '' } }))
    await expect(broken.store.insertPost({ userId: 'u1', at: 'x', text: 'x', slotKey: 'k' })).rejects.toThrow('予約への追加に失敗しました')
  })

  it('最近の本文: 自分の・自動運転の・予約中か投稿済みのものを、新しい順に', async () => {
    const { store, sent } = fakeStore(() => ({
      status: 200,
      body: [
        { segments: [{ text: '新しいほう' }], scheduled_at: '2026-10-10T09:00:00Z' },
        { segments: [{ text: '' }], scheduled_at: '2026-10-09T09:00:00Z' },
      ],
    }))
    const rows = await store.recentTexts('u1', 15)
    expect(rows).toEqual([{ text: '新しいほう', at: '2026-10-10T09:00:00Z' }])
    const q = sent[0].url.searchParams
    expect(q.get('user_id')).toBe('eq.u1')
    expect(q.get('ai_prompt')).toBe('like.autopilot:%')
    expect(q.get('status')).toBe('in.(scheduled,publishing,posted)')
    expect(q.get('order')).toBe('scheduled_at.desc')
    expect(q.get('limit')).toBe('15')
  })

  it('生きている枠: 自分の・自動運転の・予約中か投稿済みのものの印を、昨日以降ぶんだけ', async () => {
    const { store, sent } = fakeStore(() => ({
      status: 200,
      body: [{ ai_prompt: 'autopilot:2026-10-10#0' }, { ai_prompt: 'autopilot:2026-10-10#1' }],
    }))
    expect(await store.activeSlotKeys('u1', '2026-10-09')).toEqual(['2026-10-10#0', '2026-10-10#1'])
    const q = sent[0].url.searchParams
    expect(q.get('user_id')).toBe('eq.u1')
    expect(q.get('status')).toBe('in.(scheduled,publishing,posted)')
    expect(q.getAll('ai_prompt')).toEqual(['like.autopilot:%', 'gte.autopilot:2026-10-09'])
  })

  it('生きている枠が読めなくても止めない（空で返し、重複は予約への追加で弾く）', async () => {
    const { store } = fakeStore(() => ({ status: 500, body: { code: 'XX000', message: 'boom', details: '', hint: '' } }))
    expect(await store.activeSlotKeys('u1', '2026-10-09')).toEqual([])
  })

  it('取り消し: 自分の・自動運転の・まだ出ていない予約だけ（出た分や普通の予約は触らない）', async () => {
    const { store, sent } = fakeStore(() => ({ status: 200, body: [{ id: 'a' }, { id: 'b' }] }))
    expect(await store.cancelUpcoming('u1')).toBe(2)
    const req = sent[0]
    expect(req.method).toBe('PATCH')
    expect(req.url.searchParams.get('user_id')).toBe('eq.u1')
    expect(req.url.searchParams.get('ai_prompt')).toBe('like.autopilot:%')
    expect(req.url.searchParams.get('status')).toBe('eq.scheduled')
    expect(req.body.status).toBe('canceled')
  })

  it('連携中の X アカウントは、トークンを読まずに番号と名前だけ', async () => {
    const { store, sent } = fakeStore(() => ({ status: 200, body: { x_user_id: '555', username: 'me' } }))
    expect(await store.xAccount('u1')).toEqual({ xUserId: '555', username: 'me' })
    expect(sent[0].url.searchParams.get('select')).toBe('x_user_id,username')
  })
})

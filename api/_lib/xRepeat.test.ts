import { describe, expect, it } from 'vitest'
import type { PosterStatus } from './autopostDoc.js'
import { emptyChannel, type ChannelRow } from './autopostStore.js'
import { XApiError } from './xClient.js'
import { dayInJapan, describeXFailure, isDue, pickIndex, runOne, runXRepeats, type XRepeatDeps } from './xRepeat.js'

const NOW = new Date('2026-11-25T12:00:00.000Z') // 日本時間 21:00
const minutesBefore = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString()

function row(patch: Partial<ChannelRow> = {}): ChannelRow {
  return {
    ...emptyChannel('xrepeat'),
    messages: ['一つ目の文', '二つ目の文'],
    hours: [null, null],
    version: 1,
    settings: { intervalMinutes: 60 },
    ...patch,
  }
}

/** X とのやり取りを手元で真似る。posted / removed に何をしたかが残る。 */
function fakeDeps(rows: { userId: string; row: ChannelRow }[] = []) {
  const saved = new Map<string, PosterStatus>()
  for (const r of rows) if (r.row.status) saved.set(r.userId, r.row.status)
  const calls = { posted: [] as string[], removed: [] as string[], writes: 0 }
  let nextId = 100
  const deps: XRepeatDeps & { failPost?: unknown; failRemove?: unknown } = {
    list: async () => rows,
    async write(userId, status, expectTriedAt) {
      calls.writes += 1
      if (expectTriedAt !== undefined && (saved.get(userId)?.triedAt ?? null) !== expectTriedAt) return false
      saved.set(userId, structuredClone(status))
      return true
    },
    token: async () => 'token',
    async post(_token, text) {
      if (deps.failPost) throw deps.failPost
      calls.posted.push(text)
      return String(nextId++)
    },
    async remove(_token, id) {
      if (deps.failRemove) throw deps.failRemove
      calls.removed.push(id)
    },
  }
  return { deps, saved, calls }
}

describe('X のくり返し投稿（1人ぶん）', () => {
  it('初めては、すぐ1つ目の文を出し、次に消す番号・次の文・今日の件数を控える', async () => {
    const { deps, saved, calls } = fakeDeps()
    expect(await runOne(deps, 'u1', row(), NOW)).toBe('posted')
    expect(calls.posted).toEqual(['一つ目の文'])
    expect(calls.removed).toEqual([])
    expect(saved.get('u1')).toMatchObject({
      server: true,
      lastId: '100',
      nextIndex: 1,
      today: 1,
      day: '2026-11-25',
      problem: null,
      lastPost: { t: NOW.toISOString(), text: '一つ目の文' },
      triedAt: NOW.toISOString(),
    })
  })

  it('間隔が来たら、前の投稿を消してから次の文を出す（文は順に回る）', async () => {
    const status: PosterStatus = {
      lastPost: { t: minutesBefore(60), text: '一つ目の文' },
      today: 3,
      at: minutesBefore(60),
      server: true,
      lastId: '55',
      nextIndex: 1,
      day: '2026-11-25',
      triedAt: minutesBefore(60),
      problem: null,
    }
    const { deps, saved, calls } = fakeDeps([{ userId: 'u1', row: row({ status }) }])
    expect(await runOne(deps, 'u1', row({ status }), NOW)).toBe('posted')
    expect(calls.removed).toEqual(['55'])
    expect(calls.posted).toEqual(['二つ目の文'])
    expect(saved.get('u1')).toMatchObject({ lastId: '100', nextIndex: 2, today: 4 })
  })

  it('間隔が来ていなければ何もしない（書きもしない）', async () => {
    const status: PosterStatus = { lastPost: null, today: 1, at: minutesBefore(30), server: true, triedAt: minutesBefore(30), day: '2026-11-25' }
    const { deps, calls } = fakeDeps([{ userId: 'u1', row: row({ status }) }])
    expect(await runOne(deps, 'u1', row({ status }), NOW)).toBe('waiting')
    expect(calls.posted).toEqual([])
    expect(calls.writes).toBe(0)
  })

  it('日が変わったら、今日の件数を0から数え直す', async () => {
    const status: PosterStatus = { lastPost: null, today: 24, at: minutesBefore(90), server: true, triedAt: minutesBefore(90), day: '2026-11-24' }
    const { deps, saved } = fakeDeps([{ userId: 'u1', row: row({ status }) }])
    await runOne(deps, 'u1', row({ status }), NOW)
    expect(saved.get('u1')?.today).toBe(1)
  })

  it('止めているあいだは出さず、受け取ったことを1回だけ知らせる（画面の「依頼中」を消すため）', async () => {
    const { deps, saved, calls } = fakeDeps()
    expect(await runOne(deps, 'u1', row({ paused: true }), NOW)).toBe('paused')
    expect(saved.get('u1')?.paused).toBe(true)
    expect(calls.posted).toEqual([])
    const writes = calls.writes
    await runOne(deps, 'u1', row({ paused: true, status: saved.get('u1')! }), NOW)
    expect(calls.writes).toBe(writes) // 2回目は書かない（毎分書くと通信量がかさむ）
  })

  it('時間帯の外（使える文が無い）は出さない', async () => {
    const { deps, calls } = fakeDeps()
    // 21時は、朝7〜9時の文しか無いので休み
    expect(await runOne(deps, 'u1', row({ messages: ['朝の文'], hours: [[7, 8, 9]] }), NOW)).toBe('idle')
    expect(calls.posted).toEqual([])
  })

  it('失敗したら理由を status に残し、続けて失敗すると回数を数える。次は15分後にやり直す', async () => {
    const { deps, saved } = fakeDeps()
    deps.failPost = new XApiError('投稿に失敗しました (403): {"detail":"You are not allowed to create a Tweet with duplicate content."}', 403, false)
    expect(await runOne(deps, 'u1', row(), NOW)).toBe('failed')
    const first = saved.get('u1')!
    expect(first.problem).toMatchObject({ count: 1, stopped: false, since: NOW.toISOString() })
    expect(first.problem?.message).toMatch(/^同じ文が続いたため/)
    expect(isDue(first, 60, new Date(NOW.getTime() + 14 * 60_000))).toBe(false)
    expect(isDue(first, 60, new Date(NOW.getTime() + 15 * 60_000))).toBe(true)

    const later = new Date(NOW.getTime() + 15 * 60_000)
    await runOne(deps, 'u1', row({ status: first }), later)
    expect(saved.get('u1')?.problem).toMatchObject({ count: 2, since: NOW.toISOString() })

    deps.failPost = undefined
    await runOne(deps, 'u1', row({ status: saved.get('u1')! }), new Date(later.getTime() + 15 * 60_000))
    expect(saved.get('u1')?.problem).toBeNull() // 出せたら消える
  })

  it('前の投稿を消せなかったら、新しくは出さない（同じ文が2つ並ばないように）', async () => {
    const status: PosterStatus = { lastPost: null, today: 1, at: minutesBefore(60), server: true, lastId: '55', triedAt: minutesBefore(60), day: '2026-11-25' }
    const { deps, saved, calls } = fakeDeps([{ userId: 'u1', row: row({ status }) }])
    deps.failRemove = new XApiError('投稿の削除に失敗しました (503)', 503, true)
    expect(await runOne(deps, 'u1', row({ status }), NOW)).toBe('failed')
    expect(calls.posted).toEqual([])
    expect(saved.get('u1')?.lastId).toBe('55') // 次に、また消しに行く
  })

  it('毎分の実行が重なっても、同じ回を2回出さない（先に印を置いたほうだけが出す）', async () => {
    const status: PosterStatus = { lastPost: null, today: 0, at: minutesBefore(60), server: true, triedAt: minutesBefore(60), day: '2026-11-25' }
    const { deps, calls } = fakeDeps([{ userId: 'u1', row: row({ status }) }])
    const [a, b] = await Promise.all([runOne(deps, 'u1', row({ status }), NOW), runOne(deps, 'u1', row({ status }), NOW)])
    expect([a, b].sort()).toEqual(['posted', 'skipped'])
    expect(calls.posted).toHaveLength(1)
  })

  it('全員ぶん回し、1人の失敗でほかの人を止めない', async () => {
    const { deps, calls } = fakeDeps([
      { userId: 'u1', row: row() },
      { userId: 'u2', row: row({ messages: ['別の人の文'], hours: [null] }) },
    ])
    const originalToken = deps.token
    deps.token = async (userId) => {
      if (userId === 'u1') throw new XApiError('Xアカウントが連携されていません', 400, false)
      return originalToken(userId)
    }
    expect(await runXRepeats(deps, NOW)).toEqual({ posted: 1, failed: 1 })
    expect(calls.posted).toEqual(['別の人の文'])
  })
})

describe('小さな決まり', () => {
  it('日本時間の日付で数える（日本の0時をまたいだら翌日）', () => {
    expect(dayInJapan(new Date('2026-11-25T14:59:00.000Z'))).toBe('2026-11-25')
    expect(dayInJapan(new Date('2026-11-25T15:00:00.000Z'))).toBe('2026-11-26')
  })

  it('いま使える文の中で、順番どおりに次を選ぶ（最後まで行ったら先頭へ）', () => {
    expect(pickIndex([0, 1, 2], 1)).toBe(1)
    expect(pickIndex([0, 2], 1)).toBe(2)
    expect(pickIndex([0, 1], 5)).toBe(0)
  })

  it('X の失敗を、次にやることが分かる言い方にする', () => {
    expect(describeXFailure(new XApiError('x', 401, false))).toMatch(/連携が切れています/)
    expect(describeXFailure(new XApiError('x', 429, true))).toMatch(/回数制限/)
    expect(describeXFailure(new XApiError('Xアカウントが連携されていません', 400, false))).toMatch(/^X と連携していません/)
    expect(describeXFailure(new Error('a\n b'))).toBe('a b')
  })
})

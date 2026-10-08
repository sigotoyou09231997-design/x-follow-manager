import { describe, expect, it } from 'vitest'
import type { ChannelSnapshot, Snapshots } from '../autopost/api'
import type { ScheduledPost } from '../schedule/types'
import { buildFeed, buildStories, whenLabel, type ActivityInput } from './activity'

const NOW = new Date('2026-10-07T13:00:00.000Z').getTime()
const ago = (m: number) => new Date(NOW - m * 60000).toISOString()
const later = (m: number) => new Date(NOW + m * 60000).toISOString()

function channel(name: 'discord' | 'yay', patch: Partial<ChannelSnapshot> = {}): ChannelSnapshot {
  return {
    channel: name,
    messages: ['文'],
    archive: [],
    version: 1,
    savedAt: null,
    status: null,
    paused: false,
    pausedAt: null,
    pauseReady: true,
    limits: { maxLength: 1000, maxMessages: name === 'yay' ? 1 : 10 },
    ...patch,
  }
}

function autopost(patch: Partial<Snapshots> = {}): Snapshots {
  return { discord: channel('discord'), yay: channel('yay'), ...patch }
}

function post(id: string, patch: Partial<ScheduledPost> = {}): ScheduledPost {
  return {
    id,
    userId: 'u',
    status: 'scheduled',
    scheduledAt: later(60),
    segments: [{ text: `本文 ${id}`, media: [] }],
    attemptCount: 0,
    createdAt: ago(600),
    updatedAt: ago(10),
    ...patch,
  }
}

const base = (patch: Partial<ActivityInput> = {}): ActivityInput => ({
  now: NOW,
  tidy: { hasData: false, pending: 0 },
  ...patch,
})

describe('丸いアイコン（stories）', () => {
  it('Mac が動いていれば緑（今日の件数）、20分以上報告が無ければ赤、報告が無ければ中立', () => {
    const alive = { lastPost: null, today: 134, at: ago(1) }
    const silent = { lastPost: null, today: 311, at: ago(40) }
    const [discord, yay] = buildStories(base({ autopost: autopost({ discord: channel('discord', { status: alive }), yay: channel('yay', { status: silent }) }) }), NOW)
    expect(discord).toMatchObject({ id: 'discord', tone: 'ok', meta: '今日134件' })
    expect(yay).toMatchObject({ id: 'yay', tone: 'off', meta: '応答なし' })

    const [none] = buildStories(base(), NOW)
    expect(none).toMatchObject({ tone: 'idle', meta: '報告なし' })
  })

  it('止めているときは、動いているかより「止めていること」を先に見せる（橙）', () => {
    const alive = { lastPost: null, today: 134, at: ago(1) }
    const paused = { ...alive, paused: true }
    const stories = (patch: Partial<ChannelSnapshot>) =>
      buildStories(base({ autopost: autopost({ discord: channel('discord', patch) }) }), NOW)[0]

    // Mac も止まっている
    expect(stories({ paused: true, status: paused })).toMatchObject({ meta: '停止中', tone: 'warn' })
    // 止めると押したが、Mac はまだ受け取っていない
    expect(stories({ paused: true, status: alive })).toMatchObject({ meta: '停止を依頼中', tone: 'warn' })
    // 再開すると押したが、Mac はまだ止まっている
    expect(stories({ paused: false, status: paused })).toMatchObject({ meta: '再開待ち', tone: 'idle' })
  })

  it('止めているのは、その投稿先だけ', () => {
    const [discord, yay] = buildStories(
      base({ autopost: autopost({ yay: channel('yay', { paused: true }) }) }),
      NOW
    )
    expect(discord.meta).toBe('報告なし')
    expect(yay).toMatchObject({ id: 'yay', meta: '停止を依頼中' })
  })

  it('X予約は、失敗があれば注意、予約があれば件数、なければ「予約なし」。繰り返しのテンプレートは数えない', () => {
    const tone = (posts: ScheduledPost[]) => buildStories(base({ posts }), NOW).find((s) => s.id === 'schedule')
    expect(tone([])).toMatchObject({ tone: 'idle', meta: '予約なし' })
    expect(tone([post('a'), post('b')])).toMatchObject({ tone: 'ok', meta: '予約2件' })
    expect(tone([post('a'), post('f', { status: 'failed' })])).toMatchObject({ tone: 'warn', meta: '失敗1件' })
    const template = post('t', { repeatRule: { freq: 'daily', interval: 1, time: '08:00', timeZone: 'Asia/Tokyo' } })
    expect(tone([template])).toMatchObject({ meta: '予約なし' })
  })

  it('フォロー整理は、読み込み済みなら未確認の人数、まだなら「未読込」', () => {
    const tidy = (hasData: boolean, pending: number) =>
      buildStories(base({ tidy: { hasData, pending } }), NOW).find((s) => s.id === 'tidy')
    expect(tidy(false, 0)).toMatchObject({ meta: '未読込' })
    expect(tidy(true, 1234)).toMatchObject({ meta: '未確認1,234人' })
  })

  it('押すと、それぞれの画面（自動投稿は投稿先つき）を開く', () => {
    const stories = buildStories(base(), NOW)
    expect(stories.map((s) => s.target)).toEqual([
      { tab: 'autopost', channel: 'discord' },
      { tab: 'autopost', channel: 'yay' },
      { tab: 'schedule' },
      { tab: 'tidy' },
    ])
  })
})

describe('動きの一覧（feed）', () => {
  it('失敗 → これから（近い順） → 済んだこと（新しい順）の順に並べる', () => {
    const feed = buildFeed(
      base({
        autopost: autopost({
          discord: channel('discord', { status: { lastPost: { t: ago(4), text: 'ディスコードの文' }, today: 5, at: ago(1) } }),
          yay: channel('yay', { status: { lastPost: { t: ago(2), text: 'Yayの文' }, today: 9, at: ago(1) } }),
        }),
        posts: [
          post('late', { scheduledAt: later(300) }),
          post('soon', { scheduledAt: later(30) }),
          post('done', { status: 'posted', updatedAt: ago(3) }),
          post('bad', { status: 'failed', errorMessage: 'X の上限に達しました', updatedAt: ago(20) }),
        ],
      })
    )
    expect(feed.map((f) => f.id)).toEqual([
      'x-failed-bad',
      'x-scheduled-soon',
      'x-scheduled-late',
      'autopost-yay', // 2分前
      'x-posted-done', // 3分前
      'autopost-discord', // 4分前
    ])
    expect(feed[0]).toMatchObject({ kind: 'failed', foot: ['X の上限に達しました'] })
    expect(feed.find((f) => f.id === 'autopost-yay')).toMatchObject({ service: 'yay', serviceLabel: 'Yay', body: 'Yayの文', foot: ['今日9件'] })
  })

  it('件数は limit まで。失敗は、ほかを押しのけて先頭に残る', () => {
    const posts = [
      post('bad', { status: 'failed', updatedAt: ago(1) }),
      ...Array.from({ length: 5 }, (_, i) => post(`p${i}`, { status: 'posted', updatedAt: ago(10 + i) })),
    ]
    const feed = buildFeed(base({ posts }), 3)
    expect(feed).toHaveLength(3)
    expect(feed[0].id).toBe('x-failed-bad')
  })

  it('繰り返しのテンプレートと、下書き・取り消しは出さない', () => {
    const feed = buildFeed(
      base({
        posts: [
          post('t', { repeatRule: { freq: 'daily', interval: 1, time: '08:00', timeZone: 'Asia/Tokyo' } }),
          post('d', { status: 'draft' }),
          post('c', { status: 'canceled' }),
        ],
      })
    )
    expect(feed).toEqual([])
  })

  it('投稿の報告がまだ無い自動投稿は出さない。本文の改行は1行にする', () => {
    expect(buildFeed(base({ autopost: autopost() }))).toEqual([])
    const [item] = buildFeed(base({ posts: [post('a', { segments: [{ text: '一行目\n\n二行目  です', media: [] }] })] }))
    expect(item.body).toBe('一行目 二行目 です')
  })

  it('スレッドは件数を添える', () => {
    const [item] = buildFeed(base({ posts: [post('a', { segments: [{ text: '1', media: [] }, { text: '2', media: [] }] })] }))
    expect(item.foot).toEqual(['予約中', 'スレッド2件'])
  })
})

describe('時刻の言い方', () => {
  it('過去は「◯分前・◯時間前・◯日前」', () => {
    expect(whenLabel(ago(0), NOW)).toBe('たった今')
    expect(whenLabel(ago(4), NOW)).toBe('4分前')
    expect(whenLabel(ago(125), NOW)).toBe('2時間前')
    expect(whenLabel(ago(60 * 24 * 3 + 5), NOW)).toBe('3日前')
  })

  it('これからは日付と時刻', () => {
    expect(whenLabel(later(90), NOW)).toMatch(/\d+\/\d+\(.\)\s*\d+:\d{2}/)
  })
})

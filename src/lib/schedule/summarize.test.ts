import { describe, expect, it } from 'vitest'
import { summarize } from './postsStore'
import type { ScheduledPost } from './types'

function post(overrides: Partial<ScheduledPost>): ScheduledPost {
  return {
    id: crypto.randomUUID(),
    userId: 'u1',
    status: 'draft',
    segments: [{ text: 'test', media: [] }],
    attemptCount: 0,
    createdAt: '2026-08-22T00:00:00.000Z',
    updatedAt: '2026-08-22T00:00:00.000Z',
    ...overrides,
  }
}

describe('summarize', () => {
  const now = new Date('2026-08-22T10:00:00+09:00')

  it('ステータスごとに件数を数える', () => {
    const result = summarize(
      [
        post({ status: 'draft' }),
        post({ status: 'draft' }),
        post({ status: 'scheduled', scheduledAt: '2026-08-23T00:00:00.000Z' }),
        post({ status: 'posted' }),
        post({ status: 'failed' }),
      ],
      now
    )
    expect(result).toMatchObject({ draft: 2, scheduled: 1, posted: 1, failed: 1 })
  })

  it('投稿処理中は予約中として数える（ユーザーから見れば同じ「まだ出ていない予約」）', () => {
    const result = summarize([post({ status: 'publishing', scheduledAt: '2026-08-22T02:00:00.000Z' })], now)
    expect(result.scheduled).toBe(1)
  })

  it('繰り返しテンプレートは予約件数と別枠で数える', () => {
    const result = summarize(
      [
        post({
          status: 'scheduled',
          repeatRule: { freq: 'daily', interval: 1, time: '09:00', timeZone: 'Asia/Tokyo' },
        }),
        // テンプレートから生成された実体行は通常の予約として数える
        post({
          status: 'scheduled',
          scheduledAt: '2026-08-23T00:00:00.000Z',
          repeatParentId: 'parent',
          repeatRule: { freq: 'daily', interval: 1, time: '09:00', timeZone: 'Asia/Tokyo' },
        }),
      ],
      now
    )
    expect(result.repeating).toBe(1)
    expect(result.scheduled).toBe(1)
  })

  it('次の投稿時刻は「これから来る予約」の中で最も早いものを選ぶ', () => {
    const result = summarize(
      [
        // すでに過ぎている予約は次の投稿にしない
        post({ status: 'scheduled', scheduledAt: '2026-08-21T00:00:00.000Z' }),
        post({ status: 'scheduled', scheduledAt: '2026-08-25T00:00:00.000Z' }),
        post({ status: 'scheduled', scheduledAt: '2026-08-23T00:00:00.000Z' }),
      ],
      now
    )
    expect(result.nextScheduledAt).toBe('2026-08-23T00:00:00.000Z')
  })

  it('今日これから投稿される件数を数える', () => {
    const result = summarize(
      [
        // 2026-08-22 20:00 JST = 今日のこれから
        post({ status: 'scheduled', scheduledAt: '2026-08-22T11:00:00.000Z' }),
        // 2026-08-23 = 明日
        post({ status: 'scheduled', scheduledAt: '2026-08-23T05:00:00.000Z' }),
      ],
      now
    )
    expect(result.dueToday).toBe(1)
  })
})

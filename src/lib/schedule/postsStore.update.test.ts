import { beforeEach, describe, expect, it, vi } from 'vitest'

// 予約の更新が Supabase に送る中身。手元には本物のデータベースが無いので、送った列を見る。
const sent = vi.hoisted(() => ({ calls: [] as { table: string; patch: Record<string, unknown>; id: string }[], error: null as null | { message: string } }))
vi.mock('../supabase', () => ({
  requireSupabase: async () => ({
    from: (table: string) => ({
      update: (patch: Record<string, unknown>) => ({
        eq: async (_column: string, id: string) => {
          sent.calls.push({ table, patch, id })
          return { error: sent.error }
        },
      }),
    }),
  }),
}))

import { REJECTED_MARK } from '../xAutopilot/types'
import { updateScheduledPost } from './postsStore'

beforeEach(() => {
  sent.calls = []
  sent.error = null
})

describe('updateScheduledPost: 自動運転の予約を「取り消す」', () => {
  it('rejected を付けると、status は canceled、error_message に「取り消した」印が入る（行は消さない）', async () => {
    await updateScheduledPost('p1', { status: 'canceled', rejected: true })
    expect(sent.calls).toHaveLength(1)
    expect(sent.calls[0]).toMatchObject({ table: 'scheduled_posts', id: 'p1' })
    expect(sent.calls[0].patch).toMatchObject({ status: 'canceled', error_message: REJECTED_MARK })
    expect(REJECTED_MARK).toBe('本人が取り消した')
  })

  it('rejected を付けない更新は、error_message に触れない（印が勝手に付かない）', async () => {
    await updateScheduledPost('p2', { status: 'draft', scheduledAt: null })
    expect(sent.calls[0].patch).not.toHaveProperty('error_message')
  })

  it('再予約(clearError)は、失敗理由を消す。取り消しの印とは別', async () => {
    await updateScheduledPost('p3', { status: 'scheduled', clearError: true })
    expect(sent.calls[0].patch).toMatchObject({ error_message: null, attempt_count: 0 })
  })

  it('送信に失敗したら、日本語で投げる（画面が取り消せなかったことを伝える）', async () => {
    sent.error = { message: 'boom' }
    await expect(updateScheduledPost('p4', { status: 'canceled', rejected: true })).rejects.toThrow('予約の更新に失敗しました: boom')
  })
})

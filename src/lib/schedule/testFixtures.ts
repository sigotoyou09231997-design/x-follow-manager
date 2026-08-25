import type { ScheduledPost } from './types'

/** テスト用の予約1件。必要なところだけ上書きして使う。 */
export function buildPost(overrides: Partial<ScheduledPost> = {}): ScheduledPost {
  return {
    id: 'post-1',
    userId: 'user-1',
    status: 'scheduled',
    segments: [{ text: '本文', media: [] }],
    attemptCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

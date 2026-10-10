import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ScheduledPost } from '../../lib/schedule/types'

vi.mock('../../lib/schedule/postsStore', () => ({ deleteScheduledPost: vi.fn(), updateScheduledPost: vi.fn() }))

import { ScheduledPostList } from './ScheduledPostList'

function post(id: string, patch: Partial<ScheduledPost> = {}): ScheduledPost {
  return {
    id,
    userId: 'u',
    status: 'scheduled',
    scheduledAt: '2026-10-11T03:00:00.000Z',
    segments: [{ text: `本文 ${id}`, media: [] }],
    attemptCount: 0,
    createdAt: '2026-10-10T00:00:00Z',
    updatedAt: '2026-10-10T00:00:00Z',
    ...patch,
  }
}

describe('ScheduledPostList: 自動運転の印', () => {
  it('自動運転でAIが作った予約にだけ、その印を出す（ふつうの予約・AIの下書き支援には出さない）', () => {
    render(
      <ScheduledPostList
        posts={[
          post('auto', { aiPrompt: 'autopilot:2026-10-11#0' }),
          post('plain'),
          post('assist', { aiPrompt: '朝のあいさつについて書いて' }),
        ]}
        onChanged={() => {}}
        onEdit={() => {}}
      />
    )
    expect(screen.getAllByText('自動運転でAIが作りました')).toHaveLength(1)
    const item = screen.getByText('本文 auto').closest('li')
    expect(item).toHaveTextContent('自動運転でAIが作りました')
    expect(screen.getByText('本文 plain').closest('li')).not.toHaveTextContent('自動運転')
  })
})

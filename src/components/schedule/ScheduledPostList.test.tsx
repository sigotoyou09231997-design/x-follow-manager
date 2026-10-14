import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { RepeatRule, ScheduledPost } from '../../lib/schedule/types'

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

// 投稿済みは一覧に出さない。出たあとの投稿が積み上がって、これからの予約が埋もれるため（本人の指示）。
describe('ScheduledPostList: 投稿済み・取り消したものは一覧に出さない', () => {
  const dailyRule: RepeatRule = { freq: 'daily', interval: 1, time: '09:00', timeZone: 'Asia/Tokyo' }
  const posts = [
    // 自動運転の「取り消す」は、消さずに印を付けて残す（次に書くときの「出さないもの」にするため）。一覧に積み上げない
    post('rejected', { status: 'canceled', errorMessage: '本人が取り消した', aiPrompt: 'autopilot:2026-10-15#0' }),
    post('stopped', { status: 'canceled', aiPrompt: 'autopilot:2026-10-15#1' }), // 「自動運転を止める」での一括の取り消し
    post('next', { status: 'scheduled' }),
    post('memo', { status: 'draft' }),
    post('ng', { status: 'failed', errorMessage: '失敗の理由' }),
    post('gone1', { status: 'posted', postedTweetIds: ['111'] }),
    post('gone2', { status: 'posted', postedTweetIds: ['222'] }),
    // 繰り返しの親は、終わると posted になる。これも一緒に外れる
    post('series-done', { status: 'posted', repeatRule: dailyRule }),
    // 繰り返しの親（続いているもの）は残る
    post('series-live', { status: 'scheduled', repeatRule: dailyRule }),
  ]

  function renderList() {
    return render(<ScheduledPostList posts={posts} onChanged={() => {}} onEdit={() => {}} />)
  }

  it('「すべて」に投稿済みの投稿は出ない（予約中・下書き・失敗・続いている繰り返しは出る）', () => {
    renderList()
    for (const id of ['next', 'memo', 'ng', 'series-live']) expect(screen.getByText(`本文 ${id}`)).toBeInTheDocument()
    for (const id of ['gone1', 'gone2', 'series-done', 'rejected', 'stopped']) {
      expect(screen.queryByText(`本文 ${id}`)).not.toBeInTheDocument()
    }
    // 投稿済みの印も、「Xで見る」リンクも、一覧には残らない
    expect(screen.queryByText('投稿済み')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Xで見る/ })).not.toBeInTheDocument()
  })

  it('絞り込みに「投稿済み」は無く、「すべて」の件数にも投稿済みを数えない', () => {
    renderList()
    const filters = screen.getByRole('navigation')
    expect(filters).not.toHaveTextContent('投稿済み')
    expect(filters).toHaveTextContent('すべて4') // next / memo / ng / series-live（取り消したものも数えない）
    expect(filters).toHaveTextContent('繰り返し1') // 終わった親は数えない
  })
})

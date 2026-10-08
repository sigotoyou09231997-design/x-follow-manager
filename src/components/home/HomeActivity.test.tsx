import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HomeActivity } from './HomeActivity'
import type { ChannelSnapshot, Snapshots } from '../../lib/autopost/api'
import { buildPost } from '../../lib/schedule/testFixtures'

const auth = vi.hoisted(() => ({
  state: { session: {} as object | null, loading: false, configured: true },
}))
vi.mock('../../hooks/useSupabaseAuth', () => ({
  useSupabaseAuth: () => auth.state,
  signInWithGoogle: vi.fn(),
}))

const data = vi.hoisted(() => ({
  snapshots: undefined as unknown,
  posts: [] as unknown[],
}))
vi.mock('../../hooks/useAutopost', () => ({
  useAutopost: () => ({ snapshots: data.snapshots, loading: false, reload: vi.fn(), applySnapshot: vi.fn() }),
}))
vi.mock('../../hooks/useScheduledPosts', () => ({
  useScheduledPosts: () => ({ posts: data.posts, loading: false, reload: vi.fn() }),
}))

const minutesAgo = (m: number) => new Date(Date.now() - m * 60000).toISOString()

function channel(name: 'discord' | 'yay', today: number, text: string): ChannelSnapshot {
  return {
    channel: name,
    messages: [text],
    archive: [],
    version: 1,
    savedAt: null,
    status: { lastPost: { t: minutesAgo(4), text }, today, at: minutesAgo(1) },
    paused: false,
    pausedAt: null,
    pauseReady: true,
    limits: { maxLength: 1000, maxMessages: name === 'yay' ? 1 : 10 },
  }
}

const tidy = { hasData: true, pending: 87 }

beforeEach(() => {
  auth.state = { session: {}, loading: false, configured: true }
  data.snapshots = { discord: channel('discord', 134, 'ディスコードの文'), yay: channel('yay', 311, 'Yayの文') } satisfies Snapshots
  data.posts = [
    buildPost({ id: 'next', status: 'scheduled', scheduledAt: new Date(Date.now() + 3600_000).toISOString(), segments: [{ text: '次のX投稿', media: [] }] }),
  ]
})

describe('HomeActivity', () => {
  it('サービスの丸いアイコンと、動きの一覧を出す', () => {
    render(<HomeActivity tidy={tidy} onOpen={() => {}} />)
    expect(screen.getByRole('heading', { name: 'いまの動き' })).toBeInTheDocument()

    const stories = screen.getByRole('list', { name: 'サービスの様子' })
    expect(stories).toHaveTextContent('今日134件')
    expect(stories).toHaveTextContent('今日311件')
    expect(stories).toHaveTextContent('予約1件')
    expect(stories).toHaveTextContent('未確認87人')

    expect(screen.getByText('次のX投稿')).toBeInTheDocument()
    expect(screen.getByText('ディスコードの文')).toBeInTheDocument()
    expect(screen.getByText('Yayの文')).toBeInTheDocument()
  })

  it('丸いアイコンを押すと、その場所（自動投稿は投稿先つき）を開く', () => {
    const onOpen = vi.fn()
    render(<HomeActivity tidy={tidy} onOpen={onOpen} />)

    fireEvent.click(within(screen.getByRole('list', { name: 'サービスの様子' })).getByRole('button', { name: /Yay/ }))
    expect(onOpen).toHaveBeenLastCalledWith({ tab: 'autopost', channel: 'yay' })
    fireEvent.click(within(screen.getByRole('list', { name: 'サービスの様子' })).getByRole('button', { name: /X予約/ }))
    expect(onOpen).toHaveBeenLastCalledWith({ tab: 'schedule' })
    fireEvent.click(within(screen.getByRole('list', { name: 'サービスの様子' })).getByRole('button', { name: /フォロー整理/ }))
    expect(onOpen).toHaveBeenLastCalledWith({ tab: 'tidy' })
  })

  it('一覧のカードを押しても、同じように開く', () => {
    const onOpen = vi.fn()
    render(<HomeActivity tidy={tidy} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: /ディスコードの文/ }))
    expect(onOpen).toHaveBeenCalledWith({ tab: 'autopost', channel: 'discord' })
  })

  it('ログイン前は、丸いアイコンは出したまま、ログインを案内する（一覧は出さない）', () => {
    auth.state = { session: null, loading: false, configured: true }
    render(<HomeActivity tidy={tidy} onOpen={() => {}} />)
    expect(screen.getByRole('button', { name: 'Googleでログイン' })).toBeInTheDocument()
    expect(screen.queryByText('ディスコードの文')).not.toBeInTheDocument()
  })

  it('動きが何も無ければ、そのことを書く', () => {
    data.snapshots = undefined
    data.posts = []
    render(<HomeActivity tidy={tidy} onOpen={() => {}} />)
    expect(screen.getByText(/まだ動きはありません/)).toBeInTheDocument()
  })

  it('サーバーに接続できない環境（Artifact・サーバーなしの開発）では、何も出さない', () => {
    auth.state = { session: null, loading: false, configured: false }
    const { container } = render(<HomeActivity tidy={tidy} onOpen={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })
})

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// 予約投稿タブをログイン済みで描けるようにする（ScheduleView.test.tsx と同じ）。
vi.mock('./hooks/useSupabaseAuth', () => ({
  useSupabaseAuth: () => ({ session: {}, loading: false, configured: true, configStatus: undefined }),
  signInWithGoogle: vi.fn(),
  signOut: vi.fn(),
}))
vi.mock('./hooks/useScheduledPosts', () => ({
  useScheduledPosts: () => ({
    posts: [],
    summary: { draft: 0, scheduled: 0, posted: 0, failed: 0, repeating: 0, dueToday: 0 },
    xAccount: undefined,
    loading: false,
    error: undefined,
    reload: vi.fn(),
  }),
}))
vi.mock('./lib/schedule/api', () => ({ generatePosts: vi.fn(), completeXConnect: vi.fn() }))
vi.mock('./lib/schedule/postsStore', () => ({ createScheduledPosts: vi.fn(async () => []) }))

import App from './App'

afterEach(cleanup)

function bottomNav(container: HTMLElement, label: string): HTMLElement {
  const item = Array.from(container.querySelectorAll<HTMLElement>('.bottom-nav__item')).find((el) =>
    el.textContent?.includes(label)
  )
  if (!item) throw new Error(`下部バーに「${label}」がありません`)
  return item
}

// 「＋」を押した頼みは、予約投稿タブが開いた時点で使い切る。残したままだと、別のタブへ行って
// 予約投稿に戻る（＝タブの中身が作り直される）たびに、作成画面が勝手にまた開いた。
describe('App: 投稿作成の頼みは一度きり', () => {
  it('＋で開いて閉じたあと、別のタブを経由して予約投稿に戻っても、作成画面は勝手に開かない', async () => {
    const { container } = render(<App />)

    fireEvent.click(container.querySelector('.bottom-nav__fab')!)
    expect(await screen.findByRole('dialog', { name: '新しい投稿' })).toBeInTheDocument()

    fireEvent.click(container.querySelector('.composer-sheet__close')!)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(bottomNav(container, 'ホーム'))
    fireEvent.click(bottomNav(container, '予約投稿'))
    await waitFor(() => expect(container.querySelector('.schedule-view__toolbar')).toBeInTheDocument())

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('もう一度＋を押せば、ちゃんとまた開く（使い切ったあとも次の頼みは通る）', async () => {
    const { container } = render(<App />)

    fireEvent.click(container.querySelector('.bottom-nav__fab')!)
    await screen.findByRole('dialog')
    fireEvent.click(container.querySelector('.composer-sheet__close')!)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(container.querySelector('.bottom-nav__fab')!)
    expect(await screen.findByRole('dialog', { name: '新しい投稿' })).toBeInTheDocument()
  })

  it('ホームの「AIで下書きを作る」から開くとAIパネルが開いており、閉じて戻っても勝手には開かない', async () => {
    const { container } = render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: /AIで下書きを作る/ }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /AIに書/ })).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(container.querySelector('.composer-sheet__close')!)
    fireEvent.click(bottomNav(container, 'ホーム'))
    fireEvent.click(bottomNav(container, '予約投稿'))
    await waitFor(() => expect(container.querySelector('.schedule-view__toolbar')).toBeInTheDocument())

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

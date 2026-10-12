import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ScheduledPost } from '../../lib/schedule/types'

const post: ScheduledPost = {
  id: 'p1',
  userId: 'u',
  status: 'scheduled',
  scheduledAt: '2026-10-11T03:00:00.000Z',
  segments: [{ text: '直したい予約の本文', media: [] }],
  attemptCount: 0,
  createdAt: '2026-10-10T00:00:00Z',
  updatedAt: '2026-10-10T00:00:00Z',
}

// ログイン済み・Supabase 設定済みの状態にして、予約投稿タブの本体を描く。
vi.mock('../../hooks/useSupabaseAuth', () => ({
  useSupabaseAuth: () => ({ session: {}, loading: false, configured: true, configStatus: undefined }),
  signInWithGoogle: vi.fn(),
  signOut: vi.fn(),
}))
vi.mock('../../hooks/useScheduledPosts', () => ({
  useScheduledPosts: () => ({
    posts: [post],
    summary: { draft: 0, scheduled: 1, posted: 0, failed: 0, repeating: 0, dueToday: 0 },
    xAccount: undefined,
    loading: false,
    error: undefined,
    reload: vi.fn(),
  }),
}))
vi.mock('../../lib/schedule/api', () => ({ generatePosts: vi.fn(), completeXConnect: vi.fn() }))
vi.mock('../../lib/schedule/postsStore', () => ({
  createScheduledPost: vi.fn(),
  createScheduledPosts: vi.fn(async () => []),
  updateScheduledPost: vi.fn(),
  deleteScheduledPost: vi.fn(),
}))

import { ScheduleView } from './ScheduleView'

afterEach(cleanup)

const aiPanelToggle = () => screen.getByRole('button', { name: /AIに書/ })

// 投稿作成は ComposerSheet（全面オーバーレイ）の1本。以前は一覧の上に開く別のコンポーザーもあり、
// 入口によって画面が違っていた。
describe('ScheduleView: 投稿作成は ComposerSheet 一本', () => {
  it('上のツールバーの「投稿を作る」は、全面オーバーレイのシートを開く（AIパネルは閉じたまま）', () => {
    render(<ScheduleView />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '投稿を作る' }))

    expect(screen.getByRole('dialog', { name: '新しい投稿' })).toBeInTheDocument()
    expect(aiPanelToggle()).toHaveAttribute('aria-expanded', 'false')
  })

  it('一覧の「編集」も同じシートで開く（見出しは「予約を編集」で、本文が入っている）', () => {
    render(<ScheduleView />)
    fireEvent.click(screen.getByRole('button', { name: /^編集/ }))

    expect(screen.getByRole('dialog', { name: '予約を編集' })).toBeInTheDocument()
    expect(screen.getByDisplayValue('直したい予約の本文')).toBeInTheDocument()
  })

  it('ホームの「AIで下書きを作る」から来たとき(startWithAi)は、AIパネルを開いた状態で始まる', () => {
    render(<ScheduleView composeRequest={1} composeStartWithAi />)

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(aiPanelToggle()).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByLabelText('AIに伝えたいこと')).toBeInTheDocument()
  })

  it('中央の＋から来たとき(startWithAi なし)は、AIパネルは閉じたまま', () => {
    render(<ScheduleView composeRequest={1} composeStartWithAi={false} />)

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(aiPanelToggle()).toHaveAttribute('aria-expanded', 'false')
  })

  it('AIから来たあとに＋を押すと、AIパネルは閉じた状態に戻る（入口ごとに意図が違う）', () => {
    const { rerender } = render(<ScheduleView composeRequest={1} composeStartWithAi />)
    expect(aiPanelToggle()).toHaveAttribute('aria-expanded', 'true')

    // シートを閉じて（書きかけではないので確認なしで閉じる）、＋を押し直す
    fireEvent.click(screen.getByRole('button', { name: /閉じる|キャンセル|×/ }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    rerender(<ScheduleView composeRequest={2} composeStartWithAi={false} />)

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(aiPanelToggle()).toHaveAttribute('aria-expanded', 'false')
  })

  // 呼び出し側(App)が頼みを使い切りにできるように、開いたことを知らせる。App 側の確認は App.compose.test.tsx。
  it('頼みを受けて開いたら onComposeHandled を1回呼ぶ。頼みが無い(0)ときは開かず、呼ばない', () => {
    const handled = vi.fn()
    const { rerender } = render(<ScheduleView composeRequest={0} onComposeHandled={handled} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(handled).not.toHaveBeenCalled()

    rerender(<ScheduleView composeRequest={1} onComposeHandled={handled} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(handled).toHaveBeenCalledTimes(1)

    // App が頼みを 0 に戻しても、すでに開いている作成画面は閉じない
    rerender(<ScheduleView composeRequest={0} onComposeHandled={handled} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(handled).toHaveBeenCalledTimes(1)
  })
})

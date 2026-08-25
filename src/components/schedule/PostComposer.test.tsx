import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PostComposer } from './PostComposer'
import { buildPost } from '../../lib/schedule/testFixtures'

// Supabaseに触る保存・画像まわりは、この画面の見た目の検証には不要なので止めておく。
const deletePostMedia = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('../../lib/schedule/postsStore', () => ({
  createScheduledPost: vi.fn(async () => {}),
  updateScheduledPost: vi.fn(async () => {}),
  uploadPostMedia: vi.fn(async () => ({ path: 'p', mime: 'image/png' })),
  signMediaUrl: vi.fn(async () => undefined),
  deletePostMedia,
}))

function textarea(): HTMLTextAreaElement {
  return screen.getByPlaceholderText('いまどうしてる？') as HTMLTextAreaElement
}

// AI下書き支援は以前「新しい投稿」とは別パネルだった。1画面に統合した状態を守る。
describe('PostComposer', () => {
  it('本文欄とAI下書き支援が同じ画面に並ぶ', () => {
    render(<PostComposer onSaved={() => {}} onCancel={() => {}} />)

    expect(screen.getByPlaceholderText('いまどうしてる？')).toBeInTheDocument()

    // 折りたたみを開くと、生成の入力欄が同じ画面に出る（別画面へ遷移しない）。
    fireEvent.click(screen.getByRole('button', { name: /AIに書いてもらう/ }))
    expect(screen.getByText('AIに伝えたいこと')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /この内容で書いてもらう/ })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('いまどうしてる？')).toBeInTheDocument()
  })

  it('本文を書いてあるときは書き直しとして案内する', () => {
    render(<PostComposer onSaved={() => {}} onCancel={() => {}} />)

    fireEvent.change(screen.getByPlaceholderText('いまどうしてる？'), {
      target: { value: '書きかけの本文' },
    })

    fireEvent.click(screen.getByRole('button', { name: /AIに書き直してもらう/ }))
    expect(
      screen.getByText(/いま本文欄にある文章もAIへ渡すので/)
    ).toBeInTheDocument()
  })
})

// 予約投稿タブでは一覧の上にコンポーザーを開いたまま、一覧側の「編集」を押せる。
// このとき再マウントされないので、本文が前の対象のまま残ると、開いたはずの投稿を
// 空の本文で上書きしてしまう。
describe('PostComposer: 編集対象の切り替え', () => {
  it('開いたまま別の投稿の編集に切り替えると、その投稿の本文が入る', () => {
    const { rerender } = render(<PostComposer onSaved={() => {}} onCancel={() => {}} />)
    expect(textarea().value).toBe('')

    rerender(<PostComposer editing={buildPost({ segments: [{ text: '既存の予約本文', media: [] }] })} onSaved={() => {}} onCancel={() => {}} />)
    expect(textarea().value).toBe('既存の予約本文')

    rerender(
      <PostComposer
        editing={buildPost({ id: 'post-2', segments: [{ text: 'べつの予約', media: [] }] })}
        onSaved={() => {}}
        onCancel={() => {}}
      />
    )
    expect(textarea().value).toBe('べつの予約')
  })

  it('編集から新規作成に戻ると本文が空になる', () => {
    const { rerender } = render(
      <PostComposer editing={buildPost({ segments: [{ text: '既存の予約本文', media: [] }] })} onSaved={() => {}} onCancel={() => {}} />
    )
    expect(textarea().value).toBe('既存の予約本文')

    rerender(<PostComposer onSaved={() => {}} onCancel={() => {}} />)
    expect(textarea().value).toBe('')
  })

  it('同じ投稿を開いたままなら、書きかけを消さない', () => {
    const post = buildPost({ segments: [{ text: '既存の予約本文', media: [] }] })
    const { rerender } = render(
      <PostComposer editing={post} onSaved={() => {}} onCancel={() => {}} />
    )
    fireEvent.change(textarea(), { target: { value: '書き直した本文' } })

    // 一覧の再読み込みで同じ投稿の別インスタンスが降ってきても、書きかけは残す。
    rerender(<PostComposer editing={buildPost({ segments: [{ text: '既存の予約本文', media: [] }] })} onSaved={() => {}} onCancel={() => {}} />)
    expect(textarea().value).toBe('書き直した本文')
  })
})

// 画像はStorageへ先に上げてしまうので、保存せずに閉じたぶんを消す者がいないと
// 本文から参照されないファイルだけが残り続ける（画面からは消せない）。
describe('PostComposer: 保存しなかった画像の後始末', () => {
  async function attachImage(container: HTMLElement) {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['x'], 'a.png', { type: 'image/png' })
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => expect(screen.getByLabelText('画像を削除')).toBeInTheDocument())
  }

  it('保存せずに閉じたら、上げた画像をStorageから消す', async () => {
    deletePostMedia.mockClear()
    const { container, unmount } = render(
      <PostComposer onSaved={() => {}} onCancel={() => {}} />
    )
    await attachImage(container)

    expect(deletePostMedia).not.toHaveBeenCalled()
    unmount()
    expect(deletePostMedia).toHaveBeenCalledWith('p')
  })

  it('別の投稿の編集に移ったら、前の対象に上げた画像を消す', async () => {
    deletePostMedia.mockClear()
    const { container, rerender } = render(
      <PostComposer onSaved={() => {}} onCancel={() => {}} />
    )
    await attachImage(container)

    rerender(
      <PostComposer editing={buildPost()} onSaved={() => {}} onCancel={() => {}} />
    )
    expect(deletePostMedia).toHaveBeenCalledWith('p')
  })

  it('保存できた画像は消さない', async () => {
    deletePostMedia.mockClear()
    const { container, unmount } = render(
      <PostComposer onSaved={() => {}} onCancel={() => {}} />
    )
    await attachImage(container)

    fireEvent.click(screen.getByRole('button', { name: '下書き保存' }))
    await waitFor(() => expect(screen.queryByText('保存中…')).not.toBeInTheDocument())

    unmount()
    expect(deletePostMedia).not.toHaveBeenCalled()
  })
})

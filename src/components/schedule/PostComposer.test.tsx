import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PostComposer } from './PostComposer'
import { createScheduledPost } from '../../lib/schedule/postsStore'
import { buildPost } from '../../lib/schedule/testFixtures'

const generatePosts = vi.hoisted(() =>
  vi.fn(async () => [{ segments: ['手直しされた投稿'], note: '結論から' }])
)
vi.mock('../../lib/schedule/api', () => ({ generatePosts }))

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


// 手直しを頼みたくなるのは本文を書き終えた瞬間。そこから画面上のAIパネルまで
// 戻って指示を打ち込ませると、頼むより自分で直した方が早くなってしまう。
describe('PostComposer: 本文の下からAIに手直しを頼む', () => {
  it('本文が空のうちは手直しのボタンを出さない', () => {
    render(<PostComposer onSaved={() => {}} onCancel={() => {}} />)
    expect(screen.queryByRole('button', { name: '短く' })).not.toBeInTheDocument()
  })

  it('本文を書くと現れ、押すだけで指示なしに生成まで進む', async () => {
    generatePosts.mockClear()
    render(<PostComposer onSaved={() => {}} onCancel={() => {}} />)
    fireEvent.change(textarea(), { target: { value: '会社の人からタンブラーはダメだと言われた' } })

    fireEvent.click(screen.getByRole('button', { name: '短く' }))

    await waitFor(() => expect(generatePosts).toHaveBeenCalled())
    expect(generatePosts).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('短く'),
        currentText: '会社の人からタンブラーはダメだと言われた',
      })
    )
    // 案は上のAIパネルに出る（本文欄の下で完結させず、選ばせる形は変えない）。
    await waitFor(() => expect(screen.getByText('手直しされた投稿')).toBeInTheDocument())
  })

  it('同じ注文を続けて押しても、そのつど頼み直せる', async () => {
    generatePosts.mockClear()
    render(<PostComposer onSaved={() => {}} onCancel={() => {}} />)
    fireEvent.change(textarea(), { target: { value: '書いた本文' } })

    fireEvent.click(screen.getByRole('button', { name: '整える' }))
    await waitFor(() => expect(generatePosts).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: '整える' }))
    await waitFor(() => expect(generatePosts).toHaveBeenCalledTimes(2))
  })

  it('「自分で伝える」なら、生成せずに入力欄を開いて待つ', async () => {
    generatePosts.mockClear()
    render(<PostComposer onSaved={() => {}} onCancel={() => {}} />)
    fireEvent.change(textarea(), { target: { value: '書いた本文' } })

    fireEvent.click(screen.getByRole('button', { name: '自分で伝える' }))

    const box = await screen.findByLabelText('AIに伝えたいこと')
    expect(box).toHaveFocus()
    expect(generatePosts).not.toHaveBeenCalled()
  })
})


// 繰り返し予約は本文をそのまま複製するので、毎日使うと同じ文章が並ぶ。
// 「AIにおまかせ」は、投稿のたびにサーバー側で本文を書くための設定で、
// このときコンポーザーの本文欄は書いても使われない。
describe('PostComposer: 毎日ちがう本文をAIにまかせる', () => {
  // 保存のモックはファイル全体で共有しているため、前のテストの呼び出しが残る。
  beforeEach(() => vi.mocked(createScheduledPost).mockClear())

  function enableRepeat() {
    fireEvent.click(screen.getByLabelText('繰り返し投稿にする'))
  }
  function enableAi() {
    fireEvent.click(screen.getByLabelText(/毎回ちがう本文をAIに書いてもらう/))
  }

  it('繰り返しを開くと既定で「毎日」になっている', () => {
    render(<PostComposer onSaved={() => {}} onCancel={() => {}} />)
    enableRepeat()
    expect((screen.getByLabelText('繰り返しの頻度') as HTMLSelectElement).value).toBe('daily')
  })

  // 書いても投稿には一切使われない欄を残すと、書いた文章が黙って捨てられる。
  it('AIにまかせると、本文欄とAI下書きが消えてお題の欄になる', () => {
    render(<PostComposer onSaved={() => {}} onCancel={() => {}} />)
    enableRepeat()
    expect(screen.getByPlaceholderText('いまどうしてる？')).toBeInTheDocument()

    enableAi()
    expect(screen.queryByPlaceholderText('いまどうしてる？')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /AIに書いてもらう/ })).not.toBeInTheDocument()
    expect(screen.getByText('何について書くか')).toBeInTheDocument()
    expect(screen.getByText(/本文は投稿のたびにAIが書きます/)).toBeInTheDocument()
  })

  // お題が空のまま保存できてしまうと、投稿の時刻が来てから初めて
  // 「本文が作れない」と分かる（しかも本人が見ていない時間に）。
  it('お題が空のままでは予約できない', async () => {
    render(<PostComposer onSaved={() => {}} onCancel={() => {}} />)
    enableRepeat()
    enableAi()

    fireEvent.click(screen.getByRole('button', { name: /AIにまかせて予約する/ }))
    expect(
      await screen.findByText('AIに何について書いてもらうかを入力してください')
    ).toBeInTheDocument()
    expect(createScheduledPost).not.toHaveBeenCalled()
  })

  // 白紙のお題欄に何をどこまで書けばよいかは分かりにくい。押すだけで埋まる入口を残す。
  it('お題のひな形を押すと、そのまま使える文がお題に入る', async () => {
    const onSaved = vi.fn()
    render(<PostComposer onSaved={onSaved} onCancel={() => {}} />)
    enableRepeat()
    enableAi()

    fireEvent.click(screen.getByRole('button', { name: '毎朝のあいさつ' }))
    const topic = screen.getByLabelText('何について書くか') as HTMLTextAreaElement
    expect(topic.value).toContain('おはようございます')

    // 押したあとは、書いた文章を消さないようにひな形を引っ込める。
    expect(screen.queryByRole('button', { name: '毎朝のあいさつ' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /AIにまかせて予約する/ }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(createScheduledPost).toHaveBeenCalledWith(
      expect.objectContaining({
        repeatRule: expect.objectContaining({ autoGenerate: true, aiTopic: topic.value }),
      })
    )
  })

  it('お題を書けば、本文なしでも繰り返しとして保存できる', async () => {
    const onSaved = vi.fn()
    render(<PostComposer onSaved={onSaved} onCancel={() => {}} />)
    enableRepeat()
    enableAi()

    fireEvent.change(screen.getByLabelText('何について書くか'), {
      target: { value: '個人開発で気づいたこと' },
    })
    fireEvent.click(screen.getByRole('button', { name: /AIにまかせて予約する/ }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(createScheduledPost).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'scheduled',
        repeatRule: expect.objectContaining({
          freq: 'daily',
          autoGenerate: true,
          aiTopic: '個人開発で気づいたこと',
        }),
      })
    )
  })
})

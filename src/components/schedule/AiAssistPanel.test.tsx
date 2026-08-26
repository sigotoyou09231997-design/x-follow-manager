import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AiAssistPanel } from './AiAssistPanel'

const generatePosts = vi.hoisted(() =>
  vi.fn(async () => [{ segments: ['できあがった投稿'], note: '体験談から入る' }])
)
vi.mock('../../lib/schedule/api', () => ({ generatePosts }))
vi.mock('../../lib/schedule/postsStore', () => ({ createScheduledPosts: vi.fn(async () => []) }))

function open(currentText?: string) {
  const onUse = vi.fn()
  render(<AiAssistPanel currentText={currentText} onUse={onUse} onSavedDrafts={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: /AIに書/ }))
  return { onUse }
}

function messageBox(): HTMLTextAreaElement {
  return screen.getByLabelText('AIに伝えたいこと') as HTMLTextAreaElement
}

// 以前は お題 / 文体 / 追加の指示 と入力欄が3つに分かれていた。書きたいことを
// 頭の中で3つに仕分けてから書く必要があり、「言いたいことはあるのにどの欄に
// 書けばいいか分からない」で止まりやすかった。
describe('AiAssistPanel: 伝えたいことを書くと文章になる', () => {
  it('入力欄は「AIに伝えたいこと」1つだけ', () => {
    open()

    expect(messageBox()).toBeInTheDocument()
    expect(screen.queryByText('何について投稿する？')).not.toBeInTheDocument()
    expect(screen.queryByText('文体の指定（任意）')).not.toBeInTheDocument()
    expect(screen.queryByText('追加の指示（任意）')).not.toBeInTheDocument()
  })

  it('書いた内容をそのままAIへ渡し、返ってきた文章を出す', async () => {
    generatePosts.mockClear()
    open()

    const memo = '3か月作ってたアプリを出した\n通知まわりが一番大変だった\n淡々と、絵文字なしで'
    fireEvent.change(messageBox(), { target: { value: memo } })
    fireEvent.click(screen.getByRole('button', { name: /この内容で書いてもらう/ }))

    await waitFor(() => expect(screen.getByText('できあがった投稿')).toBeInTheDocument())
    expect(generatePosts).toHaveBeenCalledWith(expect.objectContaining({ message: memo }))
  })

  it('空のまま押したら、何を書けばよいか伝える', () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: /この内容で書いてもらう/ }))
    expect(screen.getByText('AIに伝えたいことを入力してください')).toBeInTheDocument()
  })

  // 本文を書きかけてから頼むときは、「これをもっと短く」の「これ」が要る。
  it('書きかけの本文があれば、それも一緒にAIへ渡す', async () => {
    generatePosts.mockClear()
    open('すでに書いた本文')

    fireEvent.change(messageBox(), { target: { value: 'もっと短く、結論から' } })
    fireEvent.click(screen.getByRole('button', { name: /この内容で書いてもらう/ }))

    await waitFor(() => expect(generatePosts).toHaveBeenCalled())
    expect(generatePosts).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'もっと短く、結論から', currentText: 'すでに書いた本文' })
    )
  })

  // 本文を書いたあとに手直しを頼むだけなのに、上の欄へも何か書かせるのは面倒。
  it('本文があるなら、指示が空でも「これを整えて」として通す', async () => {
    generatePosts.mockClear()
    open('すでに書いた本文')

    fireEvent.click(screen.getByRole('button', { name: /いまの本文を整えてもらう/ }))

    await waitFor(() => expect(generatePosts).toHaveBeenCalled())
    expect(generatePosts).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('整えて'), currentText: 'すでに書いた本文' })
    )
  })

  it('選んだ案を本文欄へ流し込める', async () => {
    const { onUse } = open()

    fireEvent.change(messageBox(), { target: { value: 'アプリを出した' } })
    fireEvent.click(screen.getByRole('button', { name: /この内容で書いてもらう/ }))
    await waitFor(() => expect(screen.getByText('できあがった投稿')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /本文に使う/ }))
    expect(onUse).toHaveBeenCalledWith([{ text: 'できあがった投稿', media: [] }])
  })
})

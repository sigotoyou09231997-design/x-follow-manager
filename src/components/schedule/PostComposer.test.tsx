import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PostComposer } from './PostComposer'

// AI下書き支援は以前「新しい投稿」とは別パネルだった。1画面に統合した状態を守る。
describe('PostComposer', () => {
  it('本文欄とAI下書き支援が同じ画面に並ぶ', () => {
    render(<PostComposer onSaved={() => {}} onCancel={() => {}} />)

    expect(screen.getByPlaceholderText('いまどうしてる？')).toBeInTheDocument()

    // 折りたたみを開くと、生成の入力欄が同じ画面に出る（別画面へ遷移しない）。
    fireEvent.click(screen.getByRole('button', { name: /AIに下書きを作ってもらう/ }))
    expect(screen.getByText('何について投稿する？')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /投稿案を作る/ })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('いまどうしてる？')).toBeInTheDocument()
  })

  it('本文を書いてあるときは書き直しとして案内する', () => {
    render(<PostComposer onSaved={() => {}} onCancel={() => {}} />)

    fireEvent.change(screen.getByPlaceholderText('いまどうしてる？'), {
      target: { value: '書きかけの本文' },
    })

    fireEvent.click(screen.getByRole('button', { name: /AIに書き直してもらう/ }))
    expect(
      screen.getByText('いま本文欄にある文章もAIへ渡します。「これをもっと短く」のような指示が使えます。')
    ).toBeInTheDocument()
  })
})

import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ComposeCard } from './ComposeCard'

describe('言葉から書く', () => {
  it('材料が空のあいだは押せない。書いた案を出し、「別の書き方」では前の案を渡す', async () => {
    const onCompose = vi.fn(async () => ({ text: 'カレー、辛すぎた', problems: [] }))
    render(<ComposeCard disabled={false} onCompose={onCompose} />)
    const button = screen.getByRole('button', { name: '文章にする' })
    expect(button).toBeDisabled()

    fireEvent.change(screen.getByLabelText('材料になる単語や文章'), { target: { value: '昼ごはん カレー' } })
    fireEvent.click(button)
    await waitFor(() => expect(screen.getByText('カレー、辛すぎた')).toBeInTheDocument())
    expect(onCompose).toHaveBeenLastCalledWith('昼ごはん カレー', undefined)

    fireEvent.click(screen.getByRole('button', { name: '別の書き方にする' }))
    await waitFor(() => expect(onCompose).toHaveBeenCalledTimes(2))
    expect(onCompose).toHaveBeenLastCalledWith('昼ごはん カレー', 'カレー、辛すぎた')
  })

  it('失敗の理由は画面に出す', async () => {
    const onCompose = vi.fn(async () => {
      throw new Error('先に、過去の投稿から文体をまとめてください')
    })
    render(<ComposeCard disabled={false} onCompose={onCompose} />)
    fireEvent.change(screen.getByLabelText('材料になる単語や文章'), { target: { value: 'a' } })
    fireEvent.click(screen.getByRole('button', { name: '文章にする' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('文体をまとめて')
  })

  it('「自動投稿に追加」で文を渡し、案内を出す。追加後は押せない', async () => {
    const onAdd = vi.fn(async () => '確認待ちに追加しました')
    render(<ComposeCard disabled={false} onCompose={async () => ({ text: 'カレー、辛すぎた', problems: [] })} onAdd={onAdd} />)
    fireEvent.change(screen.getByLabelText('材料になる単語や文章'), { target: { value: 'カレー' } })
    fireEvent.click(screen.getByRole('button', { name: '文章にする' }))
    fireEvent.click(await screen.findByRole('button', { name: '自動投稿に追加' }))
    expect(await screen.findByText('確認待ちに追加しました')).toBeInTheDocument()
    expect(onAdd).toHaveBeenCalledWith('カレー、辛すぎた')
    expect(screen.getByRole('button', { name: '追加しました' })).toBeDisabled()
  })
})

import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ComposeCard } from './ComposeCard'

describe('言葉から書く', () => {
  it('材料が空のあいだは押せない。書いた案を出し、「別の書き方」では前の案を渡す', async () => {
    const onCompose = vi.fn(async () => ({ text: 'カレー、辛すぎた', problems: [] }))
    render(<ComposeCard disabled={false} onCompose={onCompose} />)
    const button = screen.getByRole('button', { name: '文章にする' })
    expect(button).toBeDisabled()

    await userEvent.type(screen.getByLabelText('材料になる単語や文章'), '昼ごはん カレー')
    await userEvent.click(button)
    await waitFor(() => expect(screen.getByText('カレー、辛すぎた')).toBeInTheDocument())
    expect(onCompose).toHaveBeenLastCalledWith('昼ごはん カレー', undefined)

    await userEvent.click(screen.getByRole('button', { name: '別の書き方にする' }))
    await waitFor(() => expect(onCompose).toHaveBeenCalledTimes(2))
    expect(onCompose).toHaveBeenLastCalledWith('昼ごはん カレー', 'カレー、辛すぎた')
  })

  it('失敗の理由は画面に出す', async () => {
    const onCompose = vi.fn(async () => {
      throw new Error('先に、過去の投稿から文体をまとめてください')
    })
    render(<ComposeCard disabled={false} onCompose={onCompose} />)
    await userEvent.type(screen.getByLabelText('材料になる単語や文章'), 'a')
    await userEvent.click(screen.getByRole('button', { name: '文章にする' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('文体をまとめて')
  })
})

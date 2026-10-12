import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RestartControl } from './RestartControl'
import type { RestartState } from '../../lib/autopost/api'

const api = vi.hoisted(() => ({
  fetchRestart: vi.fn(),
  requestRestart: vi.fn(),
}))
vi.mock('../../lib/autopost/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/autopost/api')>()),
  fetchRestart: api.fetchRestart,
  requestRestart: api.requestRestart,
}))

const idle: RestartState = { ready: true, requestedAt: null, handledAt: null, result: null }
const pending: RestartState = { ready: true, requestedAt: '2026-10-12T07:00:00.000Z', handledAt: null, result: null }
const done: RestartState = {
  ready: true,
  requestedAt: '2026-10-12T07:00:00.000Z',
  handledAt: '2026-10-12T07:00:40.000Z',
  result: 'Yay: 止まっていたので再起動しました / ディスコード: 動いているのでそのままです',
}

beforeEach(() => {
  api.fetchRestart.mockReset().mockResolvedValue(idle)
  api.requestRestart.mockReset().mockResolvedValue(pending)
})

describe('投稿役を再起動する', () => {
  it('押すと、もう一度確かめてから依頼する（押し間違いで動いている投稿役を巻き込まない）', async () => {
    render(<RestartControl enabled silent={false} />)
    fireEvent.click(await screen.findByRole('button', { name: '投稿役を再起動する' }))
    expect(api.requestRestart).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '再起動する' }))
    await waitFor(() => expect(api.requestRestart).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('再起動を依頼しました')).toBeTruthy()
  })

  it('「やめる」で依頼せずに戻れる', async () => {
    render(<RestartControl enabled silent={false} />)
    fireEvent.click(await screen.findByRole('button', { name: '投稿役を再起動する' }))
    fireEvent.click(screen.getByRole('button', { name: 'やめる' }))
    expect(api.requestRestart).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '投稿役を再起動する' })).toBeTruthy()
  })

  it('依頼中は押せず、Mac が処理した結果（何をしたか）が出る', async () => {
    api.fetchRestart.mockResolvedValue(pending)
    render(<RestartControl enabled silent={false} />)
    const button = (await screen.findByRole('button', { name: '依頼中…' })) as HTMLButtonElement
    expect(button.disabled).toBe(true)

    api.fetchRestart.mockResolvedValue(done)
    // 画面を開き直した（読み直した）のと同じ状態
    render(<RestartControl enabled silent={false} />)
    expect(await screen.findByText(/動いているのでそのままです/)).toBeTruthy()
  })

  it('止まっていると分かっているとき（通知から来たとき）は、「止まっているかもしれません」と出す', async () => {
    render(<RestartControl enabled silent />)
    expect(await screen.findByText('投稿役が止まっているかもしれません')).toBeTruthy()
  })

  it('表（SQL 008）が無いときは、ボタンの代わりに SQL を案内する', async () => {
    api.fetchRestart.mockResolvedValue({ ready: false, requestedAt: null, handledAt: null, result: null })
    render(<RestartControl enabled silent={false} />)
    expect(await screen.findByText('再起動の機能は準備中です')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '投稿役を再起動する' })).toBeNull()
  })

  it('依頼が失敗したら、理由を出す', async () => {
    api.requestRestart.mockRejectedValue(new Error('サーバーでエラーが起きました'))
    render(<RestartControl enabled silent={false} />)
    fireEvent.click(await screen.findByRole('button', { name: '投稿役を再起動する' }))
    fireEvent.click(screen.getByRole('button', { name: '再起動する' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'サーバーでエラーが起きました')
  })

  it('ログインしていないときは、何も出さず、サーバーも呼ばない', () => {
    const { container } = render(<RestartControl enabled={false} silent={false} />)
    expect(container.textContent).toBe('')
    expect(api.fetchRestart).not.toHaveBeenCalled()
  })
})

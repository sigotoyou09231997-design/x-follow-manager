import type { ReactNode } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AutoPostHome } from './AutoPostHome'
import type { ChannelSnapshot, Snapshots } from '../../lib/autopost/api'

const auth = vi.hoisted(() => ({
  state: { session: {} as object | null, loading: false, configured: true },
}))
vi.mock('../../hooks/useSupabaseAuth', () => ({
  useSupabaseAuth: () => auth.state,
  signInWithGoogle: vi.fn(),
  signOut: vi.fn(),
}))

const api = vi.hoisted(() => ({
  fetchSnapshots: vi.fn(),
  setPaused: vi.fn(),
  fetchRestart: vi.fn(),
  requestRestart: vi.fn(),
}))
vi.mock('../../lib/autopost/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/autopost/api')>()),
  ...api,
}))

// X の自動運転の中身は、専用のテストで確かめる。ここでは、下に差し込まれる部分（ディスコード・Yay）の並びだけを見る。
vi.mock('./XAutopilotPanel', () => ({
  XAutopilotPanel: ({ variant, children }: { variant?: string; children?: ReactNode }) => (
    <div>
      <p>X自動運転の中身（{variant}）</p>
      <section aria-label="稼働スイッチ">{children}</section>
    </div>
  ),
}))

const iso = (secondsAgo: number) => new Date(Date.now() - secondsAgo * 1000).toISOString()

function channel(patch: Partial<ChannelSnapshot> & Pick<ChannelSnapshot, 'channel'>): ChannelSnapshot {
  return {
    messages: ['文'],
    archive: [],
    version: 1,
    savedAt: null,
    status: { lastPost: null, today: 3, at: iso(10) },
    paused: false,
    pausedAt: null,
    pauseReady: true,
    limits: { maxLength: 1000, maxMessages: 10 },
    ...patch,
  }
}

const snapshots = (): Snapshots => ({
  discord: channel({ channel: 'discord' }),
  yay: channel({ channel: 'yay' }),
})

beforeEach(() => {
  auth.state = { session: {}, loading: false, configured: true }
  api.fetchSnapshots.mockReset().mockResolvedValue(snapshots())
  api.setPaused.mockReset()
  api.fetchRestart.mockReset().mockResolvedValue({ ready: true, requestedAt: null, handledAt: null, result: null })
  api.requestRestart.mockReset()
})

const stopButton = (name: string) => screen.getByRole('button', { name: `${name}の投稿を止める` })

describe('AutoPostHome（アプリを開いて最初の1画面）', () => {
  it('X・ディスコード・Yay の稼働スイッチを、1枚のカードに1行ずつ並べる（Xの下にディスコードとYay）', async () => {
    render(<AutoPostHome onOpenDetail={() => {}} />)

    expect(await screen.findByText('X自動運転の中身（summary）')).toBeInTheDocument()
    const card = screen.getByRole('region', { name: '稼働スイッチ' })
    await waitFor(() => expect(stopButton('ディスコード')).toBeEnabled())
    expect(stopButton('Yay')).toBeEnabled()
    expect(card).toContainElement(stopButton('ディスコード'))
    expect(card).toContainElement(stopButton('Yay'))
    expect(screen.getAllByText(/Macは動いています/)).toHaveLength(2)

    // 文の入力欄は、この画面には出さない（文を変えるのは詳細の画面）。普段は再起動の案内も出さない
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByText('投稿役を再起動する')).not.toBeInTheDocument()
  })

  it('ディスコードだけ止めても、Yay には触れない', async () => {
    api.setPaused.mockResolvedValue(channel({ channel: 'discord', paused: true, pausedAt: iso(1) }))
    render(<AutoPostHome onOpenDetail={() => {}} />)
    await waitFor(() => expect(stopButton('ディスコード')).toBeEnabled())

    fireEvent.click(stopButton('ディスコード'))

    await waitFor(() => expect(api.setPaused).toHaveBeenCalledWith('discord', true))
    expect(api.setPaused).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/停止を依頼しました/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ディスコードの停止を取り消す' })).toBeInTheDocument()
    expect(stopButton('Yay')).toBeEnabled() // Yay はそのまま動いている行のまま
  })

  it('止まっている投稿先は「再開」で戻せる', async () => {
    api.fetchSnapshots.mockResolvedValue({
      discord: channel({ channel: 'discord' }),
      yay: channel({ channel: 'yay', paused: true, pausedAt: iso(300), status: { lastPost: null, today: 4, at: iso(10), paused: true } }),
    })
    api.setPaused.mockResolvedValue(channel({ channel: 'yay' }))
    render(<AutoPostHome onOpenDetail={() => {}} />)

    expect(await screen.findByText(/停止中（/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Yayの投稿を再開する' }))

    await waitFor(() => expect(api.setPaused).toHaveBeenCalledWith('yay', false))
  })

  it('止める操作が失敗したら、その投稿先の行にだけ理由を出す', async () => {
    api.setPaused.mockRejectedValue(new Error('止める機能の準備がまだです'))
    render(<AutoPostHome onOpenDetail={() => {}} />)
    await waitFor(() => expect(stopButton('Yay')).toBeEnabled())

    fireEvent.click(stopButton('Yay'))

    expect(await screen.findByRole('alert')).toHaveTextContent('止める機能の準備がまだです')
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(stopButton('Yay')).toBeEnabled() // もう一度押せる
  })

  it('Mac から応答が途絶えていたら、いちばん上に再起動の案内を出す', async () => {
    api.fetchSnapshots.mockResolvedValue({
      discord: channel({ channel: 'discord', status: { lastPost: null, today: 2, at: iso(60 * 60) } }),
      yay: channel({ channel: 'yay' }),
    })
    render(<AutoPostHome onOpenDetail={() => {}} />)

    expect(await screen.findByText('投稿役が止まっているかもしれません')).toBeInTheDocument()
    expect(screen.getByText(/Macから応答がありません/)).toBeInTheDocument()
  })

  it('保存先（SQL 005）が無くても、X の部分は出したまま案内する', async () => {
    api.fetchSnapshots.mockRejectedValue(new Error('autopost_channels の読み込みに失敗しました'))
    render(<AutoPostHome onOpenDetail={() => {}} />)

    expect(await screen.findByText(/保存先がまだ用意されていません/)).toBeInTheDocument()
    expect(screen.getByText('X自動運転の中身（summary）')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /もう一度/ })).toBeInTheDocument()
  })

  it('ログインしていなければ、状態を出さずログインを促す', () => {
    auth.state = { session: null, loading: false, configured: true }
    render(<AutoPostHome onOpenDetail={() => {}} />)

    expect(screen.getByRole('button', { name: 'Googleでログイン' })).toBeInTheDocument()
    expect(api.fetchSnapshots).not.toHaveBeenCalled()
  })

  it('「文や回数を変える」で、詳細の画面を開く', async () => {
    const open = vi.fn()
    render(<AutoPostHome onOpenDetail={open} />)

    fireEvent.click(await screen.findByRole('button', { name: /文や回数を変える/ }))

    expect(open).toHaveBeenCalledTimes(1)
  })
})

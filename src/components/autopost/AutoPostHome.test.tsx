import type { ReactNode } from 'react'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
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
  saveMessages: vi.fn(),
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
    // 時間帯は、ことわりが無ければ全部の文が終日。いまの時間は全部の文が使われている
    hours: (patch.messages ?? ['文']).map(() => null),
    schedule: { hour: 12, activeIndexes: (patch.messages ?? ['文']).map((_, i) => i), idle: false, nextHour: null },
    ...patch,
  }
}

const snapshots = (): Snapshots => ({
  discord: channel({ channel: 'discord' }),
  yay: channel({ channel: 'yay' }),
})

beforeEach(() => {
  localStorage.clear()
  auth.state = { session: {}, loading: false, configured: true }
  api.fetchSnapshots.mockReset().mockResolvedValue(snapshots())
  api.setPaused.mockReset()
  api.saveMessages.mockReset()
  api.fetchRestart.mockReset().mockResolvedValue({ ready: true, requestedAt: null, handledAt: null, result: null })
  api.requestRestart.mockReset()
})

// 行ごとのオンオフのスイッチ。オン（aria-checked=true）は動いている。
const toggleOf = (name: string) => screen.getByRole('switch', { name: `${name}の自動投稿` })
const stopButton = toggleOf

describe('AutoPostHome（アプリを開いて最初の1画面）', () => {
  it('X・ディスコード・Yay の稼働スイッチを、1枚のカードに1行ずつ並べる（Xの下にディスコードとYay）', async () => {
    render(<AutoPostHome onOpenDetail={() => {}} />)

    expect(await screen.findByText('X自動運転の中身（summary）')).toBeInTheDocument()
    const card = screen.getByRole('region', { name: '稼働スイッチ' })
    await waitFor(() => expect(stopButton('ディスコード')).toBeEnabled())
    expect(stopButton('Yay')).toBeEnabled()
    expect(card).toContainElement(stopButton('ディスコード'))
    expect(card).toContainElement(stopButton('Yay'))
    expect(toggleOf('ディスコード')).toHaveAttribute('aria-checked', 'true')
    expect(toggleOf('Yay')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getAllByText(/今日3件/)).toHaveLength(2)

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
    // 停止を頼んだところ: スイッチはオフ・受け取り待ち。もう一度押すと停止を取り消せる
    expect(toggleOf('ディスコード')).toHaveAttribute('aria-checked', 'false')
    expect(toggleOf('ディスコード')).toHaveAttribute('aria-busy', 'true')
    expect(stopButton('Yay')).toBeEnabled() // Yay はそのまま動いている行のまま
  })

  it('押した瞬間にスイッチが切り替わる（サーバーの返事を待たない）。失敗したら元に戻して理由を出す', async () => {
    let fail: (err: Error) => void = () => {}
    api.setPaused.mockReturnValue(new Promise((_, reject) => (fail = reject)))
    render(<AutoPostHome onOpenDetail={() => {}} />)
    await waitFor(() => expect(toggleOf('Yay')).toBeEnabled())

    fireEvent.click(toggleOf('Yay'))

    // 返事はまだ来ていないが、もうオフに見えている（受け取り待ちの点滅つき）
    expect(toggleOf('Yay')).toHaveAttribute('aria-checked', 'false')
    expect(toggleOf('Yay')).toHaveAttribute('aria-busy', 'true')

    fail(new Error('通信に失敗しました'))
    expect(await screen.findByRole('alert')).toHaveTextContent('通信に失敗しました')
    expect(toggleOf('Yay')).toHaveAttribute('aria-checked', 'true')
  })

  it('止まっている投稿先は「再開」で戻せる', async () => {
    api.fetchSnapshots.mockResolvedValue({
      discord: channel({ channel: 'discord' }),
      yay: channel({ channel: 'yay', paused: true, pausedAt: iso(300), status: { lastPost: null, today: 4, at: iso(10), paused: true } }),
    })
    api.setPaused.mockResolvedValue(channel({ channel: 'yay' }))
    render(<AutoPostHome onOpenDetail={() => {}} />)

    expect(await screen.findByText(/停止中（/)).toBeInTheDocument()
    expect(toggleOf('Yay')).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(toggleOf('Yay'))

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

  it('トップは1行ずつのスイッチだけ。いま投稿している文・過去の文の選び方は出さない（文を変える画面にある）', async () => {
    api.fetchSnapshots.mockResolvedValue({
      discord: channel({ channel: 'discord', messages: ['ディスコードの文'], archive: ['ディスコードの昔の文'] }),
      yay: channel({ channel: 'yay', messages: ['Yayの文'], archive: ['Yayの昔の文'] }),
    })
    render(<AutoPostHome onOpenDetail={() => {}} />)

    await waitFor(() => expect(stopButton('ディスコード')).toBeEnabled())
    expect(screen.queryByText('ディスコードの文')).not.toBeInTheDocument()
    expect(screen.queryByText('Yayの文')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('トップに「文や回数を変える」の入口カードは置かない（設定・右下のメニューから開く）', async () => {
    render(<AutoPostHome onOpenDetail={() => {}} />)
    await waitFor(() => expect(stopButton('ディスコード')).toBeEnabled())

    expect(screen.queryByRole('button', { name: /文や回数を変える/ })).not.toBeInTheDocument()
  })

  it('「文」でポップアップが開き、いまの文を見て、直して保存できる', async () => {
    api.fetchSnapshots.mockResolvedValue({
      discord: channel({ channel: 'discord', messages: ['いまの募集の文'], version: 7 }),
      yay: channel({ channel: 'yay' }),
    })
    api.saveMessages.mockResolvedValue(channel({ channel: 'discord', messages: ['直した募集の文'], version: 8 }))
    render(<AutoPostHome onOpenDetail={() => {}} />)

    fireEvent.click(await screen.findByRole('button', { name: 'ディスコードの文を見る・直す' }))
    const sheet = screen.getByRole('dialog', { name: 'ディスコードの文' })
    const box = within(sheet).getByRole('textbox', { name: '投稿する文' })
    expect(box).toHaveValue('いまの募集の文')
    expect(within(sheet).getByRole('button', { name: '保存する' })).toBeDisabled()

    fireEvent.change(box, { target: { value: '直した募集の文' } })
    fireEvent.click(within(sheet).getByRole('button', { name: '保存する' }))

    await waitFor(() => expect(api.saveMessages).toHaveBeenCalledWith('discord', ['直した募集の文'], 7, [null]))
    expect(await within(sheet).findByText(/保存しました/)).toBeInTheDocument()
  })

  it('ポップアップの「これまでの文」の「使う」で、上の欄に入る（押しただけでは保存しない）', async () => {
    api.fetchSnapshots.mockResolvedValue({
      discord: channel({ channel: 'discord', messages: ['いまの文'], archive: ['前の文'] }),
      yay: channel({ channel: 'yay' }),
    })
    render(<AutoPostHome onOpenDetail={() => {}} />)

    fireEvent.click(await screen.findByRole('button', { name: 'ディスコードの文を見る・直す' }))
    const sheet = screen.getByRole('dialog', { name: 'ディスコードの文' })
    fireEvent.click(within(sheet).getByRole('button', { name: '「前の文」を使う' }))

    expect(within(sheet).getByRole('textbox', { name: '投稿する文' })).toHaveValue('前の文')
    expect(within(sheet).getByRole('button', { name: '保存する' })).toBeEnabled()
    expect(api.saveMessages).not.toHaveBeenCalled()
  })

  it('ポップアップは×で閉じる', async () => {
    render(<AutoPostHome onOpenDetail={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Yayの文を見る・直す' }))
    expect(screen.getByRole('dialog', { name: 'Yayの文' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    expect(screen.queryByRole('dialog', { name: 'Yayの文' })).not.toBeInTheDocument()
  })

  it('設定でトップから外した投稿先は、行を出さない', async () => {
    localStorage.setItem('sns-top-shown', JSON.stringify({ x: true, discord: false, yay: true }))
    render(<AutoPostHome onOpenDetail={() => {}} />)

    await waitFor(() => expect(toggleOf('Yay')).toBeEnabled())
    expect(screen.queryByRole('switch', { name: 'ディスコードの自動投稿' })).not.toBeInTheDocument()
  })

  it('3つとも外していたら、何も無い画面にせず、戻し方を出す', async () => {
    localStorage.setItem('sns-top-shown', JSON.stringify({ x: false, discord: false, yay: false }))
    render(<AutoPostHome onOpenDetail={() => {}} />)

    expect(await screen.findByText('トップに出す投稿先がありません。')).toBeInTheDocument()
    expect(screen.queryByText(/X自動運転の中身/)).not.toBeInTheDocument()
  })
})

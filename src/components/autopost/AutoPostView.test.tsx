import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AutoPostView } from './AutoPostView'
import type { ChannelSnapshot, Snapshots } from '../../lib/autopost/api'
import { isEditing, resetEditingGuardsForTest } from '../../lib/editingGuard'

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
  saveMessages: vi.fn(),
  setPaused: vi.fn(),
}))
vi.mock('../../lib/autopost/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/autopost/api')>()),
  fetchSnapshots: api.fetchSnapshots,
  saveMessages: api.saveMessages,
  setPaused: api.setPaused,
}))

// SaveConflictError は本物を使う（画面が instanceof で見分けているため）。
import { SaveConflictError } from '../../lib/autopost/api'

function channel(patch: Partial<ChannelSnapshot> & Pick<ChannelSnapshot, 'channel'>): ChannelSnapshot {
  return {
    messages: [],
    archive: [],
    version: 0,
    savedAt: null,
    status: null,
    paused: false,
    pausedAt: null,
    pauseReady: true,
    limits: { maxLength: 1000, maxMessages: patch.channel === 'yay' ? 1 : 10 },
    ...patch,
  }
}

function snapshots(): Snapshots {
  return {
    discord: channel({
      channel: 'discord',
      messages: ['保存してある文'],
      archive: ['前の文\n24'],
      version: 3,
      status: { lastPost: { t: new Date().toISOString(), text: '保存してある文' }, today: 12, at: new Date().toISOString() },
    }),
    yay: channel({ channel: 'yay', messages: ['やっほー'], version: 1 }),
  }
}

const box = () => screen.getByRole('textbox') as HTMLTextAreaElement

beforeEach(() => {
  auth.state = { session: {}, loading: false, configured: true }
  api.fetchSnapshots.mockReset().mockResolvedValue(snapshots())
  api.saveMessages.mockReset()
  api.setPaused.mockReset()
  resetEditingGuardsForTest()
  localStorage.clear()
  window.scrollTo = vi.fn() // jsdom には無い。履歴の文を選んだとき、画面の上へ戻すのに使う
})

describe('AutoPostView', () => {
  it('保存してある文と、Mac が動いている知らせを出す', async () => {
    render(<AutoPostView />)
    await waitFor(() => expect(box().value).toBe('保存してある文'))
    expect(screen.getByText(/Macは動いています/)).toBeInTheDocument()
    expect(screen.getByText(/今日12件/)).toBeInTheDocument()
    expect(screen.getByText('前の文 / 24')).toBeInTheDocument() // 履歴は改行を「 / 」にして1行で
  })

  it('ログインしていなければ、文を出さずログインを促す', async () => {
    auth.state = { session: null, loading: false, configured: true }
    render(<AutoPostView />)
    expect(screen.getByRole('button', { name: 'Googleでログイン' })).toBeInTheDocument()
    expect(api.fetchSnapshots).not.toHaveBeenCalled()
  })

  it('保存先の表（SQL 005）がまだ無ければ、その旨を案内する', async () => {
    api.fetchSnapshots.mockRejectedValue(new Error('autopost_channels の読み込みに失敗しました: relation does not exist'))
    render(<AutoPostView />)
    expect(await screen.findByText('自動投稿の保存先がまだ用意されていません。')).toBeInTheDocument()
    expect(screen.getByText(/005_autopost\.sql/)).toBeInTheDocument()
  })

  it('直すと保存できるようになり、見ていた版を添えて保存する', async () => {
    api.saveMessages.mockResolvedValue({ ...snapshots().discord, messages: ['直した文'], version: 4 })
    render(<AutoPostView />)
    await waitFor(() => expect(box().value).toBe('保存してある文'))

    const save = screen.getByRole('button', { name: '保存する' })
    expect(save).toBeDisabled()

    fireEvent.change(box(), { target: { value: '直した文' } })
    expect(save).toBeEnabled()
    expect(screen.getByText(/次の投稿から/)).toBeInTheDocument()

    fireEvent.click(save)
    await waitFor(() => expect(api.saveMessages).toHaveBeenCalledWith('discord', ['直した文'], 3))
    expect(await screen.findByText('保存しました（次の投稿から反映されます）')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存する' })).toBeDisabled() // 書きかけは手放した
  })

  it('空にすると保存できない', async () => {
    render(<AutoPostView />)
    await waitFor(() => expect(box().value).toBe('保存してある文'))
    fireEvent.change(box(), { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: '保存する' })).toBeDisabled()
  })

  it('別の端末で先に保存されていたら、書いた内容は消さずに知らせる', async () => {
    const newer = { ...snapshots().discord, messages: ['別の端末の文'], version: 4 }
    api.saveMessages.mockRejectedValue(new SaveConflictError('別の端末で先に更新されています', newer))
    render(<AutoPostView />)
    await waitFor(() => expect(box().value).toBe('保存してある文'))

    fireEvent.change(box(), { target: { value: '自分が書いた文' } })
    fireEvent.click(screen.getByRole('button', { name: '保存する' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('別の端末で先に更新されています')
    expect(box().value).toBe('自分が書いた文')

    // 取り込んだ最新の版で、もう一度保存できる
    api.saveMessages.mockResolvedValue({ ...newer, messages: ['自分が書いた文'], version: 5 })
    fireEvent.click(screen.getByRole('button', { name: '保存する' }))
    await waitFor(() => expect(api.saveMessages).toHaveBeenLastCalledWith('discord', ['自分が書いた文'], 4))
  })

  it('投稿先を切り替えても書きかけは残り、未保存の印が付く', async () => {
    render(<AutoPostView />)
    await waitFor(() => expect(box().value).toBe('保存してある文'))
    fireEvent.change(box(), { target: { value: '書きかけ' } })

    fireEvent.click(screen.getByRole('tab', { name: /Yay/ }))
    expect(box().value).toBe('やっほー')
    expect(screen.getByRole('tab', { name: /ディスコード/ })).toHaveTextContent('●')

    fireEvent.click(screen.getByRole('tab', { name: /ディスコード/ }))
    expect(box().value).toBe('書きかけ')
  })

  it('Yay は文が1つだけなので、追加ボタンを出さない', async () => {
    render(<AutoPostView />)
    await waitFor(() => expect(box().value).toBe('保存してある文'))
    expect(screen.getByRole('button', { name: /順番に回す文を追加/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /Yay/ }))
    expect(screen.queryByRole('button', { name: /順番に回す文を追加/ })).not.toBeInTheDocument()
  })

  it('履歴の文を選ぶと書きかけになる（保存はまだしない）', async () => {
    render(<AutoPostView />)
    await waitFor(() => expect(box().value).toBe('保存してある文'))
    fireEvent.click(screen.getByRole('button', { name: 'この文にする' }))
    expect(box().value).toBe('前の文\n24')
    expect(api.saveMessages).not.toHaveBeenCalled()
  })

  it('書きかけの間は、更新バナーに「書きかけ」と申告する', async () => {
    render(<AutoPostView />)
    await waitFor(() => expect(box().value).toBe('保存してある文'))
    expect(isEditing()).toBe(false)
    fireEvent.change(box(), { target: { value: '書きかけ' } })
    expect(isEditing()).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '変更を取り消す' }))
    expect(isEditing()).toBe(false)
    expect(box().value).toBe('保存してある文')
  })

  describe('投稿を止める／再開する', () => {
    const iso = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60000).toISOString()
    const alive = (paused?: boolean) => ({
      lastPost: null,
      today: 1,
      at: iso(1),
      ...(paused === undefined ? {} : { paused }),
    })

    it('動いているときは「投稿を止める」を出し、押すと止める依頼を送る', async () => {
      api.setPaused.mockResolvedValue({ ...snapshots().discord, paused: true, pausedAt: iso(0) })
      render(<AutoPostView />)
      await waitFor(() => expect(box().value).toBe('保存してある文'))
      expect(screen.getByText('自動で投稿しています')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: '投稿を止める' }))
      await waitFor(() => expect(api.setPaused).toHaveBeenCalledWith('discord', true))
      // Mac がまだ受け取っていないので、「停止中」とは言わない
      expect(await screen.findByText('停止を依頼しました')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '停止を取り消す' })).toBeEnabled()
    })

    it('Mac が「止まっています」と報告したら「停止中」になり、再開できる', async () => {
      api.fetchSnapshots.mockResolvedValue({
        ...snapshots(),
        discord: channel({ channel: 'discord', messages: ['保存してある文'], version: 3, paused: true, pausedAt: iso(30), status: alive(true) }),
      })
      api.setPaused.mockResolvedValue({ ...snapshots().discord, paused: false, status: alive(true) })
      render(<AutoPostView />)

      expect(await screen.findByText(/^停止中（/)).toBeInTheDocument()
      expect(screen.getByText(/いまは停止中です。再開すると/)).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: '投稿を再開する' }))
      await waitFor(() => expect(api.setPaused).toHaveBeenCalledWith('discord', false))
      expect(await screen.findByText('再開を依頼しました')).toBeInTheDocument()
    })

    it('止めている投稿先は、別のタブからでも分かる印が付く', async () => {
      api.fetchSnapshots.mockResolvedValue({
        ...snapshots(),
        yay: channel({ channel: 'yay', messages: ['やっほー'], version: 1, paused: true, pausedAt: iso(5), status: alive(true) }),
      })
      render(<AutoPostView />)
      const yayTab = await screen.findByRole('tab', { name: /Yay/ })
      expect(yayTab).toHaveTextContent('停止中')
      expect(screen.getByRole('tab', { name: /ディスコード/ })).not.toHaveTextContent('停止中')
    })

    it('止めている間に文を直しても、「再開したあとの投稿から」と案内する', async () => {
      api.fetchSnapshots.mockResolvedValue({
        ...snapshots(),
        discord: channel({ channel: 'discord', messages: ['保存してある文'], version: 3, paused: true, pausedAt: iso(30), status: alive(true) }),
      })
      render(<AutoPostView />)
      await waitFor(() => expect(box().value).toBe('保存してある文'))
      fireEvent.change(box(), { target: { value: '直した文' } })
      expect(screen.getByText(/再開したあとの投稿から/)).toBeInTheDocument()
    })

    it('Mac から応答が無いまま依頼中なら、止まったと思わせず、その旨を伝える', async () => {
      api.fetchSnapshots.mockResolvedValue({
        ...snapshots(),
        discord: channel({
          channel: 'discord',
          messages: ['保存してある文'],
          version: 3,
          paused: true,
          pausedAt: iso(30),
          status: { lastPost: null, today: 1, at: iso(60) },
        }),
      })
      render(<AutoPostView />)
      expect(await screen.findByText('停止を依頼しました')).toBeInTheDocument()
      expect(screen.getByText(/Macから応答がありません。投稿役が止まっている/)).toBeInTheDocument()
    })

    it('止める操作が失敗したら、理由を出して、状態は変えない', async () => {
      api.setPaused.mockRejectedValue(new Error('止める機能の準備がまだです。Supabase の SQL Editor で supabase/sql/006_autopost_pause.sql を実行すると使えるようになります'))
      render(<AutoPostView />)
      await waitFor(() => expect(box().value).toBe('保存してある文'))
      fireEvent.click(screen.getByRole('button', { name: '投稿を止める' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('006_autopost_pause.sql')
      expect(screen.getByText('自動で投稿しています')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '投稿を止める' })).toBeEnabled() // もう一度押せる
    })

    it('表（SQL 006）がまだ無ければ、止めるボタンの代わりに案内を出す', async () => {
      api.fetchSnapshots.mockResolvedValue({
        discord: channel({ channel: 'discord', messages: ['保存してある文'], version: 3, pauseReady: false }),
        yay: channel({ channel: 'yay', messages: ['やっほー'], version: 1, pauseReady: false }),
      })
      render(<AutoPostView />)
      expect(await screen.findByText('止める機能は準備中です')).toBeInTheDocument()
      expect(screen.getByText(/006_autopost_pause\.sql/)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '投稿を止める' })).not.toBeInTheDocument()
      // 文の編集と保存は、これまでどおり使える
      expect(box().value).toBe('保存してある文')
    })

    it('Yay は、いま出ている投稿が残ることも伝える', async () => {
      render(<AutoPostView />)
      await waitFor(() => expect(box().value).toBe('保存してある文'))
      fireEvent.click(screen.getByRole('tab', { name: /Yay/ }))
      expect(await screen.findByText(/いま出ている投稿は消えずに残ります/)).toBeInTheDocument()
    })
  })
})

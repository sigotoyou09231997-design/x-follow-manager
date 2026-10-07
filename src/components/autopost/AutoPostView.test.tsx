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
}))
vi.mock('../../lib/autopost/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/autopost/api')>()),
  fetchSnapshots: api.fetchSnapshots,
  saveMessages: api.saveMessages,
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
})

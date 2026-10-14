import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChannelSnapshot } from '../../lib/autopost/api'

const api = vi.hoisted(() => ({ saveMessages: vi.fn() }))
vi.mock('../../lib/autopost/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/autopost/api')>()),
  saveMessages: api.saveMessages,
}))

import { SaveConflictError } from '../../lib/autopost/api'
import { ChannelTextRow } from './ChannelTextRow'

function snap(patch: Partial<ChannelSnapshot> = {}): ChannelSnapshot {
  return {
    channel: 'discord',
    messages: ['いまの文'],
    archive: ['前の文その1', '前の文その2\n2行目', 'いまの文'],
    version: 4,
    savedAt: null,
    status: null,
    paused: false,
    pausedAt: null,
    pauseReady: true,
    limits: { maxLength: 1000, maxMessages: 10 },
    ...patch,
  }
}

// 波かっこで囲う: mockReset() が返す関数を beforeEach の戻り値にすると、テストのあとの「後片付け」として呼ばれてしまう
beforeEach(() => {
  api.saveMessages.mockReset()
})
afterEach(cleanup)

const select = () => screen.getByRole('combobox', { name: 'ディスコードの過去の文' }) as HTMLSelectElement

describe('ChannelTextRow（トップの一番上の、いま投稿されている文）', () => {
  it('いま投稿されている文を出し、過去の文をドロップダウンに並べる（いま使っている文は並べない・改行は1行に）', () => {
    render(<ChannelTextRow snapshot={snap()} onChanged={() => {}} />)

    expect(screen.getByText('いまの文')).toBeInTheDocument()
    const options = Array.from(select().options).map((o) => o.textContent)
    expect(options).toEqual(['過去の文から選ぶ', '前の文その1', '前の文その2 / 2行目'])
  })

  it('選んだだけでは保存しない。「この文にする」を押すと、版を添えて保存し、返事を画面に取り込む', async () => {
    const next = snap({ messages: ['前の文その1'], version: 5 })
    api.saveMessages.mockResolvedValue(next)
    const onChanged = vi.fn()
    render(<ChannelTextRow snapshot={snap()} onChanged={onChanged} />)

    expect(screen.getByRole('button', { name: 'この文にする' })).toBeDisabled()
    fireEvent.change(select(), { target: { value: '0' } })
    expect(api.saveMessages).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'この文にする' }))
    await waitFor(() => expect(api.saveMessages).toHaveBeenCalledWith('discord', ['前の文その1'], 4))
    expect(onChanged).toHaveBeenCalledWith(next)
    expect(await screen.findByText(/切り替えました（次の投稿から/)).toBeInTheDocument()
  })

  it('順番に回す文が複数あって空きがあるときは、選んだ文を足す（詳細の画面と同じ決まり）', async () => {
    api.saveMessages.mockResolvedValue(snap())
    render(<ChannelTextRow snapshot={snap({ messages: ['A', 'B'] })} onChanged={() => {}} />)
    fireEvent.change(select(), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'この文にする' }))
    await waitFor(() => expect(api.saveMessages).toHaveBeenCalledWith('discord', ['A', 'B', '前の文その1'], 4))
  })

  it('回す文がいっぱいなら、保存せず、外してから選ぶよう伝える', async () => {
    const full = snap({ messages: ['A', 'B'], limits: { maxLength: 1000, maxMessages: 2 } })
    render(<ChannelTextRow snapshot={full} onChanged={() => {}} />)
    fireEvent.change(select(), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'この文にする' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('いっぱいです')
    expect(api.saveMessages).not.toHaveBeenCalled()
  })

  it('別の端末で先に保存されていたら、最新だけ取り込み、理由を出す', async () => {
    const latest = snap({ messages: ['別の端末の文'], version: 9 })
    api.saveMessages.mockRejectedValue(new SaveConflictError('別の端末で先に更新されています', latest))
    const received: ChannelSnapshot[] = []
    render(<ChannelTextRow snapshot={snap()} onChanged={(s) => received.push(s)} />)
    fireEvent.change(select(), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'この文にする' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('別の端末で先に更新されています')
    expect(received).toHaveLength(1)
    expect(received[0].version).toBe(9)
  })

  it('過去の文が無ければ、ドロップダウンの代わりに案内を出す', () => {
    render(<ChannelTextRow snapshot={snap({ archive: [] })} onChanged={() => {}} />)
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.getByText(/過去の文はまだありません/)).toBeInTheDocument()
  })

  it('文が1つも無ければ、その旨を出す', () => {
    render(<ChannelTextRow snapshot={snap({ messages: [] })} onChanged={() => {}} />)
    expect(screen.getByText(/まだ文がありません/)).toBeInTheDocument()
  })
})

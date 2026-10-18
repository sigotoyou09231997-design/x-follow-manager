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
    // 時間帯は、ことわりが無ければ全部の文が終日。いまの時間は全部の文が使われている
    hours: (patch.messages ?? ['いまの文']).map(() => null),
    schedule: { hour: 12, activeIndexes: (patch.messages ?? ['いまの文']).map((_, i) => i), idle: false, nextHour: null },
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
    await waitFor(() => expect(api.saveMessages).toHaveBeenCalledWith('discord', ['前の文その1'], 4, [null]))
    expect(onChanged).toHaveBeenCalledWith(next)
    expect(await screen.findByText(/切り替えました（次の投稿から/)).toBeInTheDocument()
  })

  it('順番に回す文が複数あって空きがあるときは、選んだ文を足す（詳細の画面と同じ決まり）', async () => {
    api.saveMessages.mockResolvedValue(snap())
    render(<ChannelTextRow snapshot={snap({ messages: ['A', 'B'] })} onChanged={() => {}} />)
    fireEvent.change(select(), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'この文にする' }))
    await waitFor(() => expect(api.saveMessages).toHaveBeenCalledWith('discord', ['A', 'B', '前の文その1'], 4, [null, null, null]))
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

  it('時間帯を決めた文には、その時間帯を添えて見せる', () => {
    render(
      <ChannelTextRow
        snapshot={snap({ messages: ['朝の文', '夜の文'], hours: [[6, 7, 8], null] })}
        onChanged={() => {}}
      />
    )
    expect(screen.getByText('6〜9時')).toBeInTheDocument()
    expect(screen.queryByText('終日')).not.toBeInTheDocument() // 決めていない文には何も付けない
  })

  it('文が1つのとき履歴から選び直しても、その文の時間帯は残る', async () => {
    api.saveMessages.mockResolvedValue(snap())
    render(<ChannelTextRow snapshot={snap({ messages: ['いまの文'], hours: [[9, 10]] })} onChanged={() => {}} />)
    fireEvent.change(select(), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'この文にする' }))
    await waitFor(() => expect(api.saveMessages).toHaveBeenCalledWith('discord', ['前の文その1'], 4, [[9, 10]]))
  })

  describe('その場で直す（編集）', () => {
    const openEdit = (label = 'ディスコードの投稿する文を編集') => fireEvent.click(screen.getByRole('button', { name: label }))
    const box = (label = 'ディスコードの投稿する文') => screen.getByRole('textbox', { name: label }) as HTMLTextAreaElement

    it('「編集」を押すと、その文の入力欄と時間帯が開く。押すまでは入力欄を出さない', () => {
      render(<ChannelTextRow snapshot={snap()} onChanged={() => {}} />)
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
      openEdit()
      expect(box().value).toBe('いまの文')
      expect(screen.getByRole('button', { name: /投稿する時間帯/ })).toBeInTheDocument()
    })

    it('文を書き換えて保存すると、版を添えて保存し、返事を画面に取り込む（時間帯は終日のまま）', async () => {
      const next = snap({ messages: ['書き換えた文'], version: 5 })
      api.saveMessages.mockResolvedValue(next)
      const onChanged = vi.fn()
      render(<ChannelTextRow snapshot={snap()} onChanged={onChanged} />)
      openEdit()
      fireEvent.change(box(), { target: { value: '書き換えた文' } })
      expect(api.saveMessages).not.toHaveBeenCalled() // 入力しただけでは保存しない
      fireEvent.click(screen.getByRole('button', { name: '保存する' }))
      await waitFor(() => expect(api.saveMessages).toHaveBeenCalledWith('discord', ['書き換えた文'], 4, [null]))
      expect(onChanged).toHaveBeenCalledWith(next)
      expect(await screen.findByText(/保存しました（次の投稿から/)).toBeInTheDocument()
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument() // 保存したら閉じる
    })

    it('時間帯を変えて保存できる。直した文だけが変わり、ほかの文と、その時間帯はそのまま', async () => {
      api.saveMessages.mockResolvedValue(snap())
      render(<ChannelTextRow snapshot={snap({ messages: ['朝の文', '夜の文'], hours: [[6, 7, 8], [20, 21]] })} onChanged={() => {}} />)
      openEdit('ディスコードの2つ目の文を編集')
      fireEvent.click(screen.getByRole('button', { name: /2つ目の文の投稿する時間帯/ }))
      fireEvent.click(screen.getByRole('button', { name: '22時台' })) // 20・21 に 22 を足す
      fireEvent.click(screen.getByRole('button', { name: '保存する' }))
      await waitFor(() =>
        expect(api.saveMessages).toHaveBeenCalledWith('discord', ['朝の文', '夜の文'], 4, [[6, 7, 8], [20, 21, 22]])
      )
    })

    it('「終日」に戻して保存すると、時間帯の指定が外れる', async () => {
      api.saveMessages.mockResolvedValue(snap())
      render(<ChannelTextRow snapshot={snap({ messages: ['朝の文'], hours: [[6, 7]] })} onChanged={() => {}} />)
      openEdit()
      fireEvent.click(screen.getByRole('button', { name: /投稿する時間帯/ }))
      fireEvent.click(screen.getByRole('button', { name: '終日' }))
      fireEvent.click(screen.getByRole('button', { name: '保存する' }))
      await waitFor(() => expect(api.saveMessages).toHaveBeenCalledWith('discord', ['朝の文'], 4, [null]))
    })

    it('文を空にすると保存しない（外すのは詳細の画面）', async () => {
      render(<ChannelTextRow snapshot={snap()} onChanged={() => {}} />)
      openEdit()
      fireEvent.change(box(), { target: { value: '   ' } })
      fireEvent.click(screen.getByRole('button', { name: '保存する' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('文が空です')
      expect(api.saveMessages).not.toHaveBeenCalled()
      expect(box()).toBeInTheDocument() // 書きかけは残す
    })

    it('長すぎる文は保存しない', async () => {
      render(<ChannelTextRow snapshot={snap({ limits: { maxLength: 5, maxMessages: 10 } })} onChanged={() => {}} />)
      openEdit()
      fireEvent.change(box(), { target: { value: '123456' } })
      fireEvent.click(screen.getByRole('button', { name: '保存する' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('長すぎます（5文字まで）')
      expect(api.saveMessages).not.toHaveBeenCalled()
    })

    it('時間を1つも選んでいない時間帯は保存しない', async () => {
      render(<ChannelTextRow snapshot={snap({ messages: ['朝の文'], hours: [[9]] })} onChanged={() => {}} />)
      openEdit()
      fireEvent.click(screen.getByRole('button', { name: /投稿する時間帯/ }))
      fireEvent.click(screen.getByRole('button', { name: '9時台' })) // 唯一の 9 を外して空にする
      fireEvent.click(screen.getByRole('button', { name: '保存する' }))
      expect(api.saveMessages).not.toHaveBeenCalled()
      expect(screen.getAllByRole('alert').map((n) => n.textContent).join()).toContain('1時間以上')
    })

    it('何も変えずに保存を押したら、保存せずに閉じる（版を無駄に進めない）', () => {
      render(<ChannelTextRow snapshot={snap()} onChanged={() => {}} />)
      openEdit()
      fireEvent.click(screen.getByRole('button', { name: '保存する' }))
      expect(api.saveMessages).not.toHaveBeenCalled()
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    })

    it('「やめる」で書きかけを捨てる。保存はしない', () => {
      render(<ChannelTextRow snapshot={snap()} onChanged={() => {}} />)
      openEdit()
      fireEvent.change(box(), { target: { value: '捨てる文' } })
      fireEvent.click(screen.getByRole('button', { name: 'やめる' }))
      expect(api.saveMessages).not.toHaveBeenCalled()
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
      expect(screen.getByText('いまの文')).toBeInTheDocument()
    })

    it('別の端末で先に保存されていたら、最新だけ取り込み、書いた内容は消さない', async () => {
      const latest = snap({ messages: ['別の端末の文'], version: 9 })
      api.saveMessages.mockRejectedValue(new SaveConflictError('別の端末で先に更新されています', latest))
      const received: ChannelSnapshot[] = []
      render(<ChannelTextRow snapshot={snap()} onChanged={(s) => received.push(s)} />)
      openEdit()
      fireEvent.change(box(), { target: { value: '自分で書いた文' } })
      fireEvent.click(screen.getByRole('button', { name: '保存する' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('別の端末で先に更新されています')
      expect(received).toEqual([latest])
      expect(box().value).toBe('自分で書いた文')
    })

    it('書いているあいだは、ほかの文の「編集」は押せない（二つ同時に直さない）', () => {
      render(<ChannelTextRow snapshot={snap({ messages: ['A', 'B'] })} onChanged={() => {}} />)
      openEdit('ディスコードの1つ目の文を編集')
      expect(screen.getByRole('button', { name: 'ディスコードの2つ目の文を編集' })).toBeDisabled()
    })

    it('書いているあいだは、更新バナーが読み込み直さないよう「書きかけ」と申告する', async () => {
      const { isEditing } = await import('../../lib/editingGuard')
      const view = render(<ChannelTextRow snapshot={snap()} onChanged={() => {}} />)
      expect(isEditing()).toBe(false)
      openEdit()
      expect(isEditing()).toBe(true)
      fireEvent.click(screen.getByRole('button', { name: 'やめる' }))
      expect(isEditing()).toBe(false)
      view.unmount()
    })
  })
})

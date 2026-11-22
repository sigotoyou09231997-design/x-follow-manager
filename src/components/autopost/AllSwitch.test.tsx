import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AllSwitch, type XControls } from './AllSwitch'
import type { ChannelSnapshot, Snapshots } from '../../lib/autopost/api'

const api = vi.hoisted(() => ({ setPaused: vi.fn() }))
vi.mock('../../lib/autopost/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/autopost/api')>()),
  ...api,
}))

function channel(patch: Partial<ChannelSnapshot> & Pick<ChannelSnapshot, 'channel'>): ChannelSnapshot {
  return {
    messages: ['文'],
    archive: [],
    version: 1,
    savedAt: null,
    status: { lastPost: null, today: 3, at: new Date().toISOString() },
    paused: false,
    pausedAt: null,
    pauseReady: true,
    limits: { maxLength: 1000, maxMessages: 10 },
    hours: [null],
    schedule: { hour: 12, activeIndexes: [0], idle: false, nextHour: null },
    ...patch,
  }
}

const running = (): Snapshots => ({ discord: channel({ channel: 'discord' }), yay: channel({ channel: 'yay' }) })

function xControls(patch: Partial<XControls> = {}): XControls {
  return { enabled: true, ready: true, stop: vi.fn().mockResolvedValue(undefined), start: vi.fn().mockResolvedValue(undefined), ...patch }
}

const stopAll = () => screen.getByRole('button', { name: 'すべての自動投稿を止める' })
const resumeAll = () => screen.getByRole('button', { name: 'すべての自動投稿を再開する' })

beforeEach(() => {
  localStorage.clear()
  api.setPaused.mockReset().mockImplementation(async (name: 'discord' | 'yay', paused: boolean) => channel({ channel: name, paused }))
})

describe('AllSwitch（すべての自動投稿をまとめて止める・再開）', () => {
  it('動いているものがあれば「すべて止める」。X・ディスコード・Yay を1回で止める', async () => {
    const x = xControls()
    const onChanged = vi.fn()
    render(<AllSwitch x={x} snapshots={running()} onChanged={onChanged} />)

    expect(screen.getByText('X・ディスコード・Yay が動いています')).toBeInTheDocument()
    fireEvent.click(stopAll())

    await waitFor(() => expect(x.stop).toHaveBeenCalledTimes(1))
    expect(api.setPaused).toHaveBeenCalledWith('discord', true)
    expect(api.setPaused).toHaveBeenCalledWith('yay', true)
    expect(onChanged).toHaveBeenCalledTimes(2)
    expect(await screen.findByText('X・ディスコード・Yay を止めました')).toBeInTheDocument()
  })

  it('X が自動運転中のあいだだけ、予約が取り消されることを先に知らせる', () => {
    const { rerender } = render(<AllSwitch x={xControls()} snapshots={running()} onChanged={() => {}} />)
    expect(screen.getByText(/まだ出ていない予約を取り消します/)).toBeInTheDocument()

    rerender(<AllSwitch x={xControls({ enabled: false })} snapshots={running()} onChanged={() => {}} />)
    expect(screen.queryByText(/まだ出ていない予約を取り消します/)).not.toBeInTheDocument()
  })

  it('1つ失敗しても、ほかは止める。失敗したものの理由を出す', async () => {
    const x = xControls({ stop: vi.fn().mockResolvedValue('ほかの操作を実行中です') })
    render(<AllSwitch x={x} snapshots={running()} onChanged={() => {}} />)

    fireEvent.click(stopAll())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('ディスコード・Yay は止めました')
    expect(alert).toHaveTextContent('X: ほかの操作を実行中です')
    expect(api.setPaused).toHaveBeenCalledTimes(2)
  })

  it('全部止まったら「すべて再開」に変わり、止めたものだけを戻す', async () => {
    const x = xControls()
    const onChanged = vi.fn()
    const { rerender } = render(<AllSwitch x={x} snapshots={running()} onChanged={onChanged} />)
    fireEvent.click(stopAll())
    await screen.findByText('X・ディスコード・Yay を止めました')

    // 画面の状態が「止まっている」に変わったところ
    const stopped: Snapshots = {
      discord: channel({ channel: 'discord', paused: true }),
      yay: channel({ channel: 'yay', paused: true }),
    }
    rerender(<AllSwitch x={{ ...x, enabled: false }} snapshots={stopped} onChanged={onChanged} />)
    expect(screen.getByText('すべて止まっています')).toBeInTheDocument()
    api.setPaused.mockClear()

    fireEvent.click(resumeAll())

    await waitFor(() => expect(x.start).toHaveBeenCalledTimes(1))
    expect(api.setPaused).toHaveBeenCalledWith('discord', false)
    expect(api.setPaused).toHaveBeenCalledWith('yay', false)
    expect(await screen.findByText('X・ディスコード・Yay を再開しました')).toBeInTheDocument()
  })

  it('もともと止めてあった X は、「すべて再開」で勝手に始めない（始めると AI の費用がかかる）', async () => {
    const x = xControls({ enabled: false })
    const onChanged = vi.fn()
    const { rerender } = render(<AllSwitch x={x} snapshots={running()} onChanged={onChanged} />)
    fireEvent.click(stopAll())
    await screen.findByText('ディスコード・Yay を止めました')
    expect(x.stop).not.toHaveBeenCalled()

    rerender(
      <AllSwitch
        x={x}
        snapshots={{ discord: channel({ channel: 'discord', paused: true }), yay: channel({ channel: 'yay', paused: true }) }}
        onChanged={onChanged}
      />
    )
    fireEvent.click(resumeAll())

    await waitFor(() => expect(api.setPaused).toHaveBeenCalledWith('yay', false))
    expect(x.start).not.toHaveBeenCalled()
  })

  it('「すべて止める」を押していない（覚えが無い）ときの再開は、止まっている投稿先だけ戻す', async () => {
    const x = xControls({ enabled: false })
    render(
      <AllSwitch
        x={x}
        snapshots={{ discord: channel({ channel: 'discord', paused: true }), yay: channel({ channel: 'yay', paused: true }) }}
        onChanged={() => {}}
      />
    )

    fireEvent.click(resumeAll())

    await waitFor(() => expect(api.setPaused).toHaveBeenCalledTimes(2))
    expect(x.start).not.toHaveBeenCalled()
  })

  it('X の連携がまだなら、再開でも X は始めず理由を出す', async () => {
    const x = xControls({ enabled: true, ready: false })
    const { rerender } = render(<AllSwitch x={x} snapshots={running()} onChanged={() => {}} />)
    fireEvent.click(stopAll())
    await screen.findByText(/止めました/)

    rerender(
      <AllSwitch
        x={{ ...x, enabled: false }}
        snapshots={{ discord: channel({ channel: 'discord', paused: true }), yay: channel({ channel: 'yay', paused: true }) }}
        onChanged={() => {}}
      />
    )
    fireEvent.click(resumeAll())

    expect(await screen.findByRole('alert')).toHaveTextContent('X: Xとの連携と文体のまとめがまだです')
    expect(x.start).not.toHaveBeenCalled()
  })

  it('ディスコード・Yay が読めていなくても、X だけは止められる', async () => {
    const x = xControls()
    render(<AllSwitch x={x} snapshots={null} onChanged={() => {}} />)

    fireEvent.click(stopAll())

    await waitFor(() => expect(x.stop).toHaveBeenCalledTimes(1))
    expect(api.setPaused).not.toHaveBeenCalled()
  })
})

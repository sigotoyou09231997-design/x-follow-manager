import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UpdateBanner } from './UpdateBanner'
import { markUpdateAvailable, resetUpdateStateForTest, setUpdateApplier } from '../lib/pwaUpdate'
import { registerEditingGuard, resetEditingGuardsForTest } from '../lib/editingGuard'

describe('UpdateBanner', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetUpdateStateForTest()
    resetEditingGuardsForTest()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('更新が来るまでは何も出さない', () => {
    render(<UpdateBanner />)
    expect(screen.queryByText('アップデートが来ています')).not.toBeInTheDocument()
  })

  it('更新が来たら帯を出し、そのまま最新版へ切り替える', async () => {
    const apply = vi.fn().mockResolvedValue(undefined)
    setUpdateApplier(apply)
    render(<UpdateBanner />)

    act(() => markUpdateAvailable())
    expect(screen.getByText('アップデートが来ています')).toBeInTheDocument()
    expect(apply).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(apply).toHaveBeenCalled()
  })

  // 予約投稿の本文は保存前だと画面の中にしか無い。リロードで消してはいけない。
  it('書きかけの入力があるあいだは切り替えを待つ', async () => {
    const apply = vi.fn().mockResolvedValue(undefined)
    setUpdateApplier(apply)
    let editing = true
    registerEditingGuard(() => editing)

    render(<UpdateBanner />)
    act(() => markUpdateAvailable())

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(apply).not.toHaveBeenCalled()
    expect(screen.getByText('入力が終わったら切り替えます')).toBeInTheDocument()

    // 書き終われば（保存や破棄で判定が偽になれば）切り替わる
    editing = false
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(apply).toHaveBeenCalled()
  })
})

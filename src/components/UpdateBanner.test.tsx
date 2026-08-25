import { act, fireEvent, render, screen } from '@testing-library/react'
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

  // 以前は5分で諦めて適用していたが、適用＝リロードなので、まだ書いている人の
  // 本文をこの帯自身が消してしまう。書いているあいだは待ち続ける。
  it('長く書いていても、勝手に切り替えて入力を捨てない', async () => {
    const apply = vi.fn().mockResolvedValue(undefined)
    setUpdateApplier(apply)
    registerEditingGuard(() => true)

    render(<UpdateBanner />)
    act(() => markUpdateAvailable())

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30 * 60_000)
    })
    expect(apply).not.toHaveBeenCalled()
    expect(screen.getByText('入力が終わったら切り替えます')).toBeInTheDocument()
  })

  it('待っている間は「今すぐ更新」で自分から切り替えられる', async () => {
    const apply = vi.fn().mockResolvedValue(undefined)
    setUpdateApplier(apply)
    registerEditingGuard(() => true)

    render(<UpdateBanner />)
    act(() => markUpdateAvailable())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '今すぐ更新' }))
    })
    expect(apply).toHaveBeenCalled()
  })
})

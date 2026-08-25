import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComposerSheet } from './ComposerSheet'

/**
 * ソフトキーボードが出ている状態を作る。
 * iOSはキーボードが出てもレイアウトビューポートを縮めないので、
 * 「実際に見えている範囲」は visualViewport からしか分からない。
 */
function fakeViewport(height: number, offsetTop = 0) {
  const listeners = new Set<() => void>()
  const viewport = {
    height,
    offsetTop,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    /** キーボードの開閉を起こす。 */
    set(next: { height: number; offsetTop?: number }) {
      viewport.height = next.height
      viewport.offsetTop = next.offsetTop ?? 0
      listeners.forEach((fn) => fn())
    },
  }
  Object.defineProperty(window, 'visualViewport', {
    value: viewport,
    configurable: true,
    writable: true,
  })
  return viewport
}

describe('ComposerSheet', () => {
  it('投稿画面を前面に出す', () => {
    render(<ComposerSheet onClose={() => {}} onSaved={() => {}} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('いまどうしてる？')).toBeInTheDocument()
    // 開いている間は後ろの一覧を動かさない
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('閉じると背景のスクロールを元に戻す', () => {
    const { unmount } = render(<ComposerSheet onClose={() => {}} onSaved={() => {}} />)
    unmount()
    expect(document.body.style.overflow).toBe('')
  })

  it('暗い背景を触ると閉じる', () => {
    const onClose = vi.fn()
    render(<ComposerSheet onClose={onClose} onSaved={() => {}} />)
    fireEvent.mouseDown(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalled()
  })

  // 本文を書いている途中に画面の内側を触っただけで閉じてしまうと、書きかけが消える。
  it('中身を触っても閉じない', () => {
    const onClose = vi.fn()
    render(<ComposerSheet onClose={onClose} onSaved={() => {}} />)
    fireEvent.mouseDown(screen.getByPlaceholderText('いまどうしてる？'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Escで閉じる', () => {
    const onClose = vi.fn()
    render(<ComposerSheet onClose={onClose} onSaved={() => {}} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})

// キーボードが出ると、シートの下端＝画面の下端はキーボードの裏に潜る。
// そこに「予約する」を貼り付けてあるので、書き終わったのに予約できなくなる。
describe('ComposerSheet: ソフトキーボードとの重なり', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'visualViewport')
  })

  it('見えている範囲の高さに合わせる', () => {
    fakeViewport(800)
    render(<ComposerSheet onClose={() => {}} onSaved={() => {}} />)

    const sheet = screen.getByRole('dialog')
    expect(sheet.style.getPropertyValue('--sheet-height')).toBe('800px')
    expect(sheet.style.getPropertyValue('--sheet-top')).toBe('0px')
  })

  it('キーボードが出たら、その分だけ縮む', () => {
    const viewport = fakeViewport(800)
    render(<ComposerSheet onClose={() => {}} onSaved={() => {}} />)
    const sheet = screen.getByRole('dialog')

    act(() => viewport.set({ height: 380 }))
    expect(sheet.style.getPropertyValue('--sheet-height')).toBe('380px')

    // 閉じれば元の高さに戻る
    act(() => viewport.set({ height: 800 }))
    expect(sheet.style.getPropertyValue('--sheet-height')).toBe('800px')
  })

  // ブラウザがキーボードを避けて画面ごと押し上げることがある。その分ずらさないと、
  // シートの上端が画面の外へ出て見出しと×が消える。
  it('画面ごと押し上げられた分だけ、位置を合わせる', () => {
    const viewport = fakeViewport(800)
    render(<ComposerSheet onClose={() => {}} onSaved={() => {}} />)
    const sheet = screen.getByRole('dialog')

    act(() => viewport.set({ height: 380, offsetTop: 120 }))
    expect(sheet.style.getPropertyValue('--sheet-top')).toBe('120px')
  })

  it('visualViewportが無いブラウザでも開ける', () => {
    Reflect.deleteProperty(window, 'visualViewport')
    render(<ComposerSheet onClose={() => {}} onSaved={() => {}} />)

    const sheet = screen.getByRole('dialog')
    expect(sheet).toBeInTheDocument()
    // 値を入れない＝CSS側の既定値（画面全体）のまま
    expect(sheet.style.getPropertyValue('--sheet-height')).toBe('')
  })
})

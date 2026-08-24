import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ComposerSheet } from './ComposerSheet'

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

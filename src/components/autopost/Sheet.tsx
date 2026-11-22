import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../Icon'

interface Props {
  title: string
  onClose: () => void
  children: ReactNode
}

/**
 * 前面にかぶせて出す画面（スマホでは下から、PCでは中央）。見た目は予約投稿のシート（.composer-sheet）と同じ。
 *
 * body の直下へ出す（portal）。トップの中身は出てくる動き（transform）を持っているので、その中に置くと
 * position: fixed が画面ではなく親の箱に合わさってしまい、シートが行の中に小さく閉じ込められる。
 */
export function Sheet({ title, onClose, children }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  // 開いている間は、右下の丸いメニューボタンを隠す（シートの上に重なり、入力中はキーボードの上に浮いて邪魔だった）。
  useEffect(() => {
    document.body.classList.add('sheet-open')
    return () => document.body.classList.remove('sheet-open')
  }, [])

  // 入力欄にふれてキーボードが出たら、その欄がシートの見えている範囲に入るまで、シートの中だけをスクロールする。
  // しないと、キーボードの分だけシートが縮んだとき、ふれた欄が下へずれてキーボードの裏に隠れた（iPhone）。
  // scrollIntoView は使わない（後ろの画面ごと動かしてしまい、シートの位置がずれる）。
  useEffect(() => {
    const body = bodyRef.current
    if (!body) return
    let timer: ReturnType<typeof setTimeout> | undefined

    function reveal() {
      const field = document.activeElement
      if (!body || !(field instanceof HTMLElement) || !body.contains(field)) return
      if (!field.matches('textarea, input, select')) return
      const box = body.getBoundingClientRect()
      const rect = field.getBoundingClientRect()
      const margin = 16
      // 欄が見えている範囲に収まらないほど高ければ、欄の上の端を見せる（打っている行はたいてい上の方なので）
      if (rect.top < box.top + margin || rect.height > box.height - margin * 2) {
        body.scrollTop += rect.top - box.top - margin
      } else if (rect.bottom > box.bottom - margin) {
        body.scrollTop += rect.bottom - box.bottom + margin
      }
    }
    function later() {
      if (timer) clearTimeout(timer)
      // キーボードが出きって、シートが縮み終わってから測る
      timer = setTimeout(reveal, 320)
    }

    body.addEventListener('focusin', later)
    window.visualViewport?.addEventListener('resize', later)
    return () => {
      if (timer) clearTimeout(timer)
      body.removeEventListener('focusin', later)
      window.visualViewport?.removeEventListener('resize', later)
    }
  }, [])

  // 開いている間は後ろの画面を動かさない。閉じたら元に戻す。
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  // ソフトキーボードが出ている分だけ、シートを縮めて上に載せる（予約投稿のシートと同じ理由。保存ボタンがキーボードの裏に入らないように）。
  useEffect(() => {
    const viewport = window.visualViewport
    const element = rootRef.current
    if (!viewport || !element) return
    function sync() {
      if (!viewport || !element) return
      element.style.setProperty('--sheet-top', `${viewport.offsetTop}px`)
      element.style.setProperty('--sheet-height', `${viewport.height}px`)
    }
    sync()
    viewport.addEventListener('resize', sync)
    viewport.addEventListener('scroll', sync)
    return () => {
      viewport.removeEventListener('resize', sync)
      viewport.removeEventListener('scroll', sync)
    }
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return createPortal(
    <div
      ref={rootRef}
      className="composer-sheet text-sheet"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      // 背景（暗い部分）を触ったときだけ閉じる。中身のクリックでは閉じない。
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="composer-sheet__panel">
        <div className="composer-sheet__grip" aria-hidden="true" />
        <div className="composer-sheet__bar">
          <span className="composer-sheet__title">{title}</span>
          <button type="button" className="composer-sheet__close" onClick={onClose} aria-label="閉じる">
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="text-sheet__body" ref={bodyRef}>
          {children}
        </div>
      </div>
    </div>,
    document.body
  )
}

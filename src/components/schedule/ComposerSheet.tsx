import { useEffect, useRef } from 'react'
import { PostComposer } from './PostComposer'

interface Props {
  onClose: () => void
  onSaved: () => void
  onDraftsAdded?: () => void
}

/**
 * 下部バー中央の＋から開く、かぶせて出す投稿画面。
 *
 * 予約投稿タブの中に開くコンポーザーは「一覧を見ながら書く」ための面なのに対し、
 * こちらは＋を押した勢いのまま書き切るための面なので、一覧を暗くして前に出し、
 * 「予約する」を常に手の届く位置（下端）に置いている。
 */
export function ComposerSheet({ onClose, onSaved, onDraftsAdded }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)

  // 開いている間は後ろの一覧を動かさない。閉じたら元に戻す。
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  // ソフトキーボードが出ている分だけ、シートを縮めて上に載せる。
  //
  // iOS(と多くのモバイルブラウザ)は、キーボードが出てもレイアウトビューポートを
  // 縮めない。position:fixed の inset:0 や 100dvh は画面全体のままなので、
  // 下端に貼り付けた「予約する」がキーボードの裏に入り、指が届かなくなる
  // （書き終わったのに予約できない、という一番困る形で詰まる）。
  // 実際に見えている範囲は visualViewport が教えてくれるので、その高さと位置に合わせる。
  useEffect(() => {
    const viewport = window.visualViewport
    const element = rootRef.current
    if (!viewport || !element) return

    function sync() {
      if (!viewport || !element) return
      // offsetTop は、キーボードを避けるためにブラウザが画面ごと押し上げた量。
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

  // Escで閉じる。書きかけを一瞬で捨てないよう、確認を挟むのは呼び出し側の責任。
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  // 開いたらすぐ書き始められるようにする。
  useEffect(() => {
    sheetRef.current?.querySelector('textarea')?.focus()
  }, [])

  return (
    <div
      ref={rootRef}
      className="composer-sheet"
      role="dialog"
      aria-modal="true"
      aria-label="新しい投稿"
      // 背景（暗い部分）を触ったときだけ閉じる。中身のクリックでは閉じない。
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="composer-sheet__panel" ref={sheetRef}>
        <div className="composer-sheet__grip" aria-hidden="true" />
        <PostComposer
          variant="sheet"
          onSaved={onSaved}
          onCancel={onClose}
          onDraftsAdded={onDraftsAdded}
        />
      </div>
    </div>
  )
}

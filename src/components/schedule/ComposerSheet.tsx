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
  const sheetRef = useRef<HTMLDivElement>(null)

  // 開いている間は後ろの一覧を動かさない。閉じたら元に戻す。
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
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

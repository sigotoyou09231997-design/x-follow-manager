import { useEffect, useRef } from 'react'
import { Icon } from '../Icon'
import { PostComposer } from './PostComposer'
import type { ScheduledPost } from '../../lib/schedule/types'

interface Props {
  /** 編集対象。未指定なら新規作成。 */
  editing?: ScheduledPost
  onClose: () => void
  onSaved: () => void
  onDraftsAdded?: () => void
  /** AI下書き支援を開いた状態で始める（ホームの「AIで下書きを作る」から来たとき）。 */
  startWithAiOpen?: boolean
}

/**
 * 投稿の作成・編集を前面にかぶせて出す画面。
 *
 * 予約投稿タブに一覧埋め込み型のコンポーザーも以前は別にあったが、入口を
 * 増やさないためこちらへ一本化した。一覧を暗くして前に出し、
 * 「予約する」を常に手の届く位置（下端）に置いている。
 */
export function ComposerSheet({ editing, onClose, onSaved, onDraftsAdded, startWithAiOpen }: Props) {
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
      aria-label={editing ? '予約を編集' : '新しい投稿'}
      // 背景（暗い部分）を触ったときだけ閉じる。中身のクリックでは閉じない。
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="composer-sheet__panel" ref={sheetRef}>
        <div className="composer-sheet__grip" aria-hidden="true" />
        {/* 見出しと×はシートの中に置く。シートごと動くので、キーボードが出ても見失わない。 */}
        <div className="composer-sheet__bar">
          <span className="composer-sheet__title">{editing ? '予約を編集' : '新しい投稿'}</span>
          <button
            type="button"
            className="composer-sheet__close"
            onClick={onClose}
            aria-label="閉じる"
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        <PostComposer
          variant="sheet"
          editing={editing}
          onSaved={onSaved}
          onCancel={onClose}
          onDraftsAdded={onDraftsAdded}
          startWithAiOpen={startWithAiOpen}
        />
      </div>
    </div>
  )
}

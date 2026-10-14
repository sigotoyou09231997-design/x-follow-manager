import { useEffect, useRef, useState } from 'react'
import { Icon, type IconName } from './Icon'

// 画面の下に付いてくる丸いボタン。押すと、各画面（設定・予約投稿・フォロー整理…）へ行けるメニューが下から出る。
// 画面が長くても、スクロールを戻さずに、いつでも別の画面へ移れる。

export type MenuTarget = 'home' | 'autopost' | 'schedule' | 'tidy' | 'protected' | 'history' | 'settings'

const ITEMS: { target: MenuTarget; icon: IconName; label: string; desc: string }[] = [
  { target: 'home', icon: 'home', label: '自動投稿（トップ）', desc: 'X・ディスコード・Yay の稼働と予定' },
  { target: 'autopost', icon: 'send', label: '自動投稿の文と設定', desc: '文・文体・1日の投稿数・費用' },
  { target: 'schedule', icon: 'calendar', label: '予約投稿', desc: 'Xと連携して、時間になったら投稿' },
  { target: 'tidy', icon: 'tasks', label: 'フォロー整理', desc: '非相互フォローの確認' },
  { target: 'protected', icon: 'bookmark', label: '残すリスト', desc: '残すと決めた人' },
  { target: 'history', icon: 'history', label: '履歴', desc: 'フォローを解除した人の記録' },
  { target: 'settings', icon: 'settings', label: '設定', desc: '通知・アーカイブの読み込み・データの削除' },
]

interface Props {
  /** いまの画面（メニューの中で「いまここ」と示す）。 */
  current: MenuTarget
  onSelect: (target: MenuTarget) => void
}

export function QuickMenu({ current, onSelect }: Props) {
  const [open, setOpen] = useState(false)
  const fabRef = useRef<HTMLButtonElement>(null)

  // Esc で閉じる。閉じたら、押したボタンへフォーカスを戻す。
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        fabRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  function choose(target: MenuTarget) {
    setOpen(false)
    onSelect(target)
  }

  return (
    <>
      <button
        ref={fabRef}
        type="button"
        className="quick-fab"
        onClick={() => setOpen(true)}
        aria-label="メニューを開く"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Icon name="list" size={22} />
      </button>

      {open && (
        <div className="quick-menu" role="presentation">
          <button type="button" className="quick-menu__backdrop" aria-label="メニューを閉じる" onClick={() => setOpen(false)} />
          <div className="quick-menu__sheet" role="dialog" aria-modal="true" aria-label="メニュー">
            <div className="quick-menu__head">
              <strong>メニュー</strong>
              <button type="button" className="btn btn--ghost btn--small" onClick={() => setOpen(false)}>
                <Icon name="close" size={16} />
                閉じる
              </button>
            </div>
            <div className="surface-card link-list">
              {ITEMS.map((item) => (
                <button
                  key={item.target}
                  type="button"
                  className={`link-row${item.target === current ? ' link-row--current' : ''}`}
                  onClick={() => choose(item.target)}
                  aria-current={item.target === current ? 'page' : undefined}
                >
                  <span className="link-row__icon">
                    <Icon name={item.icon} size={18} />
                  </span>
                  <span className="link-row__body">
                    <span className="link-row__label">{item.label}</span>
                    <span className="link-row__desc">{item.desc}</span>
                  </span>
                  {item.target === current ? (
                    <span className="quick-menu__here">いまここ</span>
                  ) : (
                    <Icon name="chevron-right" size={18} className="link-row__chevron" />
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

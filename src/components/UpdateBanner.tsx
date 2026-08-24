import { useEffect, useState } from 'react'
import { applyUpdate, subscribeUpdateAvailable } from '../lib/pwaUpdate'
import { isEditing } from '../lib/editingGuard'
import { Icon } from './Icon'

/** 帯を出してから適用するまでの待ち時間。切り替わることが読み取れる程度の長さ。 */
const PROGRESS_DURATION_MS = 1500
/** 書きかけを理由に待てる上限。これを過ぎたら諦めて適用する。 */
const MAX_DEFER_MS = 5 * 60_000

/**
 * 新しいビルドが公開されたことを画面上部で知らせ、そのまま最新版へ切り替える。
 * 更新が見つかった時点ですぐ出す（次の操作を待たない）ので、画面を開いたまま
 * 眺めているだけでも更新に気づける。
 */
export function UpdateBanner() {
  const [visible, setVisible] = useState(false)
  const [filled, setFilled] = useState(false)
  /** 書きかけの入力があるせいで切り替えを待っている間だけ true。 */
  const [waiting, setWaiting] = useState(false)

  useEffect(() => subscribeUpdateAvailable(() => setVisible(true)), [])

  useEffect(() => {
    if (!visible) return

    const raf = requestAnimationFrame(() => setFilled(true))
    const startedAt = Date.now()
    let cancelled = false
    let timerId = 0

    // 発火のたびに書きかけかどうかを見直す。バナーが出たあとに書き始めた場合も待つ。
    function schedule(delay: number) {
      timerId = window.setTimeout(() => {
        if (cancelled) return
        if (isEditing() && Date.now() - startedAt < MAX_DEFER_MS) {
          setWaiting(true)
          schedule(1000)
          return
        }
        setWaiting(false)
        void applyUpdate()
      }, delay)
    }
    schedule(PROGRESS_DURATION_MS + 150)

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      window.clearTimeout(timerId)
    }
  }, [visible])

  if (!visible) return null

  return (
    <div className="update-banner" role="status" aria-live="polite">
      <div className="update-banner__body">
        <Icon name="download" size={18} />
        <div className="update-banner__text">
          <p className="update-banner__title">アップデートが来ています</p>
          <p className="update-banner__meta">
            {waiting ? '入力が終わったら切り替えます' : '最新版に更新しています…'}
          </p>
        </div>
      </div>
      <div className="update-banner__track">
        <div
          className="update-banner__fill"
          style={{
            width: filled ? '100%' : '0%',
            transitionDuration: `${PROGRESS_DURATION_MS}ms`,
          }}
        />
      </div>
    </div>
  )
}

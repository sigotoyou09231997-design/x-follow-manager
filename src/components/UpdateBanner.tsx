import { useEffect, useState } from 'react'
import { applyUpdate, subscribeUpdateAvailable } from '../lib/pwaUpdate'
import { isEditing } from '../lib/editingGuard'
import { Icon } from './Icon'

/** 帯を出してから適用するまでの待ち時間。切り替わることが読み取れる程度の長さ。 */
const PROGRESS_DURATION_MS = 1500

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
  /** 待っている間に「今すぐ更新」を押した。書きかけを承知で適用する。 */
  const [forced, setForced] = useState(false)

  useEffect(() => subscribeUpdateAvailable(() => setVisible(true)), [])

  useEffect(() => {
    if (!visible || forced) return

    const raf = requestAnimationFrame(() => setFilled(true))
    let cancelled = false
    let timerId = 0

    // 発火のたびに書きかけかどうかを見直す。バナーが出たあとに書き始めた場合も待つ。
    //
    // 待ち時間に上限は設けない。以前は5分で諦めて適用していたが、適用＝リロードなので、
    // 書き終わっていない投稿を書いた本人ごと巻き込んで消してしまう。この帯が守ろうと
    // しているものを、この帯自身が壊すことになる。長く書いている人には、
    // 「今すぐ更新」を自分で押してもらう。
    function schedule(delay: number) {
      timerId = window.setTimeout(() => {
        if (cancelled) return
        if (isEditing()) {
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
  }, [visible, forced])

  if (!visible) return null

  function updateNow() {
    setForced(true)
    setWaiting(false)
    void applyUpdate()
  }

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
        {waiting && (
          <button type="button" className="update-banner__now" onClick={updateNow}>
            今すぐ更新
          </button>
        )}
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

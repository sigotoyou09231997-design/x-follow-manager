import { useLayoutEffect, useRef } from 'react'
import type { Slot } from '../../lib/autopost/draft'
import { Icon } from '../Icon'
import { HoursPicker } from './HoursPicker'

// 投稿する文の1枠（本文の入力欄＋文字数＋投稿する時間帯）。
// 文を変える画面（AutoPostView）と、トップの「文を見る」のポップアップ（ChannelTextSheet）で同じものを使う。

export function AutoTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(132, el.scrollHeight + 2)}px`
  }, [props.value])
  return <textarea ref={ref} {...props} />
}


interface BoxProps {
  index: number
  total: number
  slot: Slot
  /** いまの時間に、この文が投稿に使われている（保存してある内容のとき）。 */
  nowActive?: boolean
  /** 保存できた直後。色を変えて「保存しました」を出す。 */
  saved?: boolean
  maxLength: number
  onChange: (slot: Slot) => void
  onRemove: () => void
}

export function Box({ index, total, slot, nowActive, saved, maxLength, onChange, onRemove }: BoxProps) {
  const length = slot.text.trim().length
  const name = total > 1 ? `${index + 1}つ目の文` : '投稿する文'
  return (
    // 1つの文の、見出し・本文・文字数・投稿する時間帯を、1枚の枠にまとめる。
    // 枠が無いと、時間帯の札が上の文のものか下の文のものか分からなかった（文が2つ以上のとき）。
    <div className={`autopost__box${saved ? ' autopost__box--saved' : ''}`} role="group" aria-label={name}>
      {saved && (
        <span className="autopost__saved" aria-hidden="true">
          <Icon name="check" size={13} />
          保存しました
        </span>
      )}
      <div className="autopost__box-head">
        <span>
          {total > 1 ? `${index + 1}つ目` : '投稿する文'}
          {nowActive && <span className="autopost__now">いま投稿中</span>}
        </span>
        {total > 1 && (
          <button type="button" className="btn btn--ghost btn--small" onClick={onRemove}>
            この文を外す
          </button>
        )}
      </div>
      <AutoTextarea
        value={slot.text}
        onChange={(e) => onChange({ ...slot, text: e.target.value })}
        aria-label={name}
        placeholder="ここに投稿する文を書きます"
      />
      <div className="autopost__box-foot">
        <div className={`autopost__count${length > maxLength ? ' over' : ''}`}>{length}文字</div>
        <HoursPicker hours={slot.hours} onChange={(hours) => onChange({ ...slot, hours })} name={name} />
      </div>
    </div>
  )
}

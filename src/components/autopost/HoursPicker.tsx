import { useState } from 'react'
import { ALL_HOURS, HOUR_PRESETS, hoursLabel, sameHours, toggleHour, type Hours } from '../../lib/autopost/hours'
import { Icon } from '../Icon'

// 文ごとの「投稿する時間帯」。日本時間の1時間ずつ付け外しでき、朝・昼などのワンタップも使える。
// 閉じているあいだは「終日」「9〜12時」のような一言だけ。

interface Props {
  hours: Hours
  onChange: (hours: Hours) => void
  /** 画面の読み上げ用。文が複数あるときは「2つ目の文」のように、どの文の時間帯かを伝える。 */
  name: string
  /** 最初から開いておく（新しく文を足すときは、時間帯を決めるのが目的なので）。 */
  defaultOpen?: boolean
}

export function HoursPicker({ hours, onChange, name, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen)
  const empty = hours !== null && hours.length === 0
  // 1つも選ばれていないと保存できない。閉じたままだと理由が見えないので、開いたままにする。
  const shown = open || empty
  const label = hoursLabel(hours)

  return (
    <div className={`hours${hours !== null ? ' hours--set' : ''}`}>
      <button
        type="button"
        className="hours__toggle"
        aria-expanded={shown}
        aria-label={`${name}の投稿する時間帯: ${label}`}
        onClick={() => setOpen(!open)}
      >
        <Icon name="clock" size={15} />
        <span>投稿する時間帯</span>
        <strong>{label}</strong>
        <Icon name={shown ? 'chevron-up' : 'chevron-down'} size={14} />
      </button>

      {shown && (
        <div className="hours__panel">
          <div className="hours__presets" role="group" aria-label="時間帯のえらび方">
            <button
              type="button"
              className="hours__preset"
              aria-pressed={hours === null}
              onClick={() => onChange(null)}
            >
              終日
            </button>
            {HOUR_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                className="hours__preset"
                aria-pressed={sameHours(hours, p.hours)}
                onClick={() => onChange(p.hours)}
              >
                {p.label}
                <span>
                  {p.hours[0]}〜{(p.hours[p.hours.length - 1] + 1) % 24 || 24}時
                </span>
              </button>
            ))}
          </div>

          <div className="hours__grid" role="group" aria-label="投稿する時間（1時間ずつ）">
            {ALL_HOURS.map((h) => {
              const on = hours === null || hours.includes(h)
              return (
                <button
                  key={h}
                  type="button"
                  className="hours__cell"
                  aria-pressed={on}
                  aria-label={`${h}時台`}
                  onClick={() => onChange(toggleHour(hours, h))}
                >
                  {h}
                </button>
              )
            })}
          </div>

          <p className={`hours__hint${empty ? ' hours__hint--err' : ''}`} role={empty ? 'alert' : undefined}>
            {empty
              ? '時間を1つ以上選ぶか、「終日」にしてください。'
              : '日本時間です。「9」は 9:00〜9:59。時間を決めた文は、その時間になると、この文だけが投稿されます。'}
          </p>
        </div>
      )}
    </div>
  )
}

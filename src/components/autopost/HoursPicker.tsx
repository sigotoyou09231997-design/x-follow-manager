import { useState } from 'react'
import {
  HOUR_PRESETS,
  endChoices,
  hoursLabel,
  hoursToRanges,
  rangeLabel,
  rangesToHours,
  sameHours,
  type Hours,
  type Range,
} from '../../lib/autopost/hours'
import { Icon } from '../Icon'
import { HoursStrip } from './DayTimeline'

// 文ごとの「投稿する時間帯」。「◯時から◯時まで」を選ぶ。夜をまたぐ時間（22時〜翌6時）も同じ形で選べる。
// 朝・昼などのワンタップ、「別の時間帯も」で同じ文を朝と夜の両方に使うこともできる。
// 閉じているあいだは「終日」「9時〜12時」のような一言だけ。

interface Props {
  hours: Hours
  onChange: (hours: Hours) => void
  /** 画面の読み上げ用。文が複数あるときは「2つ目の文」のように、どの文の時間帯かを伝える。 */
  name: string
  /** 最初から開いておく（新しく文を足すときは、時間帯を決めるのが目的なので）。 */
  defaultOpen?: boolean
}

/** 範囲を決めなおす最初の値。 */
const FIRST_RANGE: Range = { from: 9, to: 12 }

/** 「別の時間帯も」を足すときの最初の値。いまの最後の範囲が終わる時から3時間（24時を越えないように）。 */
function after(last: Range | undefined): Range {
  const from = (last?.to ?? 9) % 24
  return { from, to: Math.min(from + 3, 24) === from ? from + 1 : Math.min(from + 3, 24) }
}

export function HoursPicker({ hours, onChange, name, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen)
  // 欄を並べ替えたり、途中で重なったりしても飛ばないよう、選んでいる範囲はこの欄が持つ。
  // 外から時間が変わった（別の端末の保存・「やめる」など）ときだけ、そこから作り直す。
  const [ranges, setRanges] = useState<Range[]>(() => hoursToRanges(hours))
  const [seen, setSeen] = useState<Hours>(hours)
  if (!sameHours(seen, hours)) {
    setSeen(hours)
    if (!sameHours(rangesToHours(ranges), hours)) setRanges(hoursToRanges(hours))
  }

  const label = hoursLabel(hours)
  const allDay = hours === null
  const shown = open

  function commit(next: Range[]) {
    setRanges(next)
    // 範囲が1つも無い = 「終日」（時間を決めない）。rangesToHours は空の配列（＝時間を1つも選んでいない）を返すので、ここで分ける
    const h = next.length === 0 ? null : rangesToHours(next)
    setSeen(h)
    onChange(h)
  }

  function setRange(i: number, patch: Partial<Range>) {
    const cur = ranges[i]
    let from = patch.from ?? cur.from
    let to = patch.to ?? cur.to
    // 開始を動かして、終了と同じ時（24時間ぜんぶ）になるときは、終了を1時間後にずらす
    if (to % 24 === from % 24) to = from + 1 > 24 ? 1 : from + 1
    if (from === 0 && to === 24) to = 23
    commit(ranges.map((r, j) => (j === i ? { from, to } : r)))
  }

  return (
    <div className={`hours${allDay ? '' : ' hours--set'}`}>
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
          <div className="hours__presets" role="group" aria-label="よく使う時間帯">
            <button type="button" className="hours__preset" aria-pressed={allDay} onClick={() => commit([])}>
              終日
            </button>
            {HOUR_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                className="hours__preset"
                aria-pressed={sameHours(hours, p.hours)}
                onClick={() => commit(hoursToRanges(p.hours))}
              >
                {p.label}
                <span>{rangeLabel(hoursToRanges(p.hours)[0])}</span>
              </button>
            ))}
          </div>

          {allDay ? (
            <div className="hours__allday">
              <p>時間を決めていないので、一日中この文が使われます。</p>
              <button type="button" className="btn btn--secondary btn--small" onClick={() => commit([FIRST_RANGE])}>
                時間を決める
              </button>
            </div>
          ) : (
            <>
              <ul className="hours__ranges">
                {ranges.map((r, i) => (
                  <li key={i} className="hours__range">
                    <select
                      value={r.from}
                      onChange={(e) => setRange(i, { from: Number(e.target.value) })}
                      aria-label={`${ranges.length > 1 ? `${i + 1}つ目の` : ''}開始の時刻`}
                    >
                      {Array.from({ length: 24 }, (_, h) => (
                        <option key={h} value={h}>
                          {h}時
                        </option>
                      ))}
                    </select>
                    <span>から</span>
                    <select
                      value={r.to}
                      onChange={(e) => setRange(i, { to: Number(e.target.value) })}
                      aria-label={`${ranges.length > 1 ? `${i + 1}つ目の` : ''}終了の時刻`}
                    >
                      {endChoices(r.from).map((c) => (
                        <option key={c.to} value={c.to}>
                          {c.nextDay ? '翌' : ''}
                          {c.to}時
                        </option>
                      ))}
                    </select>
                    <span>まで</span>
                    {ranges.length > 1 && (
                      <button
                        type="button"
                        className="btn btn--ghost btn--small hours__range-remove"
                        onClick={() => commit(ranges.filter((_, j) => j !== i))}
                        aria-label={`${i + 1}つ目の時間帯を外す`}
                      >
                        <Icon name="close" size={14} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="btn btn--ghost btn--small hours__add"
                onClick={() => commit([...ranges, after(ranges.at(-1))])}
              >
                <Icon name="plus" size={14} />
                別の時間帯も使う
              </button>
              <HoursStrip hours={hours} />
            </>
          )}

          <p className="hours__hint">
            日本時間です。この時間になると、この文だけが投稿されます。終わりは、選んだ「◯時」ちょうどまで。「翌」は次の日です。
          </p>
        </div>
      )}
    </div>
  )
}

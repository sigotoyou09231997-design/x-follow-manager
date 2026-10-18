import { circularSegments, ownersByHour, segmentHas, segmentLabel, type Hours } from '../../lib/autopost/hours'

// 1日の使われ方を見せる。トップ・詳細の「1日の流れ」は、時刻の順に「何時から何時まで → どの文」を並べた一覧。
// 文の時間帯を選ぶ欄の中には、その文を使う時間だけを塗った細い帯（HoursStrip）を出す。

const TICKS = [0, 6, 12, 18, 24]

function Ticks() {
  return (
    <div className="dayline__ticks" aria-hidden="true">
      {TICKS.map((t) => (
        <span key={t} style={{ left: `${(t / 24) * 100}%` }}>
          {t}
        </span>
      ))}
    </div>
  )
}

interface OverviewProps {
  /** 文（文の並び順）。一覧に、どの文かが分かるよう先頭を出す。 */
  texts: string[]
  /** 文ごとの時間帯（texts と同じ並び）。 */
  hours: Hours[]
  /** Yay のように、1回に1つの文だけ投稿する投稿先。 */
  oneOnly?: boolean
  /** いま（日本時間の何時か）。分かれば、その行に印を付ける。 */
  nowHour?: number
}

const excerpt = (text: string) => text.replace(/\s*\n\s*/g, ' ').trim()

/**
 * 「何時から何時までは、どの文が投稿されるか」を、時刻の順に1行ずつ並べた一覧。
 * どの文も使われず投稿を休む時間も、1行として出す。
 */
export function DayOverview({ texts, hours, oneOnly = false, nowHour }: OverviewProps) {
  const segments = circularSegments(ownersByHour(hours, oneOnly))
  return (
    <section className="daytable" aria-label="1日の流れ">
      <h4 className="daytable__title">1日の流れ</h4>
      <ol className="daytable__list">
        {segments.map((seg) => {
          const rest = seg.owners.length === 0
          const now = nowHour !== undefined && segmentHas(seg, nowHour)
          return (
            <li key={seg.from} className={`daytable__row${rest ? ' daytable__row--rest' : ''}${now ? ' daytable__row--now' : ''}`}>
              <span className="daytable__time">{segmentLabel(seg)}</span>
              <span className="daytable__what">
                {rest ? (
                  <span className="daytable__text">投稿を休みます</span>
                ) : seg.owners.length > 1 ? (
                  <>
                    <b className="daytable__no">{seg.owners.map((o) => o + 1).join('・')}</b>
                    <span className="daytable__text">つ目を順に投稿</span>
                  </>
                ) : (
                  <>
                    <b className="daytable__no">{seg.owners[0] + 1}</b>
                    <span className="daytable__text">{excerpt(texts[seg.owners[0]] ?? '')}</span>
                  </>
                )}
              </span>
              {now && <span className="daytable__now">いま</span>}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

/** 1つの文の時間帯だけを見せる細い帯。色が付いた時間が、この文を使う時間。 */
export function HoursStrip({ hours }: { hours: Hours }) {
  return (
    <div className="dayline dayline--strip" aria-hidden="true">
      <div className="dayline__bar">
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h} className={`dayline__cell${hours === null || hours.includes(h) ? ' dayline__cell--on' : ''}`} />
        ))}
      </div>
      <Ticks />
    </div>
  )
}

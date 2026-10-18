import { daySegments, ownersByHour, type Hours } from '../../lib/autopost/hours'

// 1日（0時〜24時）を横長の帯にして、どの時間にどの文が使われるかを見せる。
// 「何時から何時までがどの文か」と「どの文も使われず休む時間」を、文字を読まなくても分かるようにするための図。

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
  /** 文ごとの時間帯（文の並び順）。 */
  hours: Hours[]
  /** Yay のように、1回に1つの文だけ投稿する投稿先。 */
  oneOnly?: boolean
  /** いま（日本時間の何時か）。分かれば、帯の上に印を付ける。 */
  nowHour?: number
}

/** 文が複数あるときの、1日の使われ方。数字は「何つ目の文か」。斜線は、どの文も使われず投稿を休む時間。 */
export function DayOverview({ hours, oneOnly = false, nowHour }: OverviewProps) {
  const segments = daySegments(ownersByHour(hours, oneOnly))
  const resting = segments.some((s) => s.owners.length === 0)
  return (
    <figure className="dayline" aria-label="1日の使われ方">
      <div className="dayline__bar" role="list">
        {segments.map((seg) => {
          const rest = seg.owners.length === 0
          const multi = seg.owners.length > 1
          const label = rest ? (seg.length >= 3 ? '休み' : '') : multi ? (seg.length >= 4 ? '順に回す' : '') : String(seg.owners[0] + 1)
          const tone = rest ? 'rest' : multi ? 'multi' : `t${seg.owners[0] % 4}`
          return (
            <span
              key={seg.from}
              role="listitem"
              className={`dayline__seg dayline__seg--${tone}`}
              style={{ flexGrow: seg.length }}
              title={`${seg.from}時〜${seg.from + seg.length}時: ${
                rest ? '投稿を休む' : multi ? `${seg.owners.map((o) => o + 1).join('・')}つ目の文を順に回す` : `${seg.owners[0] + 1}つ目の文`
              }`}
            >
              {label}
            </span>
          )
        })}
        {nowHour !== undefined && (
          <span className="dayline__now" style={{ left: `${((nowHour + 0.5) / 24) * 100}%` }} aria-label={`いま ${nowHour}時台`}>
            <i>いま</i>
          </span>
        )}
      </div>
      <Ticks />
      <figcaption className="dayline__caption">
        数字は、その時間に投稿される文（何つ目か）。{resting ? '斜線の時間は、どの文も使われないので投稿を休みます。' : ''}
      </figcaption>
    </figure>
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

import { useMemo } from 'react'
import { analyzeRejected, blockedWords } from '../../lib/xAutopilot/rejectedAnalysis'

interface Props {
  /** 本人が「取り消す」で外した自動運転の文（取り消した順は問わない）。 */
  rejected: string[]
  /** 取り消されなかった（残した・投稿可能・確認待ち・投稿した）自動運転の文。見比べるために使う。 */
  kept: string[]
}

/**
 * 取り消した文の分析。どんな言葉・話題が取り消されやすいかを見せる。ここに出た言葉は、次から使わない／避ける
 * （取り消しが3回以上で、残した文にほとんど出ない言葉は、案に入っていたら作り直させる）。
 */
export function RejectedInsights({ rejected, kept }: Props) {
  const analysis = useMemo(() => analyzeRejected(rejected, kept), [rejected, kept])
  const blocked = useMemo(() => new Set(blockedWords(analysis)), [analysis])

  return (
    <section className="surface-card xap__card rejected-insights" aria-label="取り消した文の分析">
      <h2 className="xap__title">取り消した文の分析</h2>
      {analysis.total === 0 ? (
        <p className="xap__muted">まだ取り消した文はありません。「取り消す」を押した文は、残しておき、ここで言葉や話題を分析します。</p>
      ) : (
        <>
          <p className="rejected-insights__lead">
            これまでに取り消した文は <strong>{analysis.total}件</strong>。残して、次から作る文に取り入れています。
          </p>

          {analysis.words.length > 0 ? (
            <div>
              <h3 className="rejected-insights__sub">よく取り消される言葉</h3>
              <ul className="rejected-insights__chips">
                {analysis.words.map((w) => (
                  <li key={w.word} className={`rejected-insights__chip${blocked.has(w.word) ? ' rejected-insights__chip--blocked' : ''}`}>
                    <span>{w.word}</span>
                    <small>
                      取り消し{w.rejected}回{w.kept > 0 ? `／残した${w.kept}回` : ''}
                    </small>
                  </li>
                ))}
              </ul>
              {blocked.size > 0 && <p className="xap__muted">濃い色の言葉は、使いません（案に入っていたら、作り直させます）。</p>}
            </div>
          ) : (
            <p className="xap__muted">同じ言葉が何度も取り消されている、という偏りは、まだありません。</p>
          )}

          {analysis.topics.length > 0 && (
            <div>
              <h3 className="rejected-insights__sub">よく取り消される話題</h3>
              <ul className="rejected-insights__chips">
                {analysis.topics.map((t) => (
                  <li key={t.name} className="rejected-insights__chip">
                    <span>{t.name}</span>
                    <small>
                      {analysis.total}件のうち{t.count}件
                    </small>
                  </li>
                ))}
              </ul>
              <p className="xap__muted">この話題は、次の文では選びません。</p>
            </div>
          )}
        </>
      )}
    </section>
  )
}

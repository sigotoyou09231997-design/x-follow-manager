import type { StyleProfile } from '../../lib/xAutopilot/types'

interface Props {
  profile: StyleProfile | null
  /** 直近の投稿の書き方の傾向（毎回、最新の履歴から数えた割合）。 */
  recentStyle: string | null
}

/**
 * 文体の分析の中身。AIが過去の投稿からまとめた「この人らしさ」（要約・一人称・語尾・絵文字・長さ・よく書く話題）と、
 * 直近の投稿の傾向（長さ・句点・絵文字の割合）。以前は裏（Supabase）でしか見られなかったが、本人の希望でトップにも出す。
 * 次に作る文は、ここにある内容に沿って書かれる。
 */
export function StyleInsights({ profile, recentStyle }: Props) {
  if (!profile && !recentStyle) return null
  return (
    <section className="surface-card xap__card style-insights" aria-label="文体のまとめ">
      <h2 className="xap__title">文体のまとめと傾向</h2>
      {profile ? (
        <>
          <p className="rejected-insights__lead">{profile.summary}</p>
          <dl className="style-insights__list">
            <dt>一人称・呼びかけ</dt>
            <dd>{profile.voice.person}</dd>
            <dt>よく使う語尾</dt>
            <dd>{profile.voice.endings.join(' / ') || '特になし'}</dd>
            <dt>絵文字・記号</dt>
            <dd>{profile.voice.emoji}</dd>
            <dt>長さ・改行</dt>
            <dd>{profile.voice.layout}</dd>
          </dl>
          {profile.themes.length > 0 && (
            <div>
              <h3 className="rejected-insights__sub">よく書く話題</h3>
              <ul className="style-insights__themes">
                {profile.themes.map((t) => (
                  <li key={t.name}>
                    <strong>{t.name}</strong>
                    <span>{t.note}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {profile.avoid.length > 0 && (
            <div>
              <h3 className="rejected-insights__sub">やらないこと</h3>
              <ul className="style-insights__themes">
                {profile.avoid.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        <p className="xap__muted">まだ文体をまとめていません。</p>
      )}
      {recentStyle && (
        <div>
          <h3 className="rejected-insights__sub">最近の投稿の傾向</h3>
          <p className="style-insights__recent">{recentStyle}</p>
          <p className="xap__muted">取り込み済みの投稿から毎回数えた割合です。次に作る文は、これに合わせて書かれます。</p>
        </div>
      )}
    </section>
  )
}

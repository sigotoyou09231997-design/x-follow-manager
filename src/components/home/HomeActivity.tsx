import { useEffect, useMemo, useState } from 'react'
import './home-activity.css'
import { signInWithGoogle, useSupabaseAuth } from '../../hooks/useSupabaseAuth'
import { useAutopost } from '../../hooks/useAutopost'
import { useScheduledPosts } from '../../hooks/useScheduledPosts'
import { buildFeed, buildStories, whenLabel, type ActivityTarget, type FeedItem, type Story } from '../../lib/home/activity'
import { Icon, type IconName } from '../Icon'

interface Props {
  /** フォロー整理の状況（アーカイブを読み込み済みか・未確認の人数）。ホームがすでに持っている値。 */
  tidy: { hasData: boolean; pending: number }
  /** 丸いアイコンや一覧のカードを押したとき。開く場所はホーム側（App）が決める。 */
  onOpen: (target: ActivityTarget) => void
}

const STORY_ICONS: Record<Story['id'], IconName> = {
  discord: 'send',
  yay: 'sparkles',
  schedule: 'calendar',
  tidy: 'tasks',
}

const SERVICE_ICONS: Record<FeedItem['service'], IconName> = {
  discord: 'send',
  yay: 'sparkles',
  x: 'calendar',
}

const KIND_LABELS: Record<FeedItem['kind'], string> = {
  posted: '投稿しました',
  scheduled: 'これから投稿',
  failed: '投稿に失敗',
}

/** 「◯分前」を開きっぱなしでも古くしないための時計。 */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

/**
 * ホームの先頭に出す「いまの動き」。ディスコード・Yay・X予約・フォロー整理の様子を、
 * 丸いアイコン（動いているか）と、タイムラインのような一覧（最近の・これからの投稿）で見せる。
 *
 * サーバー前提の部分なので、ホーム本体とは別に、開いたときに読み込む（Artifact版では空のスタブに差し替わる）。
 * 接続情報が取れない環境（サーバーなしの開発・Artifact）では、何も出さない。
 */
export function HomeActivity({ tidy, onOpen }: Props) {
  const { session, loading: authLoading, configured } = useSupabaseAuth()
  const loggedIn = !!session
  const { snapshots } = useAutopost(loggedIn)
  const { posts } = useScheduledPosts(loggedIn)
  const now = useNow(30_000)

  // tidy は呼び出しのたびに新しい箱になるので、中身（2つの値）で比べて、一覧を組み直しすぎないようにする。
  const { hasData, pending } = tidy
  const input = useMemo(
    () => ({ now, autopost: snapshots, posts: loggedIn ? posts : undefined, tidy: { hasData, pending } }),
    [now, snapshots, posts, loggedIn, hasData, pending]
  )
  const stories = useMemo(() => buildStories(input, now), [input, now])
  const feed = useMemo(() => buildFeed(input), [input])

  if (authLoading || !configured) return null

  return (
    <section className="home-activity" aria-labelledby="home-activity-title">
      <header className="home-activity__head">
        <p className="overline">NOW</p>
        <h2 id="home-activity-title" className="home-activity__title">
          いまの動き
        </h2>
      </header>

      <ul className="stories" aria-label="サービスの様子">
        {stories.map((story) => (
          <li key={story.id}>
            <button type="button" className="story" onClick={() => onOpen(story.target)}>
              <span className={`story__ring story__ring--${story.tone}`}>
                <span className="story__avatar">
                  <Icon name={STORY_ICONS[story.id]} size={22} />
                </span>
              </span>
              <span className="story__label">{story.label}</span>
              <span className={`story__meta story__meta--${story.tone}`}>{story.meta}</span>
            </button>
          </li>
        ))}
      </ul>

      {!loggedIn ? (
        <div className="surface-card home-activity__login">
          <p>ログインすると、ディスコード・Yay・Xの動きがここに並びます。</p>
          <button type="button" className="btn btn--primary btn--small" onClick={() => void signInWithGoogle()}>
            Googleでログイン
          </button>
        </div>
      ) : feed.length === 0 ? (
        <p className="home-activity__empty">まだ動きはありません。投稿されると、ここに並びます。</p>
      ) : (
        <ul className="feed">
          {feed.map((item) => (
            <li key={item.id}>
              <button type="button" className={`feed-card feed-card--${item.kind}`} onClick={() => onOpen(item.target)}>
                <span className={`feed-card__avatar feed-card__avatar--${item.service}`} aria-hidden="true">
                  <Icon name={SERVICE_ICONS[item.service]} size={18} />
                </span>
                <span className="feed-card__main">
                  <span className="feed-card__head">
                    <span className="feed-card__service">{item.serviceLabel}</span>
                    <span className="feed-card__kind">{KIND_LABELS[item.kind]}</span>
                    <time className="feed-card__time" dateTime={item.at}>
                      {whenLabel(item.at, now)}
                    </time>
                  </span>
                  <span className="feed-card__body">{item.body || '（本文なし）'}</span>
                  <span className="feed-card__foot">
                    {item.foot.map((text) => (
                      <span key={text}>{text}</span>
                    ))}
                  </span>
                </span>
                <Icon name="chevron-right" size={16} className="feed-card__chevron" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

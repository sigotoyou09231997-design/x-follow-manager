import { useMemo, useState } from 'react'
import { deleteScheduledPost, updateScheduledPost } from '../../lib/schedule/postsStore'
import { describeRepeatRule } from '../../lib/schedule/repeat'
import { EmptyState } from '../EmptyState'
import { Icon } from '../Icon'
import type { ScheduledPost } from '../../lib/schedule/types'
import { isAutopilotPost } from '../../lib/xAutopilot/types'

type Filter = 'all' | 'scheduled' | 'draft' | 'repeating' | 'failed'

const FILTER_LABELS: Record<Filter, string> = {
  all: 'すべて',
  scheduled: '予約中',
  draft: '下書き',
  repeating: '繰り返し',
  failed: '失敗',
}

const STATUS_LABELS: Record<ScheduledPost['status'], string> = {
  draft: '下書き',
  scheduled: '予約中',
  publishing: '投稿処理中',
  posted: '投稿済み',
  failed: '失敗',
  canceled: '取消',
}

function isTemplate(post: ScheduledPost): boolean {
  return !!post.repeatRule && !post.repeatParentId
}

function formatDateTime(iso?: string): string {
  if (!iso) return '日時未設定'
  const date = new Date(iso)
  return date.toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

interface Props {
  posts: ScheduledPost[]
  onChanged: () => void
  onEdit: (post: ScheduledPost) => void
  /** 1件も無いときに出す「投稿を作る」の行き先。渡されなければボタンを出さない。 */
  onCompose?: () => void
}

export function ScheduledPostList({ posts, onChanged, onEdit, onCompose }: Props) {
  const [filter, setFilter] = useState<Filter>('all')
  const [busyId, setBusyId] = useState<string>()
  const [error, setError] = useState<string>()

  // 投稿済みは一覧に出さない（本人の指示 2026-10-13）。出たあとの投稿が積み上がって、これからの予約が埋もれるため。
  // データは消さない（Supabase にそのまま残り、上部の集計の「投稿済み」にも数えられる）。
  // 繰り返しの親も、終わると status が posted になるので、ここで一緒に外れる。
  // 取り消したものも出さない。自動運転の「取り消す」は、消さずに印を付けて残す（次に書くときの「出さないもの」にするため）ので、
  // 出すと、取り消した投稿が一覧に積み上がる。
  const listed = useMemo(() => posts.filter((post) => post.status !== 'posted' && post.status !== 'canceled'), [posts])

  const counts = useMemo(() => {
    const result: Record<Filter, number> = {
      all: listed.length,
      scheduled: 0,
      draft: 0,
      repeating: 0,
      failed: 0,
    }
    for (const post of listed) {
      if (isTemplate(post)) result.repeating += 1
      else if (post.status === 'scheduled' || post.status === 'publishing') result.scheduled += 1
      else if (post.status === 'draft') result.draft += 1
      else if (post.status === 'failed') result.failed += 1
    }
    return result
  }, [listed])

  const visible = useMemo(() => {
    return listed.filter((post) => {
      if (filter === 'all') return true
      if (filter === 'repeating') return isTemplate(post)
      if (isTemplate(post)) return false
      if (filter === 'scheduled') return post.status === 'scheduled' || post.status === 'publishing'
      return post.status === filter
    })
  }, [listed, filter])

  async function run(id: string, action: () => Promise<void>) {
    setBusyId(id)
    setError(undefined)
    try {
      await action()
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(undefined)
    }
  }

  return (
    <div className="post-list">
      <nav className="post-list__filters">
        {(Object.keys(FILTER_LABELS) as Filter[]).map((key) => (
          <button
            key={key}
            type="button"
            className={filter === key ? 'post-list__filter active' : 'post-list__filter'}
            onClick={() => setFilter(key)}
          >
            {FILTER_LABELS[key]}
            <span className="post-list__filter-count">{counts[key]}</span>
          </button>
        ))}
      </nav>

      {error && <p className="post-list__error">{error}</p>}

      {visible.length === 0 && (
        <EmptyState
          icon="calendar"
          title="該当する投稿はありません。"
          description={
            filter === 'all'
              ? 'まだ予約がありません。「投稿を作る」から、日時を決めて並べられます。'
              : '別の絞り込みに切り替えると、ほかの予約が見られます。'
          }
          action={
            filter === 'all' && onCompose ? (
              <button type="button" className="btn btn--primary btn--small" onClick={onCompose}>
                <Icon name="plus" size={15} />
                投稿を作る
              </button>
            ) : undefined
          }
        />
      )}

      <ul className="post-list__items">
        {visible.map((post) => {
          const template = isTemplate(post)
          const busy = busyId === post.id
          return (
            <li key={post.id} className={`post-item post-item--${post.status}`}>
              <div className="post-item__head">
                <span className="post-item__when">
                  {template && post.repeatRule
                    ? describeRepeatRule(post.repeatRule)
                    : formatDateTime(post.scheduledAt)}
                </span>
                <span className={`post-item__status post-item__status--${post.status}`}>
                  {template
                    ? post.repeatRule?.autoGenerate
                      ? 'AIおまかせ'
                      : '繰り返し'
                    : STATUS_LABELS[post.status]}
                </span>
              </div>

              <div className="post-item__body">
                {/* 自動運転が作った予約。どれがAIの作ったものか分かるように印を付ける（直す・消すは普通の予約と同じ）。 */}
                {isAutopilotPost(post.aiPrompt) && (
                  <span className="post-item__ai-label">
                    <Icon name="sparkles" size={13} />
                    自動運転でAIが作りました
                  </span>
                )}
                {/* AIおまかせのテンプレートは本文を持たない（毎回サーバー側で書かれる）。
                    そのまま本文欄を描くと空白の札になり、何の予約なのか分からなくなる。 */}
                {template && post.repeatRule?.autoGenerate ? (
                  <div className="post-item__segment post-item__segment--ai">
                    <span className="post-item__ai-label">
                      <Icon name="sparkles" size={13} />
                      毎回この題材からAIが書きます
                    </span>
                    <p className="post-item__text">{post.repeatRule.aiTopic}</p>
                  </div>
                ) : (
                  post.segments.map((segment, index) => (
                  <div key={index} className="post-item__segment">
                    {post.segments.length > 1 && (
                      <span className="post-item__segment-index">{index + 1}</span>
                    )}
                    <p className="post-item__text">{segment.text}</p>
                    {segment.media.length > 0 && (
                      <span className="post-item__media-count">画像{segment.media.length}枚</span>
                    )}
                  </div>
                  ))
                )}
              </div>

              {post.errorMessage && <p className="post-item__error">{post.errorMessage}</p>}

              <div className="post-item__actions">
                <button
                  type="button"
                  className="btn btn--ghost btn--small"
                  onClick={() => onEdit(post)}
                  disabled={busy}
                >
                  <Icon name="edit" size={15} />
                  編集
                </button>
                {(post.status === 'scheduled' || post.status === 'publishing') && !template && (
                  <button
                    type="button"
                    className="btn btn--ghost btn--small"
                    onClick={() =>
                      void run(post.id, () =>
                        updateScheduledPost(post.id, { status: 'draft', scheduledAt: null })
                      )
                    }
                    disabled={busy}
                  >
                    予約を解除
                  </button>
                )}
                {post.status === 'failed' && (
                  <button
                    type="button"
                    className="btn btn--ghost btn--small"
                    onClick={() =>
                      void run(post.id, () =>
                        updateScheduledPost(post.id, { status: 'scheduled', clearError: true })
                      )
                    }
                    disabled={busy}
                  >
                    <Icon name="refresh" size={15} />
                    もう一度試す
                  </button>
                )}
                {post.postedTweetIds?.[0] && (
                  <a
                    className="btn btn--ghost btn--small"
                    href={`https://x.com/i/status/${post.postedTweetIds[0]}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Icon name="external" size={15} />
                    Xで見る
                  </a>
                )}
                <button
                  type="button"
                  className="btn btn--ghost btn--small btn--danger"
                  onClick={() => {
                    if (!confirm('この投稿を削除します。よろしいですか？')) return
                    void run(post.id, () => deleteScheduledPost(post))
                  }}
                  disabled={busy}
                >
                  <Icon name="trash" size={15} />
                  削除
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

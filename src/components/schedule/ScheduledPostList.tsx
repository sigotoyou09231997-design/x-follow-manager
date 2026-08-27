import { useMemo, useState } from 'react'
import { deleteScheduledPost, updateScheduledPost } from '../../lib/schedule/postsStore'
import { describeRepeatRule } from '../../lib/schedule/repeat'
import { Icon } from '../Icon'
import type { ScheduledPost } from '../../lib/schedule/types'

type Filter = 'all' | 'scheduled' | 'draft' | 'repeating' | 'posted' | 'failed'

const FILTER_LABELS: Record<Filter, string> = {
  all: 'すべて',
  scheduled: '予約中',
  draft: '下書き',
  repeating: '繰り返し',
  posted: '投稿済み',
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
}

export function ScheduledPostList({ posts, onChanged, onEdit }: Props) {
  const [filter, setFilter] = useState<Filter>('all')
  const [busyId, setBusyId] = useState<string>()
  const [error, setError] = useState<string>()

  const counts = useMemo(() => {
    const result: Record<Filter, number> = {
      all: posts.length,
      scheduled: 0,
      draft: 0,
      repeating: 0,
      posted: 0,
      failed: 0,
    }
    for (const post of posts) {
      if (isTemplate(post)) result.repeating += 1
      else if (post.status === 'scheduled' || post.status === 'publishing') result.scheduled += 1
      else if (post.status === 'draft') result.draft += 1
      else if (post.status === 'posted') result.posted += 1
      else if (post.status === 'failed') result.failed += 1
    }
    return result
  }, [posts])

  const visible = useMemo(() => {
    return posts.filter((post) => {
      if (filter === 'all') return true
      if (filter === 'repeating') return isTemplate(post)
      if (isTemplate(post)) return false
      if (filter === 'scheduled') return post.status === 'scheduled' || post.status === 'publishing'
      return post.status === filter
    })
  }, [posts, filter])

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

      {visible.length === 0 && <p className="post-list__empty">該当する投稿はありません。</p>}

      <ul className="post-list__items">
        {visible.map((post, index) => {
          const template = isTemplate(post)
          const busy = busyId === post.id
          // これから出す投稿だけ写真（仮素材のグラデーション）の面にする。
          // 済んだ投稿・失敗した投稿まで写真にすると、本文が読みにくいうえに
          // 「次に何が出るか」が一覧の中で埋もれる。
          const onPhoto = post.status === 'scheduled' || post.status === 'publishing' || post.status === 'draft'
          const tone = onPhoto ? ` post-item--photo post-item--tone-${index % 3}` : ''
          return (
            <li key={post.id} className={`post-item post-item--${post.status}${tone}`}>
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
                {post.status !== 'posted' && (
                  <button
                    type="button"
                    className="btn btn--ghost btn--small"
                    onClick={() => onEdit(post)}
                    disabled={busy}
                  >
                    <Icon name="edit" size={15} />
                    編集
                  </button>
                )}
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

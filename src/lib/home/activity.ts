import type { ChannelName, Snapshots } from '../autopost/api'
import { livenessOf, minutesAgo, pauseStateOf } from '../autopost/draft'
import type { ScheduledPost } from '../schedule/types'

// ホームの「いまの動き」に出す内容を、データから組み立てる。画面の部品から切り離してあるので、そのまま単体で確かめられる。
//   stories … サービスごとの丸いアイコン（動いているか・件数）
//   feed    … 最近起きたこと・これから起きることの一覧（SNSのタイムラインのように、1件1枚）

/** タップしたときに開く場所。 */
export type ActivityTarget = { tab: 'autopost'; channel: ChannelName } | { tab: 'schedule' } | { tab: 'tidy' }

export type StoryTone = 'ok' | 'warn' | 'off' | 'idle'

export interface Story {
  id: 'discord' | 'yay' | 'schedule' | 'tidy'
  label: string
  meta: string
  tone: StoryTone
  target: ActivityTarget
}

export type FeedKind = 'posted' | 'scheduled' | 'failed'

export interface FeedItem {
  id: string
  service: 'discord' | 'yay' | 'x'
  serviceLabel: string
  kind: FeedKind
  /** 起きた時刻、または予定の時刻（ISO8601）。 */
  at: string
  body: string
  foot: string[]
  target: ActivityTarget
}

export interface ActivityInput {
  now: number
  /** 自動投稿（ディスコード・Yay）。ログイン前・保存先が未用意のときは無い。 */
  autopost?: Snapshots
  /** X の予約投稿。ログイン前は無い。 */
  posts?: ScheduledPost[]
  /** フォロー整理（アーカイブを読み込んだ件数）。 */
  tidy: { hasData: boolean; pending: number }
}

const CHANNEL_LABELS: Record<ChannelName, string> = { discord: 'ディスコード', yay: 'Yay' }

/** 繰り返しのテンプレート自体は投稿されないので、一覧には出さない（次回ぶんの実体が出る）。 */
const isTemplate = (post: ScheduledPost) => !!post.repeatRule && !post.repeatParentId

const preview = (text: string) => text.replace(/\s+/g, ' ').trim()
const firstText = (post: ScheduledPost) => preview(post.segments[0]?.text ?? '')

export function buildStories({ autopost, posts, tidy }: ActivityInput, now: number): Story[] {
  const stories: Story[] = (['discord', 'yay'] as const).map((channel) => {
    const snapshot = autopost?.[channel]
    const status = snapshot?.status ?? null
    const liveness = livenessOf(status, now)
    const base = {
      id: channel,
      label: CHANNEL_LABELS[channel],
      meta: liveness === 'alive' ? `今日${status?.today ?? 0}件` : liveness === 'silent' ? '応答なし' : '報告なし',
      tone: (liveness === 'alive' ? 'ok' : liveness === 'silent' ? 'off' : 'idle') as StoryTone,
      target: { tab: 'autopost', channel } as ActivityTarget,
    }
    // 止めているときは、動いているかより「止めていること」を先に見せる（ホームを見ただけで、止め忘れに気づけるように）。
    switch (snapshot ? pauseStateOf(snapshot) : 'running') {
      case 'paused':
        return { ...base, meta: '停止中', tone: 'warn' }
      case 'pausing':
        return { ...base, meta: '停止を依頼中', tone: 'warn' }
      case 'resuming':
        return { ...base, meta: '再開待ち', tone: 'idle' }
      default:
        return base
    }
  })

  const real = (posts ?? []).filter((p) => !isTemplate(p))
  const failed = real.filter((p) => p.status === 'failed').length
  const scheduled = real.filter((p) => p.status === 'scheduled' || p.status === 'publishing').length
  stories.push({
    id: 'schedule',
    label: 'X予約',
    meta: failed > 0 ? `失敗${failed}件` : scheduled > 0 ? `予約${scheduled}件` : '予約なし',
    tone: failed > 0 ? 'warn' : scheduled > 0 ? 'ok' : 'idle',
    target: { tab: 'schedule' },
  })

  stories.push({
    id: 'tidy',
    label: 'フォロー整理',
    meta: tidy.hasData ? `未確認${tidy.pending.toLocaleString()}人` : '未読込',
    tone: 'idle',
    target: { tab: 'tidy' },
  })
  return stories
}

/**
 * 並べ方: 気づいてほしいもの（失敗）→ これから（予約。近い順）→ 済んだこと（新しい順）。
 * 件数は limit まで。失敗は、ほかを押しのけてでも先頭に出す。
 */
export function buildFeed({ autopost, posts }: ActivityInput, limit = 6): FeedItem[] {
  const real = (posts ?? []).filter((p) => !isTemplate(p))

  const failed: FeedItem[] = real
    .filter((p) => p.status === 'failed')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 2)
    .map((p) => ({
      id: `x-failed-${p.id}`,
      service: 'x',
      serviceLabel: 'X',
      kind: 'failed',
      at: p.updatedAt,
      body: firstText(p),
      foot: [p.errorMessage ? preview(p.errorMessage).slice(0, 60) : '投稿に失敗しました'],
      target: { tab: 'schedule' },
    }))

  const upcoming: FeedItem[] = real
    .filter((p) => (p.status === 'scheduled' || p.status === 'publishing') && p.scheduledAt)
    .sort((a, b) => (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? ''))
    .slice(0, 2)
    .map((p) => ({
      id: `x-scheduled-${p.id}`,
      service: 'x',
      serviceLabel: 'X',
      kind: 'scheduled',
      at: p.scheduledAt as string,
      body: firstText(p),
      foot: [p.status === 'publishing' ? '投稿中' : '予約中', ...(p.segments.length > 1 ? [`スレッド${p.segments.length}件`] : [])],
      target: { tab: 'schedule' },
    }))

  const done: FeedItem[] = real
    .filter((p) => p.status === 'posted')
    .map<FeedItem>((p) => ({
      id: `x-posted-${p.id}`,
      service: 'x',
      serviceLabel: 'X',
      kind: 'posted',
      at: p.updatedAt,
      body: firstText(p),
      foot: ['投稿済み'],
      target: { tab: 'schedule' },
    }))
  for (const channel of ['discord', 'yay'] as const) {
    const status = autopost?.[channel]?.status
    if (!status?.lastPost) continue
    done.push({
      id: `autopost-${channel}`,
      service: channel,
      serviceLabel: CHANNEL_LABELS[channel],
      kind: 'posted',
      at: status.lastPost.t,
      body: preview(status.lastPost.text),
      foot: [`今日${status.today}件`],
      target: { tab: 'autopost', channel },
    })
  }
  done.sort((a, b) => b.at.localeCompare(a.at))

  return [...failed, ...upcoming, ...done.slice(0, limit)].slice(0, limit)
}

/** 過去は「◯分前」「◯時間前」「◯日前」、これからは「10/8(木) 8:00」。 */
export function whenLabel(iso: string, now: number): string {
  const t = new Date(iso).getTime()
  if (t > now) {
    return new Date(iso).toLocaleString('ja-JP', {
      month: 'numeric',
      day: 'numeric',
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
    })
  }
  const mins = minutesAgo(iso, now)
  if (mins < 1) return 'たった今'
  if (mins < 60) return `${mins}分前`
  if (mins < 60 * 24) return `${Math.floor(mins / 60)}時間前`
  return `${Math.floor(mins / (60 * 24))}日前`
}

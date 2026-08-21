import { requireSupabase } from '../supabase'
import type {
  PostSegment,
  RepeatRule,
  ScheduledPost,
  ScheduledPostStatus,
  ScheduleSummary,
  XAccountStatus,
} from './types'

const TABLE = 'scheduled_posts'
const MEDIA_BUCKET = 'x-post-media'

interface ScheduledPostRow {
  id: string
  user_id: string
  status: ScheduledPostStatus
  scheduled_at: string | null
  segments: PostSegment[]
  repeat_rule: RepeatRule | null
  repeat_parent_id: string | null
  posted_tweet_ids: string[] | null
  error_message: string | null
  attempt_count: number
  ai_prompt: string | null
  created_at: string
  updated_at: string
}

function fromRow(row: ScheduledPostRow): ScheduledPost {
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    scheduledAt: row.scheduled_at ?? undefined,
    segments: row.segments ?? [],
    repeatRule: row.repeat_rule ?? undefined,
    repeatParentId: row.repeat_parent_id ?? undefined,
    postedTweetIds: row.posted_tweet_ids ?? undefined,
    errorMessage: row.error_message ?? undefined,
    attemptCount: row.attempt_count,
    aiPrompt: row.ai_prompt ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function fetchScheduledPosts(): Promise<ScheduledPost[]> {
  const client = requireSupabase()
  const { data, error } = await client
    .from(TABLE)
    .select('*')
    .order('scheduled_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
  if (error) throw new Error(`予約投稿の取得に失敗しました: ${error.message}`)
  return (data as ScheduledPostRow[]).map(fromRow)
}

export interface CreatePostInput {
  segments: PostSegment[]
  scheduledAt?: string
  status: Extract<ScheduledPostStatus, 'draft' | 'scheduled'>
  repeatRule?: RepeatRule
  aiPrompt?: string
}

export async function createScheduledPost(input: CreatePostInput): Promise<ScheduledPost> {
  const client = requireSupabase()
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) throw new Error('ログインしていません')

  const row = {
    id: crypto.randomUUID(),
    user_id: user.id,
    status: input.status,
    scheduled_at: input.scheduledAt ?? null,
    segments: input.segments,
    repeat_rule: input.repeatRule ?? null,
    ai_prompt: input.aiPrompt ?? null,
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await client.from(TABLE).insert(row).select().single()
  if (error) throw new Error(`予約の保存に失敗しました: ${error.message}`)
  return fromRow(data as ScheduledPostRow)
}

/** 複数の下書きを一度に作る。AI一括生成の保存で使う。 */
export async function createScheduledPosts(inputs: CreatePostInput[]): Promise<ScheduledPost[]> {
  if (inputs.length === 0) return []
  const client = requireSupabase()
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) throw new Error('ログインしていません')

  const now = new Date().toISOString()
  const rows = inputs.map((input) => ({
    id: crypto.randomUUID(),
    user_id: user.id,
    status: input.status,
    scheduled_at: input.scheduledAt ?? null,
    segments: input.segments,
    repeat_rule: input.repeatRule ?? null,
    ai_prompt: input.aiPrompt ?? null,
    updated_at: now,
  }))
  const { data, error } = await client.from(TABLE).insert(rows).select()
  if (error) throw new Error(`予約の一括保存に失敗しました: ${error.message}`)
  return (data as ScheduledPostRow[]).map(fromRow)
}

export interface UpdatePostInput {
  segments?: PostSegment[]
  scheduledAt?: string | null
  status?: ScheduledPostStatus
  repeatRule?: RepeatRule | null
  /** 再予約するときに前回の失敗理由を消すため。 */
  clearError?: boolean
}

export async function updateScheduledPost(id: string, input: UpdatePostInput): Promise<void> {
  const client = requireSupabase()
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (input.segments !== undefined) patch.segments = input.segments
  if (input.scheduledAt !== undefined) patch.scheduled_at = input.scheduledAt
  if (input.status !== undefined) patch.status = input.status
  if (input.repeatRule !== undefined) patch.repeat_rule = input.repeatRule
  if (input.clearError) {
    patch.error_message = null
    patch.attempt_count = 0
  }
  const { error } = await client.from(TABLE).update(patch).eq('id', id)
  if (error) throw new Error(`予約の更新に失敗しました: ${error.message}`)
}

export async function deleteScheduledPost(id: string): Promise<void> {
  const client = requireSupabase()
  const { error } = await client.from(TABLE).delete().eq('id', id)
  if (error) throw new Error(`予約の削除に失敗しました: ${error.message}`)
}

// ---------------------------------------------------------------
// 画像
// ---------------------------------------------------------------

/**
 * 画像をSupabase Storageへ上げ、投稿本文に紐付けられる形にして返す。
 * 予約時刻にブラウザが閉じていてもサーバー側の投稿処理が読めるよう、
 * IndexedDBではなくStorageに置く点が重要。
 */
export async function uploadPostMedia(file: File): Promise<{ path: string; mime: string }> {
  const client = requireSupabase()
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) throw new Error('ログインしていません')

  const ext = file.name.split('.').pop()?.toLowerCase() || 'bin'
  const path = `${user.id}/${crypto.randomUUID()}.${ext}`
  const { error } = await client.storage.from(MEDIA_BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
  })
  if (error) throw new Error(`画像のアップロードに失敗しました: ${error.message}`)
  return { path, mime: file.type }
}

/** サムネイル表示用の署名付きURL（1時間有効）。 */
export async function signMediaUrl(path: string): Promise<string | undefined> {
  const client = requireSupabase()
  const { data, error } = await client.storage.from(MEDIA_BUCKET).createSignedUrl(path, 3600)
  if (error) return undefined
  return data?.signedUrl
}

export async function deletePostMedia(path: string): Promise<void> {
  const client = requireSupabase()
  await client.storage.from(MEDIA_BUCKET).remove([path])
}

// ---------------------------------------------------------------
// X連携状態
// ---------------------------------------------------------------

export async function fetchXAccountStatus(): Promise<XAccountStatus | undefined> {
  const client = requireSupabase()
  // トークン本体はRLSで完全に隠してあるため、専用関数経由で表示用の情報だけ取る。
  const { data, error } = await client.rpc('my_x_account')
  if (error) throw new Error(`X連携状態の取得に失敗しました: ${error.message}`)
  const row = (data as { x_user_id: string; username: string; connected_at: string }[] | null)?.[0]
  if (!row) return undefined
  return { xUserId: row.x_user_id, username: row.username, connectedAt: row.connected_at }
}

// ---------------------------------------------------------------
// サマリ
// ---------------------------------------------------------------

/** 「今どれくらい予約してるか」を出すための集計。 */
export function summarize(posts: ScheduledPost[], now = new Date()): ScheduleSummary {
  const summary: ScheduleSummary = {
    draft: 0,
    scheduled: 0,
    posted: 0,
    failed: 0,
    repeating: 0,
    dueToday: 0,
  }
  const endOfToday = new Date(now)
  endOfToday.setHours(23, 59, 59, 999)

  let next: string | undefined
  for (const post of posts) {
    // 繰り返しテンプレートは実際の投稿1件ではないので、予約件数とは別枠で数える。
    if (post.repeatRule && !post.repeatParentId) {
      summary.repeating += 1
      continue
    }
    switch (post.status) {
      case 'draft':
        summary.draft += 1
        break
      case 'scheduled':
      case 'publishing': {
        summary.scheduled += 1
        if (post.scheduledAt) {
          const at = new Date(post.scheduledAt)
          if (at >= now && at <= endOfToday) summary.dueToday += 1
          if (at >= now && (!next || post.scheduledAt < next)) next = post.scheduledAt
        }
        break
      }
      case 'posted':
        summary.posted += 1
        break
      case 'failed':
        summary.failed += 1
        break
      default:
        break
    }
  }
  summary.nextScheduledAt = next
  return summary
}

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireCronSecret, UnauthorizedError } from './_lib/auth.js'
import { getSupabaseAdmin } from './_lib/supabaseAdmin.js'
import {
  createPost,
  refreshAccessToken,
  setMediaAltText,
  uploadMedia,
  XApiError,
} from './_lib/xClient.js'
import { nextOccurrence } from '../src/lib/schedule/repeat.js'
import type { PostSegment, RepeatRule } from '../src/lib/schedule/types.js'

// Supabase の pg_cron から毎分呼ばれ、投稿時刻を過ぎた予約をXへ送る。
// ブラウザが閉じていても動くよう、処理は完全にサーバー側で完結する。

const MEDIA_BUCKET = 'x-post-media'
const MAX_POSTS_PER_RUN = 20
const MAX_ATTEMPTS = 3
/** publishing のまま固まった行を復旧するまでの猶予。 */
const LOCK_TIMEOUT_MINUTES = 10

interface PostRow {
  id: string
  user_id: string
  segments: PostSegment[]
  scheduled_at: string
  attempt_count: number
  repeat_parent_id: string | null
}

interface XAccountRow {
  user_id: string
  access_token: string
  refresh_token: string
  expires_at: string
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    requireCronSecret(
      (req.headers['x-cron-secret'] as string | undefined) ??
        req.headers.authorization?.replace(/^Bearer\s+/i, '')
    )
  } catch (error) {
    const status = error instanceof UnauthorizedError ? 401 : 500
    return res.status(status).json({ error: (error as Error).message })
  }

  const db = getSupabaseAdmin()
  const startedAt = new Date()
  const result = { recovered: 0, materialized: 0, posted: 0, failed: 0, retrying: 0 }

  try {
    result.recovered = await recoverStalePosts()
    result.materialized = await materializeRepeats()

    const { data, error } = await db
      .from('scheduled_posts')
      .select('id, user_id, segments, scheduled_at, attempt_count, repeat_parent_id')
      .eq('status', 'scheduled')
      .lte('scheduled_at', startedAt.toISOString())
      .order('scheduled_at', { ascending: true })
      .limit(MAX_POSTS_PER_RUN)
    if (error) throw new Error(`予約の取得に失敗しました: ${error.message}`)

    const due = (data ?? []) as PostRow[]
    // 同じユーザーのトークンを何度も更新しないようキャッシュする。
    const tokenCache = new Map<string, string>()

    for (const post of due) {
      const outcome = await publishOne(post, tokenCache)
      if (outcome === 'posted') result.posted += 1
      else if (outcome === 'retrying') result.retrying += 1
      else result.failed += 1
    }

    return res.status(200).json({ ok: true, ...result })
  } catch (error) {
    console.error('publishDue failed:', error)
    return res.status(500).json({ error: (error as Error).message, ...result })
  }
}

/**
 * publishing のまま取り残された行を scheduled に戻す。
 * 関数がタイムアウトで強制終了した場合など、ロックを解除する主体がいなくなると
 * その予約は永久に投稿されないままになるため、時間経過で必ず拾い直す。
 */
async function recoverStalePosts(): Promise<number> {
  const db = getSupabaseAdmin()
  const threshold = new Date(Date.now() - LOCK_TIMEOUT_MINUTES * 60_000).toISOString()

  // すでにXへ出てしまった投稿を「未投稿」に戻すと二重投稿になる。
  // 投稿IDが記録されている行は、投稿済みとして確定させる。
  const { error: postedError } = await db
    .from('scheduled_posts')
    .update({ status: 'posted', locked_at: null })
    .eq('status', 'publishing')
    .lt('locked_at', threshold)
    .not('posted_tweet_ids', 'is', null)
  if (postedError) console.error('recoverStalePosts (posted) failed:', postedError.message)

  const { data, error } = await db
    .from('scheduled_posts')
    .update({ status: 'scheduled', locked_at: null })
    .eq('status', 'publishing')
    .lt('locked_at', threshold)
    .is('posted_tweet_ids', null)
    .select('id')
  if (error) {
    console.error('recoverStalePosts failed:', error.message)
    return 0
  }
  return data?.length ?? 0
}

/**
 * 繰り返し予約のテンプレートから、次回分の実体行を作る。
 * 未投稿の実体行がまだ残っているテンプレートは何もしない（先の分を無限に作らない）。
 */
async function materializeRepeats(): Promise<number> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('scheduled_posts')
    .select('id, user_id, segments, repeat_rule, created_at')
    .not('repeat_rule', 'is', null)
    .is('repeat_parent_id', null)
    .eq('status', 'scheduled')
  if (error) {
    console.error('materializeRepeats failed:', error.message)
    return 0
  }

  const templates = (data ?? []) as {
    id: string
    user_id: string
    segments: PostSegment[]
    repeat_rule: RepeatRule
    created_at: string
  }[]

  let created = 0
  for (const template of templates) {
    const { count, error: countError } = await db
      .from('scheduled_posts')
      .select('id', { count: 'exact', head: true })
      .eq('repeat_parent_id', template.id)
      .in('status', ['scheduled', 'publishing'])
    if (countError) {
      console.error('materializeRepeats count failed:', countError.message)
      continue
    }
    if ((count ?? 0) > 0) continue

    const next = nextOccurrence(template.repeat_rule, new Date().toISOString(), template.created_at)
    if (!next) {
      // until を過ぎた等でもう予定がない。テンプレート自体を終了させる。
      await db.from('scheduled_posts').update({ status: 'posted' }).eq('id', template.id)
      continue
    }

    const { error: insertError } = await db.from('scheduled_posts').insert({
      id: crypto.randomUUID(),
      user_id: template.user_id,
      status: 'scheduled',
      scheduled_at: next,
      segments: template.segments,
      repeat_parent_id: template.id,
      updated_at: new Date().toISOString(),
    })
    if (insertError) {
      console.error('materializeRepeats insert failed:', insertError.message)
      continue
    }
    created += 1
  }
  return created
}

type Outcome = 'posted' | 'failed' | 'retrying'

async function publishOne(post: PostRow, tokenCache: Map<string, string>): Promise<Outcome> {
  const db = getSupabaseAdmin()

  // 二重投稿を防ぐロック。status が scheduled のままの行だけを publishing にできるので、
  // 万一この関数が同時に2つ走っても、更新できた側だけが投稿する。
  const { data: locked, error: lockError } = await db
    .from('scheduled_posts')
    .update({ status: 'publishing', locked_at: new Date().toISOString() })
    .eq('id', post.id)
    .eq('status', 'scheduled')
    .select('id')
  if (lockError || !locked || locked.length === 0) return 'retrying'

  try {
    const accessToken = await getAccessToken(post.user_id, tokenCache)
    const tweetIds = await postThread(accessToken, post)

    const { error: saveError } = await db
      .from('scheduled_posts')
      .update({
        status: 'posted',
        posted_tweet_ids: tweetIds,
        locked_at: null,
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', post.id)
    if (saveError) {
      // 投稿自体は成功しているのに publishing のまま残ると、復旧処理が拾って
      // 二重投稿しかねない。ここは必ず声を上げる（復旧側でも投稿済みは除外している）。
      console.error(`投稿は成功したが状態の保存に失敗: ${post.id}`, saveError.message)
    }
    return 'posted'
  } catch (error) {
    const attempts = post.attempt_count + 1
    const retryable = error instanceof XApiError ? error.retryable : false
    const willRetry = retryable && attempts < MAX_ATTEMPTS

    await db
      .from('scheduled_posts')
      .update({
        status: willRetry ? 'scheduled' : 'failed',
        attempt_count: attempts,
        error_message: (error as Error).message.slice(0, 1000),
        locked_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', post.id)

    console.error(`publish failed for ${post.id} (attempt ${attempts}):`, error)
    return willRetry ? 'retrying' : 'failed'
  }
}

/** 期限が近ければ更新しつつ、有効なアクセストークンを返す。 */
async function getAccessToken(userId: string, cache: Map<string, string>): Promise<string> {
  const cached = cache.get(userId)
  if (cached) return cached

  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('x_accounts')
    .select('user_id, access_token, refresh_token, expires_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(`X連携情報の取得に失敗しました: ${error.message}`)
  if (!data) throw new XApiError('Xアカウントが連携されていません', 400, false)

  const account = data as XAccountRow
  // 失効の5分前から更新する。投稿の途中で切れるより早めに更新した方が安全。
  const expiresSoon = new Date(account.expires_at).getTime() - Date.now() < 5 * 60_000
  if (!expiresSoon) {
    cache.set(userId, account.access_token)
    return account.access_token
  }

  // Xのリフレッシュトークンは使い捨てで、更新のたびに新しいものが返る。
  // 保存に失敗すると次回以降ずっと更新できなくなるため、必ず書き戻す。
  const tokens = await refreshAccessToken(account.refresh_token)
  const { error: saveError } = await db
    .from('x_accounts')
    .update({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_at: tokens.expiresAt,
      scope: tokens.scope,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
  if (saveError) throw new Error(`トークンの保存に失敗しました: ${saveError.message}`)

  cache.set(userId, tokens.accessToken)
  return tokens.accessToken
}

/** スレッド（連投）に対応した投稿処理。2件目以降は直前の投稿への返信として繋げる。 */
async function postThread(accessToken: string, post: PostRow): Promise<string[]> {
  const tweetIds: string[] = []
  try {
    for (const segment of post.segments) {
      const mediaIds: string[] = []
      for (const media of segment.media ?? []) {
        const bytes = await downloadMedia(media.path)
        const mediaId = await uploadMedia(accessToken, bytes, media.mime)
        if (media.altText) await setMediaAltText(accessToken, mediaId, media.altText)
        mediaIds.push(mediaId)
      }

      const tweetId = await createPost(accessToken, {
        text: segment.text,
        mediaIds,
        inReplyToTweetId: tweetIds.at(-1),
      })
      tweetIds.push(tweetId)
    }
    return tweetIds
  } catch (error) {
    // スレッドの途中で失敗した場合、すでに投稿した分は取り消せない。
    // 何件目まで出たのかをエラー本文に残して、ユーザーが手で続きを書けるようにする。
    if (tweetIds.length > 0) {
      await getSupabaseAdmin()
        .from('scheduled_posts')
        .update({ posted_tweet_ids: tweetIds })
        .eq('id', post.id)
      throw new XApiError(
        `スレッドの${tweetIds.length + 1}件目で失敗しました（${tweetIds.length}件は投稿済み）: ${(error as Error).message}`,
        error instanceof XApiError ? error.status : 500,
        false
      )
    }
    throw error
  }
}

async function downloadMedia(path: string): Promise<Uint8Array> {
  const { data, error } = await getSupabaseAdmin().storage.from(MEDIA_BUCKET).download(path)
  if (error || !data) throw new Error(`画像の読み込みに失敗しました: ${error?.message ?? path}`)
  return new Uint8Array(await data.arrayBuffer())
}

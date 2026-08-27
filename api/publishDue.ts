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
import { anthropicApiKey } from './_lib/postWriter.js'
import { RECENT_POSTS_TO_AVOID, writeDailyPost } from './_lib/dailyWriter.js'
import { isOverLimit } from '../src/lib/schedule/textLength.js'
import type { PostSegment, RepeatRule } from '../src/lib/schedule/types.js'

// Supabase の pg_cron から毎分呼ばれ、投稿時刻を過ぎた予約をXへ送る。
// ブラウザが閉じていても動くよう、処理は完全にサーバー側で完結する。

const MEDIA_BUCKET = 'x-post-media'
const MAX_POSTS_PER_RUN = 20
const MAX_ATTEMPTS = 3
/** publishing のまま固まった行を復旧するまでの猶予。 */
const LOCK_TIMEOUT_MINUTES = 10
/**
 * 1回の実行でAIに書かせる本数の上限。
 * この関数は毎分呼ばれるので、AIおまかせの繰り返しが何本あっても数分で行き渡る。
 * 上限を置かないと、繰り返しを大量に登録した日に1回の実行が関数の実行時間を
 * 使い切り、投稿そのものが出せなくなる。
 */
const MAX_AI_GENERATIONS_PER_RUN = 2
/** ここを過ぎたら新しい生成を始めない。関数の実行時間(60秒)を使い切らないための線引き。 */
const AI_BUDGET_MS = 30_000
/** 1回の生成に許す時間。応答が返らないまま実行時間を食い潰させない。 */
const AI_TIMEOUT_MS = 20_000
/** 生成に失敗したテンプレートをやり直す間隔（分）。 */
const AI_RETRY_INTERVAL_MINUTES = 15

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
  const result = { recovered: 0, materialized: 0, generated: 0, posted: 0, failed: 0, retrying: 0 }

  try {
    result.recovered = await recoverStalePosts()

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

    // 次回分の用意は投稿のあと。AIおまかせの繰り返しではここでAIを呼ぶので、
    // 先に走らせると、その待ち時間のぶん時刻を過ぎた投稿が遅れる。
    const materialized = await materializeRepeats(startedAt)
    result.materialized = materialized.created
    result.generated = materialized.generated

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

interface TemplateRow {
  id: string
  user_id: string
  segments: PostSegment[]
  repeat_rule: RepeatRule
  error_message: string | null
  created_at: string
}

/**
 * 生成に失敗したテンプレートを、この実行でやり直してよいか。
 *
 * 失敗が内容そのものに起因する場合（AIが書くのを断る題材、毎回長くなりすぎる題材）、
 * 毎分そのまま叩き直すと一日中AIを呼び続けて課金だけが積み上がる。
 * 一方で「一定回数で諦める」にすると、AI側の一時的な不調で止まったまま
 * 二度と投稿されなくなる。そこで、やり直しは止めずに間隔だけ空ける。
 *
 * 判定に時刻そのものを使っているのは、テンプレートに「最後に試した時刻」を
 * 持たせずに済ませるため（本人が設定を直したときの updated_at と区別できない）。
 */
function canRetryGeneration(startedAt: Date): boolean {
  return startedAt.getUTCMinutes() % AI_RETRY_INTERVAL_MINUTES === 0
}

/**
 * 繰り返し予約のテンプレートから、次回分の実体行を作る。
 * 未投稿の実体行がまだ残っているテンプレートは何もしない（先の分を無限に作らない）。
 *
 * AIおまかせのテンプレートでは、ここで1回ぶんの本文をAIに書かせる。
 * 毎日の投稿は前回が出た直後（＝おおよそ1日前）に作られるので、失敗しても
 * 次の毎分実行で作り直す余地が丸1日ぶん残る。
 */
async function materializeRepeats(
  startedAt: Date
): Promise<{ created: number; generated: number }> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('scheduled_posts')
    .select('id, user_id, segments, repeat_rule, error_message, created_at')
    .not('repeat_rule', 'is', null)
    .is('repeat_parent_id', null)
    .eq('status', 'scheduled')
  if (error) {
    console.error('materializeRepeats failed:', error.message)
    return { created: 0, generated: 0 }
  }

  const templates = (data ?? []) as TemplateRow[]

  let created = 0
  let generated = 0
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

    let segments = template.segments
    if (template.repeat_rule.autoGenerate) {
      // 予算切れの回は何も作らずに見送る。次の実行で拾い直せる。
      if (generated >= MAX_AI_GENERATIONS_PER_RUN) continue
      if (Date.now() - startedAt.getTime() > AI_BUDGET_MS) continue
      if (template.error_message && !canRetryGeneration(startedAt)) continue

      const written = await generateSegments(template, next)
      if (!written) continue
      segments = written
      generated += 1
    }

    const { error: insertError } = await db.from('scheduled_posts').insert({
      id: crypto.randomUUID(),
      user_id: template.user_id,
      status: 'scheduled',
      scheduled_at: next,
      segments,
      repeat_parent_id: template.id,
      updated_at: new Date().toISOString(),
    })
    if (insertError) {
      console.error('materializeRepeats insert failed:', insertError.message)
      continue
    }
    created += 1
    // 前回の生成に失敗していた場合の注意書きを消す。残したままだと、いま動いて
    // いるのに「作れませんでした」が一覧に出続ける。
    await clearTemplateError(template.id)
  }
  return { created, generated }
}

/**
 * AIおまかせの1回ぶんの本文を書かせる。
 * 作れなかったときは undefined を返し、理由をテンプレートに残す。
 * ここで代わりに前回と同じ本文を入れてしまうと、毎日同じ文章が出ているのに
 * 本人はAIが書いていると思ったまま、という一番気づけない壊れ方になる。
 */
async function generateSegments(
  template: TemplateRow,
  scheduledAt: string
): Promise<PostSegment[] | undefined> {
  const topic = template.repeat_rule.aiTopic?.trim()
  if (!topic) {
    await noteTemplateError(template.id, 'AIおまかせのお題が空です。繰り返しの設定を開いて書いてください')
    return undefined
  }

  const apiKey = anthropicApiKey()
  if (!apiKey) {
    await noteTemplateError(template.id, 'ANTHROPIC_API_KEY が設定されていないため、本文を作れませんでした')
    return undefined
  }

  try {
    const written = await writeDailyPost(
      apiKey,
      {
        topic,
        recentTexts: await recentTexts(template.id),
        scheduledAt,
        timeZone: template.repeat_rule.timeZone,
      },
      AI_TIMEOUT_MS
    )
    const text = written?.segments[0]?.trim()
    if (!text) {
      await noteTemplateError(template.id, 'AIから本文を受け取れませんでした。あとでもう一度試します')
      return undefined
    }
    // 上限を超えた本文をそのまま予約すると、投稿の時刻が来てからXに拒否され、
    // 「失敗」だけが残ってその日の投稿が消える。予約に入れる前に弾く。
    if (isOverLimit(text)) {
      await noteTemplateError(
        template.id,
        'AIが作った本文が文字数の上限を超えていました。あとでもう一度試します（お題を短めの指示にすると通りやすくなります）'
      )
      return undefined
    }
    // 画像はテンプレートに付けられない（AIおまかせでは本文欄を出していない）ので常に空。
    return [{ text, media: [] }]
  } catch (error) {
    await noteTemplateError(
      template.id,
      `本文の生成に失敗しました: ${(error as Error).message}`.slice(0, 1000)
    )
    return undefined
  }
}

/** 同じ話を繰り返させないために、この繰り返しで投稿済みの本文を新しい順に集める。 */
async function recentTexts(templateId: string): Promise<string[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('scheduled_posts')
    .select('segments')
    .eq('repeat_parent_id', templateId)
    .eq('status', 'posted')
    .order('scheduled_at', { ascending: false })
    .limit(RECENT_POSTS_TO_AVOID)
  if (error) {
    // 過去分が読めなくても投稿は作れる。内容が似る可能性が上がるだけなので止めない。
    console.error('recentTexts failed:', error.message)
    return []
  }
  return ((data ?? []) as { segments: PostSegment[] }[])
    .map((row) => (row.segments ?? []).map((segment) => segment.text).join('\n'))
    .filter((text) => text.trim())
}

/**
 * テンプレートに失敗理由を残す。status は scheduled のままにする。
 * failed にすると次の実行で拾われなくなり、直った後も二度と投稿されない。
 */
async function noteTemplateError(templateId: string, message: string): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from('scheduled_posts')
    .update({ error_message: message, updated_at: new Date().toISOString() })
    .eq('id', templateId)
  if (error) console.error('noteTemplateError failed:', error.message)
}

async function clearTemplateError(templateId: string): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from('scheduled_posts')
    .update({ error_message: null })
    .eq('id', templateId)
    .not('error_message', 'is', null)
  if (error) console.error('clearTemplateError failed:', error.message)
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

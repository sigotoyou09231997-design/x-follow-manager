import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireCronSecret, UnauthorizedError } from './_lib/auth.js'
import { getSupabaseAdmin } from './_lib/supabaseAdmin.js'
import { createPost, deletePost, fetchOwnPosts, setMediaAltText, uploadMedia, XApiError } from './_lib/xClient.js'
import { getAccessToken } from './_lib/xToken.js'
import { nextOccurrence } from '../src/lib/schedule/repeat.js'
import { anthropicApiKey } from './_lib/postWriter.js'
import { RECENT_POSTS_TO_AVOID, writeDailyPost } from './_lib/dailyWriter.js'
import { topUpAll } from './_lib/autopilotEngine.js'
import { deletePreviousAutopilotPosts, type CleanupDeps } from './_lib/autopilotCleanup.js'
import { pullForwardTime } from '../src/lib/xAutopilot/approve.js'
import { supabaseAutopilotStore } from './_lib/autopilotStore.js'
import { writeAutopilotPost, writeProfile } from './_lib/autopilotWriter.js'
import { supabasePosterWatchDeps, watchPosters } from './_lib/posterWatch.js'
import { isOverLimit } from '../src/lib/schedule/textLength.js'
import type { PostSegment, RepeatRule } from '../src/lib/schedule/types.js'
import { AUTOPILOT_PREFIX, DELETED_MARK } from '../src/lib/xAutopilot/types.js'

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
/**
 * 「確認待ち」のまま、投稿時刻からこの時間が過ぎた自動運転の予約は、取り消す（確認されずに古くなった文を、
 * いつまでも一覧に残さない。押してもすでに時機を逃した投稿になるため）。本人が嫌がったわけではないので、取り消しの印は付けない。
 */
const STALE_DRAFT_HOURS = 6
/** X の自動運転で、前回うまくいかなかった人をやり直す間隔（分）。 */
const AUTOPILOT_RETRY_INTERVAL_MINUTES = 5

interface PostRow {
  id: string
  user_id: string
  segments: PostSegment[]
  scheduled_at: string
  attempt_count: number
  repeat_parent_id: string | null
  ai_prompt: string | null
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
  const result = {
    recovered: 0,
    materialized: 0,
    generated: 0,
    autopilot: 0,
    posted: 0,
    failed: 0,
    retrying: 0,
    posterSilent: 0,
    posterNotified: 0,
  }

  // Mac の自動投稿（ディスコード・Yay）が止まっていないかの見張り。予約の投稿とは別の仕事なので、
  // 待たずに並べて走らせ、応答の直前に結果だけ受け取る（投稿の仕事を遅らせない）。中で失敗は握りつぶす
  const watching = watchPosterHealth()

  try {
    result.recovered = await recoverStalePosts()
    await expireStaleAutopilotDrafts(startedAt)

    const { data, error } = await db
      .from('scheduled_posts')
      .select('id, user_id, segments, scheduled_at, attempt_count, repeat_parent_id, ai_prompt')
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

    // 確認してから投稿する設定の人は、先に投稿可能にした予約が出たあと、残りの投稿可能な予約を前に詰める
    // （元の時刻のまま、何時間も待たされないように）。失敗しても、投稿そのものには影響させない。
    await pullForwardApproved(startedAt)

    // 次回分の用意は投稿のあと。AIおまかせの繰り返しではここでAIを呼ぶので、
    // 先に走らせると、その待ち時間のぶん時刻を過ぎた投稿が遅れる。
    const materialized = await materializeRepeats(startedAt)
    result.materialized = materialized.created
    result.generated = materialized.generated

    // X の自動運転の補充は、さらにそのあと。投稿を出す仕事を最優先にするため、ここで失敗しても
    // 上の結果（投稿・次回分の用意）は変えない。AIを呼ぶ本数は、AIおまかせの繰り返しと合わせて上限まで。
    result.autopilot = await topUpAutopilots(startedAt, MAX_AI_GENERATIONS_PER_RUN - materialized.generated)

    await settleWatch()

    return res.status(200).json({ ok: true, ...result })
  } catch (error) {
    console.error('publishDue failed:', error)
    // 予約の仕事が失敗した日でも、見張りは止めない（応答を返すと関数が止まるので、その前に待つ）
    await settleWatch()
    return res.status(500).json({ error: (error as Error).message, ...result })
  }

  async function settleWatch(): Promise<void> {
    const watch = await watching
    result.posterSilent = watch.silent
    result.posterNotified = watch.notified
  }
}

/**
 * Mac の投稿役の報告が途絶えていれば、持ち主の端末へ通知する（中身は _lib/posterWatch.ts）。
 * 予約の投稿とは無関係な見張りなので、ここでの失敗は握りつぶして記録するだけにする
 * （見張りの不具合で、X への予約投稿まで 500 にしないため）。
 */
async function watchPosterHealth(): Promise<{ silent: number; notified: number }> {
  try {
    return await watchPosters(supabasePosterWatchDeps())
  } catch (error) {
    console.error('publishDue: 投稿役の見張りに失敗しました:', (error as Error).message)
    return { silent: 0, notified: 0 }
  }
}

/**
 * X の自動運転: ON の人について、先の枠（今日の残り〜数日先）に、まだ作っていない投稿を予約として並べる。
 * 作るのは AI を呼ぶ重い処理なので、予算（時間・本数）を使い切っていたら何もしない。次の毎分実行で続きを作る。
 * ここでの失敗は握りつぶして記録するだけにする（予約の投稿そのものを巻き込まないため）。
 */
async function topUpAutopilots(startedAt: Date, allowance: number): Promise<number> {
  if (allowance <= 0) return 0
  const apiKey = anthropicApiKey()
  if (!apiKey) return 0
  try {
    const outcome = await topUpAll(
      {
        store: supabaseAutopilotStore(),
        now: () => new Date(),
        apiKey: () => apiKey,
        getAccessToken: (userId) => getAccessToken(userId),
        fetchOwnPosts,
        writeProfile,
        writePost: writeAutopilotPost,
        aiTimeoutMs: AI_TIMEOUT_MS,
        canStartAi: () => Date.now() - startedAt.getTime() < AI_BUDGET_MS,
      },
      { maxGenerations: allowance, retryEveryMinutes: AUTOPILOT_RETRY_INTERVAL_MINUTES }
    )
    return outcome.generated
  } catch (error) {
    console.error('topUpAutopilots failed:', error)
    return 0
  }
}

/**
 * 確認してから投稿する設定（requireApproval）の人について、いちばん早い投稿可能な予約を、
 * 「直前の投稿から最低間隔・いますぐ」の時刻まで前倒しする（決め方は src/lib/xAutopilot/approve.ts）。
 * 確認なしの自動投稿の人は、時刻をばらして散らす決まりなので触らない。
 */
async function pullForwardApproved(now: Date): Promise<void> {
  try {
    const db = getSupabaseAdmin()
    const users = await supabaseAutopilotStore().listEnabled(50)
    for (const row of users) {
      if (!row.settings.requireApproval) continue
      const { data, error } = await db
        .from('scheduled_posts')
        .select('id, status, scheduled_at, segments')
        .eq('user_id', row.userId)
        .like('ai_prompt', `${AUTOPILOT_PREFIX}%`)
        .in('status', ['scheduled', 'publishing', 'posted'])
        .order('scheduled_at', { ascending: false })
        .limit(60)
      if (error) {
        console.error('pullForwardApproved failed:', error.message)
        continue
      }
      const rows = ((data ?? []) as { id: string; status: string; scheduled_at: string; segments: PostSegment[] | null }[]).map((r) => ({
        id: r.id,
        status: r.status,
        scheduledAt: r.scheduled_at,
        fixedTime: r.segments?.[0]?.fixedTime === true,
      }))
      const move = pullForwardTime(rows, now.getTime())
      if (!move) continue
      const { error: updateError } = await db
        .from('scheduled_posts')
        .update({ scheduled_at: move.scheduledAt, updated_at: now.toISOString() })
        .eq('id', move.id)
        .eq('status', 'scheduled')
      if (updateError) console.error('pullForwardApproved update failed:', updateError.message)
    }
  } catch (error) {
    console.error('pullForwardApproved failed:', (error as Error).message)
  }
}

/** 確認されないまま古くなった自動運転の「確認待ち」を取り消す。失敗しても、予約の投稿は止めない。 */
async function expireStaleAutopilotDrafts(now: Date): Promise<void> {
  const threshold = new Date(now.getTime() - STALE_DRAFT_HOURS * 3_600_000).toISOString()
  const { error } = await getSupabaseAdmin()
    .from('scheduled_posts')
    .update({ status: 'canceled', updated_at: now.toISOString() })
    .eq('status', 'draft')
    .like('ai_prompt', `${AUTOPILOT_PREFIX}%`)
    .lt('scheduled_at', threshold)
  if (error) console.error('expireStaleAutopilotDrafts failed:', error.message)
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
    // X の自動運転の投稿なら、前に自動運転が出した投稿を X から消す（いつも最新の1本だけが残る）。
    // 投稿そのものは出せているので、ここの失敗は結果に影響させない。
    if (post.ai_prompt?.startsWith(AUTOPILOT_PREFIX)) await removePreviousAutopilotPosts(post, accessToken)
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

/**
 * 今出した自動運転の投稿より前の、自動運転の投稿を X から消す（中身は _lib/autopilotCleanup.ts）。
 * 消すのは、自動運転の予約（ai_prompt が autopilot:）として出し、投稿 ID が記録されている行だけ。
 * 本人が自分で書いたツイートやふつうの予約は、ここには入ってこない。
 */
async function removePreviousAutopilotPosts(post: PostRow, accessToken: string): Promise<void> {
  const db = getSupabaseAdmin()
  const deps: CleanupDeps = {
    async loadRule(userId) {
      const row = await supabaseAutopilotStore().get(userId)
      return { on: row.settings.deletePrevious, since: row.settings.deletePreviousFrom }
    },
    async listPrevious(userId, exceptId, since) {
      const { data, error } = await db
        .from('scheduled_posts')
        .select('id, posted_tweet_ids, error_message')
        .eq('user_id', userId)
        .eq('status', 'posted')
        .like('ai_prompt', `${AUTOPILOT_PREFIX}%`)
        .not('posted_tweet_ids', 'is', null)
        .neq('id', exceptId)
        // オンにする前に出た投稿には触れない
        .gte('scheduled_at', since)
        .order('scheduled_at', { ascending: true })
        .limit(200)
      if (error) throw new Error(`前の投稿の取得に失敗しました: ${error.message}`)
      return ((data ?? []) as { id: string; posted_tweet_ids: string[] | null; error_message: string | null }[])
        .filter((row) => row.error_message !== DELETED_MARK)
        .map((row) => ({ id: row.id, tweetIds: row.posted_tweet_ids ?? [] }))
    },
    deleteTweet: (tweetId) => deletePost(accessToken, tweetId),
    async markDeleted(id) {
      const { error } = await db
        .from('scheduled_posts')
        .update({ error_message: DELETED_MARK, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw new Error(error.message)
    },
  }
  try {
    await deletePreviousAutopilotPosts(deps, post.user_id, post.id)
  } catch (error) {
    console.error('removePreviousAutopilotPosts failed:', (error as Error).message)
  }
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

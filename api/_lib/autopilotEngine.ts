import {
  aiCostYen,
  onePostYen,
  PRICE,
  USD_JPY,
} from '../../src/lib/xAutopilot/cost.js'
import { localDate, localMonth, normalizeSettings, planSlots, settingsProblems, type Slot } from '../../src/lib/xAutopilot/slots.js'
import {
  cleanHistory,
  containsUrl,
  maxSimilarity,
  mentionsMinor,
  pickSamples,
  SIMILARITY_LIMIT,
} from '../../src/lib/xAutopilot/text.js'
import {
  emptyUsage,
  type AutopilotSettings,
  type AutopilotUsage,
  type HistoryPost,
  type StyleProfile,
} from '../../src/lib/xAutopilot/types.js'
import { isOverLimit } from '../../src/lib/schedule/textLength.js'
import type { AutopilotRow, AutopilotStore } from './autopilotStore.js'
import type { writeAutopilotPost, writeProfile } from './autopilotWriter.js'
import type { OwnPost } from './xClient.js'

// X の自動運転の本体。保存先・X・AI は deps として受け取るので、本物につながずに動きを確かめられる。
//
//   readHistory  … 自分の過去の投稿を X から読んで保存する（2回目からは差分だけ）
//   buildProfile … 読み込んだ履歴から、AIが「この人らしさ」をまとめる
//   previewPost  … 保存せずに、いまの設定で1本書かせてみる
//   topUp        … 先の枠（今日の残り〜horizonDays 日）に、まだ作っていない投稿を予約として並べる
//   enable / disable / saveSettings … ON・OFF・設定変更

export class EngineError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

export interface EngineDeps {
  store: AutopilotStore
  now: () => Date
  apiKey: () => string | undefined
  getAccessToken: (userId: string) => Promise<string>
  fetchOwnPosts: (
    accessToken: string,
    xUserId: string,
    options: { limit: number; sinceId?: string }
  ) => Promise<OwnPost[]>
  writeProfile: typeof writeProfile
  writePost: typeof writeAutopilotPost
  /** AIを1回呼ぶときの時間の上限（ミリ秒）。 */
  aiTimeoutMs?: number
  /**
   * 新しくAIを呼んでよいか。毎分の実行は関数の実行時間（60秒）に限りがあり、使い切ると投稿そのものが遅れる。
   * 省略すると、いつでも呼んでよい（画面からの操作）。
   */
  canStartAi?: () => boolean
}

/** 文体をまとめるのに最低限いる投稿数。これより少ないと、特徴ではなく偶然を拾ってしまう。 */
export const MIN_HISTORY = 20
/** 履歴として覚えておく上限。保存先の大きさと、AIに渡す量を抑える。 */
export const MAX_HISTORY_KEPT = 400
/** お手本として1回に見せる投稿数。 */
const SAMPLES_PER_POST = 12
/** 内容の重なりを調べる、直近の自動運転の投稿数と、ご本人の実際の投稿数。 */
const RECENT_AUTOPILOT = 15
const RECENT_HISTORY = 30
/** 読み込みの連打を止める間隔。 */
const READ_INTERVAL_MS = 60_000
/** 検査に落ちたとき、書き直させる回数（最初の1回を除く）。 */
const MAX_REWRITES = 1

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 300)

// ------------------------------------------------------------------ 使用状況・上限

/** 今月ぶんの使用状況。月が変わっていたら 0 から数え直す。 */
export function usageFor(row: AutopilotRow, now: Date): AutopilotUsage {
  const month = localMonth(now.getTime(), row.settings.timeZone)
  return row.usage.month === month ? { ...row.usage } : emptyUsage(month)
}

export function budgetMessage(settings: AutopilotSettings): string {
  return `今月の使用額の上限（${settings.monthlyBudgetYen.toLocaleString('ja-JP')}円）に達したため、新しい投稿を作っていません。設定で上限を上げるか、来月を待ってください`
}

function overBudget(usage: AutopilotUsage, settings: AutopilotSettings, nextCostYen: number): boolean {
  return usage.yen + nextCostYen > settings.monthlyBudgetYen
}

// ------------------------------------------------------------------ 履歴の取り込み

const newestId = (history: HistoryPost[]): string | undefined => {
  let best: bigint | undefined
  for (const post of history) {
    try {
      const id = BigInt(post.id)
      if (best === undefined || id > best) best = id
    } catch {
      // 数でない番号は無視する（X の番号は数字）
    }
  }
  return best?.toString()
}

export interface ReadHistoryResult {
  /** X から読んだ件数（課金の対象）。 */
  fetched: number
  /** そのうち新しく加わった件数。 */
  added: number
  total: number
}

export async function readHistory(
  deps: EngineDeps,
  userId: string,
  options: { limit?: number; full?: boolean } = {}
): Promise<ReadHistoryResult> {
  const row = await deps.store.get(userId)
  const now = deps.now()
  const account = await deps.store.xAccount(userId)
  if (!account) throw new EngineError('Xと連携していません。予約投稿タブで「Xと連携」してください')
  if (row.historyFetchedAt && now.getTime() - new Date(row.historyFetchedAt).getTime() < READ_INTERVAL_MS) {
    throw new EngineError('続けて読み込めません。1分ほど待ってからもう一度お試しください', 429)
  }
  const usage = usageFor(row, now)
  if (overBudget(usage, row.settings, 1)) throw new EngineError(budgetMessage(row.settings))

  // 2回目からは、いちばん新しい投稿より後の分だけ読む（読み取りは件数で課金されるため）。
  const sinceId = !options.full && row.history.length > 0 ? newestId(row.history) : undefined
  const accessToken = await deps.getAccessToken(userId)
  const raw = await deps.fetchOwnPosts(accessToken, account.xUserId, { limit: options.limit ?? 200, sinceId })

  const known = new Set(row.history.map((p) => p.id))
  const cleaned = cleanHistory(raw)
  const merged = new Map<string, HistoryPost>()
  for (const post of [...cleaned, ...row.history]) if (!merged.has(post.id)) merged.set(post.id, post)
  const history = [...merged.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX_HISTORY_KEPT)

  usage.yen += raw.length * PRICE.xOwnedReadUsd * USD_JPY
  await deps.store.save(userId, { history, historyFetchedAt: now.toISOString(), usage, lastError: null })
  return { fetched: raw.length, added: cleaned.filter((p) => !known.has(p.id)).length, total: history.length }
}

// ------------------------------------------------------------------ 文体のまとめ

export async function buildProfile(deps: EngineDeps, userId: string): Promise<StyleProfile> {
  const row = await deps.store.get(userId)
  if (row.history.length < MIN_HISTORY) {
    throw new EngineError(
      `文体をまとめるには、投稿が${MIN_HISTORY}件以上必要です（いま${row.history.length}件）。先に過去の投稿を読み込んでください`
    )
  }
  const apiKey = deps.apiKey()
  if (!apiKey) throw new EngineError('ANTHROPIC_API_KEY が設定されていません', 500)

  const now = deps.now()
  const usage = usageFor(row, now)
  if (overBudget(usage, row.settings, 1)) throw new EngineError(budgetMessage(row.settings))

  const profile = await deps.writeProfile({
    apiKey,
    history: row.history,
    quality: row.settings.quality,
    timeoutMs: deps.aiTimeoutMs,
    onUsage: (u) => {
      usage.yen += aiCostYen(row.settings.quality, u.inputTokens, u.outputTokens)
      usage.generations += 1
    },
  })
  await deps.store.save(userId, { profile, profileBuiltAt: now.toISOString(), usage, lastError: null })
  return profile
}

// ------------------------------------------------------------------ 1本書く（検査つき）

/** 書いた文が使えるか調べる。使えない理由を日本語で返す（空なら使える）。 */
export function checkPost(text: string, others: string[]): string[] {
  const problems: string[] = []
  if (!text.trim()) return ['本文が空']
  if (isOverLimit(text)) problems.push('文字数の上限（全角140字）を超えている')
  if (containsUrl(text)) problems.push('URLを含んでいる')
  if (mentionsMinor(text)) problems.push('未成年を連想させる表現を含んでいる')
  if (maxSimilarity(text, others) > SIMILARITY_LIMIT) problems.push('最近の投稿と内容が似すぎている')
  return problems
}

interface GenerateContext {
  deps: EngineDeps
  row: AutopilotRow
  profile: StyleProfile
  usage: AutopilotUsage
  slotAt: string
  /** お手本の選び方を変えるための数（枠ごとに違う値）。 */
  seed: number
  recent: { text: string; at: string }[]
  plannedSameDay: string[]
}

interface Generated {
  text?: string
  problems: string[]
}

/** 検査に落ちたら、理由を伝えて書き直させる。最後の案と、落ちた理由を返す。 */
async function generateOne(ctx: GenerateContext): Promise<Generated> {
  const { deps, row, usage } = ctx
  const apiKey = deps.apiKey()
  if (!apiKey) throw new EngineError('ANTHROPIC_API_KEY が設定されていません', 500)

  const against = [
    ...ctx.recent.map((r) => r.text),
    ...ctx.plannedSameDay,
    ...row.history.slice(0, RECENT_HISTORY).map((p) => p.text),
  ]
  const recentForPrompt = [...ctx.recent.map((r) => r.text), ...row.history.slice(0, 10).map((p) => p.text)].slice(0, RECENT_AUTOPILOT)

  let feedback: string | undefined
  let last: Generated = { problems: ['本文が空'] }
  for (let attempt = 0; attempt <= MAX_REWRITES; attempt++) {
    // 書き直しは、時間に余裕があるときだけ。無ければ、いまある案と理由をそのまま返す。
    if (attempt > 0 && deps.canStartAi && !deps.canStartAi()) break
    const text = await deps.writePost({
      apiKey,
      quality: row.settings.quality,
      profile: ctx.profile,
      samples: pickSamples(row.history, SAMPLES_PER_POST, ctx.seed + attempt),
      recent: recentForPrompt,
      plannedSameDay: ctx.plannedSameDay,
      scheduledAt: ctx.slotAt,
      timeZone: row.settings.timeZone,
      feedback,
      timeoutMs: deps.aiTimeoutMs,
      onUsage: (u) => {
        usage.yen += aiCostYen(row.settings.quality, u.inputTokens, u.outputTokens)
        usage.generations += 1
      },
    })
    const problems = text ? checkPost(text, against) : ['本文が空']
    last = { text, problems }
    if (problems.length === 0) return last
    feedback = problems.join('、')
  }
  return last
}

/** 保存せずに、いまの設定で1本書いてみる。検査に落ちた場合も、最後の案と理由を返す（見て判断してもらう）。 */
export async function previewPost(deps: EngineDeps, userId: string): Promise<Generated & { usage: AutopilotUsage }> {
  const row = await deps.store.get(userId)
  if (!row.profile) throw new EngineError('先に、過去の投稿から文体をまとめてください')
  const now = deps.now()
  const usage = usageFor(row, now)
  if (overBudget(usage, row.settings, onePostYen(row.settings.quality))) throw new EngineError(budgetMessage(row.settings))

  const recent = await deps.store.recentTexts(userId, RECENT_AUTOPILOT)
  const slotAt = new Date(now.getTime() + 3600_000).toISOString()
  const result = await generateOne({
    deps,
    row,
    profile: row.profile,
    usage,
    slotAt,
    seed: now.getTime() >>> 10,
    recent,
    plannedSameDay: [],
  })
  await deps.store.save(userId, { usage })
  return { ...result, usage }
}

// ------------------------------------------------------------------ 枠の補充

export interface TopUpResult {
  created: number
  generated: number
  /** 補充を止めた理由（無ければ undefined）。 */
  error?: string
}

/** 作成済みの枠の記録から、もう要らない古いもの（昨日より前）を落とす。枠の日付は 'YYYY-MM-DD' で始まる。 */
function pruneSlots(slots: string[], timeZone: string, now: Date): string[] {
  const yesterday = localDate(now.getTime() - 86_400_000, timeZone)
  return slots.filter((key) => key.slice(0, 10) >= yesterday)
}

export async function topUp(
  deps: EngineDeps,
  row: AutopilotRow,
  options: { maxGenerations: number }
): Promise<TopUpResult> {
  const result: TopUpResult = { created: 0, generated: 0 }
  if (!row.enabled || !row.profile || options.maxGenerations <= 0) return result

  const now = deps.now()
  const { settings } = row
  const missing: Slot[] = planSlots(now, settings).filter((s) => !row.slots.includes(s.key))
  if (missing.length === 0) return result

  const usage = usageFor(row, now)
  const slots = [...row.slots]
  const recent = await deps.store.recentTexts(row.userId, RECENT_AUTOPILOT)
  const createdToday: { text: string; at: string }[] = []
  let lastError: string | null = null

  for (const slot of missing) {
    if (result.generated >= options.maxGenerations) break
    if (deps.canStartAi && !deps.canStartAi()) break
    if (overBudget(usage, settings, onePostYen(settings.quality))) {
      lastError = budgetMessage(settings)
      break
    }
    const date = localDate(new Date(slot.at).getTime(), settings.timeZone)
    const sameDay = [...createdToday, ...recent]
      .filter((r) => localDate(new Date(r.at).getTime(), settings.timeZone) === date)
      .map((r) => r.text)

    let generated: Generated
    try {
      generated = await generateOne({
        deps,
        row,
        profile: row.profile,
        usage,
        slotAt: slot.at,
        seed: parseInt(slot.key.replace(/\D/g, '').slice(0, 9), 10) || 1,
        recent: [...createdToday, ...recent],
        plannedSameDay: sameDay,
      })
    } catch (error) {
      lastError = `本文の生成に失敗しました: ${errorText(error)}`
      result.generated += 1
      break
    }
    result.generated += 1

    if (!generated.text || generated.problems.length > 0) {
      // 使えない案を予約に入れず、止まって次の機会に回す（毎分叩き直すと費用だけが積み上がる）。
      lastError = `AIの案が検査を通りませんでした（${generated.problems.join('、')}）。しばらくしてもう一度試します`
      break
    }

    try {
      const outcome = await deps.store.insertPost({
        userId: row.userId,
        at: slot.at,
        text: generated.text,
        slotKey: slot.key,
      })
      if (outcome === 'inserted') {
        usage.yen += PRICE.xPostUsd * USD_JPY
        usage.posts += 1
        result.created += 1
        createdToday.push({ text: generated.text, at: slot.at })
      }
      slots.push(slot.key)
    } catch (error) {
      lastError = errorText(error)
      break
    }

    // 1本ごとに記録する。途中で止まっても、作った枠を覚えているので二重に作らない。
    await deps.store.save(row.userId, {
      slots: pruneSlots(slots, settings.timeZone, now),
      usage,
      lastError: null,
    })
  }

  if (lastError) {
    result.error = lastError
    await deps.store.save(row.userId, { usage, slots: pruneSlots(slots, settings.timeZone, now), lastError })
  }
  return result
}

/** 毎分の実行から呼ぶ。ON の人すべてについて、先の枠を補充する（AIを呼ぶ本数は合計で maxGenerations まで）。 */
export async function topUpAll(
  deps: EngineDeps,
  options: { maxGenerations: number; retryEveryMinutes: number }
): Promise<TopUpResult> {
  const total: TopUpResult = { created: 0, generated: 0 }
  const rows = await deps.store.listEnabled(20)
  const minute = deps.now().getUTCMinutes()
  for (const row of rows) {
    if (total.generated >= options.maxGenerations) break
    // 前回うまくいかなかった人は、間隔を空けてやり直す。毎分叩くと、断られる内容で費用だけがかさむ。
    if (row.lastError && minute % options.retryEveryMinutes !== 0) continue
    try {
      const r = await topUp(deps, row, { maxGenerations: options.maxGenerations - total.generated })
      total.created += r.created
      total.generated += r.generated
      if (r.error) total.error = r.error
    } catch (error) {
      console.error('autopilot topUp failed:', errorText(error))
    }
  }
  return total
}

// ------------------------------------------------------------------ ON / OFF / 設定

export async function enable(deps: EngineDeps, userId: string): Promise<TopUpResult> {
  const row = await deps.store.get(userId)
  if (!row.profile) throw new EngineError('先に、過去の投稿から文体をまとめてください')
  if (!(await deps.store.xAccount(userId))) {
    throw new EngineError('Xと連携していません。予約投稿タブで「Xと連携」してください')
  }
  const usage = usageFor(row, deps.now())
  if (overBudget(usage, row.settings, onePostYen(row.settings.quality))) throw new EngineError(budgetMessage(row.settings))

  await deps.store.save(userId, { enabled: true, lastError: null })
  // 最初の1本だけその場で作り、残りは毎分の補充に任せる（画面の応答を待たせすぎないため）。
  return topUp(deps, { ...row, enabled: true, lastError: null }, { maxGenerations: 1 })
}

/** OFF にする。まだ出ていない自動運転の予約は取り消す（止めたあとに出てしまわないように）。 */
export async function disable(deps: EngineDeps, userId: string): Promise<{ canceled: number }> {
  const canceled = await deps.store.cancelUpcoming(userId)
  await deps.store.save(userId, { enabled: false, slots: [], lastError: null })
  return { canceled }
}

/** 枠の決まり方に関わる設定が変わったか。変わると、まだ出ていない予約は作り直す。 */
const slotShapeChanged = (a: AutopilotSettings, b: AutopilotSettings) =>
  a.postsPerDay !== b.postsPerDay ||
  a.windowStart !== b.windowStart ||
  a.windowEnd !== b.windowEnd ||
  a.timeZone !== b.timeZone ||
  a.horizonDays !== b.horizonDays

export async function saveSettings(
  deps: EngineDeps,
  userId: string,
  input: Partial<AutopilotSettings>
): Promise<{ settings: AutopilotSettings; rebuilt: boolean }> {
  const row = await deps.store.get(userId)
  // 画面から来た入力は、直さずに検証する。黙って別の設定にすると、「2回にしたのに1回のまま」のような
  // 設定したのに反映されない状態になる（normalizeSettings は、保存済みの値を読み出すときの直し方）。
  const problems = settingsProblems({ ...row.settings, ...input })
  if (problems.length > 0) throw new EngineError(problems.join('。'), 400)

  const settings = normalizeSettings({ ...row.settings, ...input })
  const rebuilt = row.enabled && slotShapeChanged(row.settings, settings)
  if (rebuilt) {
    await deps.store.cancelUpcoming(userId)
    await deps.store.save(userId, { settings, slots: [], lastError: null })
    // 作り直した予約の最初の1本は、その場で作る（残りは毎分の補充）。設定を変えたのに、
    // 予約の一覧が何分も空のままだと、変えた設定が効いたのか分からない。
    try {
      await topUp(deps, { ...row, settings, slots: [], enabled: true, lastError: null }, { maxGenerations: 1 })
    } catch (error) {
      // 設定の保存そのものは済んでいる。作れなかった理由は topUp が記録するので、ここでは失敗にしない。
      console.error('autopilot rebuild topUp failed:', errorText(error))
    }
  } else {
    await deps.store.save(userId, { settings })
  }
  return { settings, rebuilt }
}

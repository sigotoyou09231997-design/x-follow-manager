import {
  aiCostYen,
  onePostYen,
  PRICE,
  USD_JPY,
} from '../../src/lib/xAutopilot/cost.js'
import {
  crowdedTopics,
  describeCrowded,
  describeRecentStyle,
  mergeCrowded,
  neglectedTopics,
} from '../../src/lib/xAutopilot/recentStyle.js'
import { REFILL_MIN_LEAD_MS } from '../../src/lib/xAutopilot/approve.js'
import { frequentWords, overusedIn, pickFreshThemes } from '../../src/lib/xAutopilot/words.js'
import { isTripleBeat, lengthProblem, openingOf, pickVariety, repeatedEndings, repeatedOpenings } from '../../src/lib/xAutopilot/variety.js'
import { analyzeRejected, blockedWords, describeRejectedTopics, rejectedWordLines } from '../../src/lib/xAutopilot/rejectedAnalysis.js'
import { isLateMorningSlot } from '../../src/lib/xAutopilot/morning.js'
import { localDate, localMonth, normalizeSettings, planSlots, settingsProblems, type Slot } from '../../src/lib/xAutopilot/slots.js'
import {
  cleanHistory,
  containsUrl,
  maxSimilarity,
  mentionsMinor,
  pickSamples,
  SIMILARITY_LIMIT,
  flattenLines,
  uncertainIn,
  vagueGameIn,
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
import type { reviseAutopilotPost, writeAutopilotPost, writeProfile } from './autopilotWriter.js'
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
  /** 書いてある1本を、本人の文体に整える（AI）。 */
  revisePost: typeof reviseAutopilotPost
  /** AIを1回呼ぶときの時間の上限（ミリ秒）。 */
  aiTimeoutMs?: number
  /**
   * 新しくAIを呼んでよいか。毎分の実行は関数の実行時間（60秒）に限りがあり、使い切ると投稿そのものが遅れる。
   * 省略すると、いつでも呼んでよい（画面からの操作）。
   */
  canStartAi?: () => boolean
  /** 確認待ちにしておく文の数の上限。省略すると MAX_PENDING_DRAFTS（1件ずつ）。 */
  maxPendingDrafts?: number
}

/** 文体をまとめるのに最低限いる投稿数。これより少ないと、特徴ではなく偶然を拾ってしまう。 */
export const MIN_HISTORY = 20
/** 履歴として覚えておく上限。保存先の大きさと、AIに渡す量を抑える。 */
export const MAX_HISTORY_KEPT = 400
/** お手本として1回に見せる投稿数。 */
const SAMPLES_PER_POST = 12
/** 内容の重なりを調べる、直近の自動運転の投稿数と、ご本人の実際の投稿数。 */
/** 確認してから投稿する設定で、確認待ちを作り置く日数の下限。 */
export const APPROVAL_HORIZON_DAYS = 4

/** 確認してから投稿する設定で、同時に確認待ちにしておく文の数。AIの文は1件ずつ作る（本人の指示。費用も抑えられる）。 */
export const MAX_PENDING_DRAFTS = 1
const RECENT_AUTOPILOT = 15
/** 使いすぎの言葉を数えるために読む、自動運転の最近の本数。プロンプトに載せるのは RECENT_AUTOPILOT 件だけ。 */
const RECENT_AUTOPILOT_FOR_WORDS = 60
/** まだ書いたことがない題材の候補から外すために読む、本人の最近の投稿の本数。 */
const HUMAN_FOR_WORDS = 150
const RECENT_HISTORY = 30
/** 本人が取り消した投稿のうち、次に書くとき「こういうのは出さない」として見せる件数（新しい順）。 */
const REJECTED_FOR_PROMPT = 10
/** 取り消した文の分析（よく取り消される言葉・話題）に読む本数。プロンプトに文そのものを載せるのは REJECTED_FOR_PROMPT 件だけ。 */
const REJECTED_FOR_ANALYSIS = 300
/** 読み込みの連打を止める間隔。 */
const READ_INTERVAL_MS = 60_000
/** 検査に落ちたとき、書き直させる回数（最初の1回を除く）。 */
const MAX_REWRITES = 2

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

/** 自動運転が投稿した分を、何件ぶんさかのぼって「本人の投稿ではない」と見分けるか。履歴の保存上限（MAX_HISTORY_KEPT）に合わせる。 */
const AUTOPILOT_TWEET_LOOKBACK = 400

/**
 * 履歴（X から読んだ本人のアカウントの投稿）から、自動運転が投稿した分を外す。学習・お手本・傾向の数え方には、
 * 本人が自分で書いた投稿だけを使う。外さないと、自動運転が出した文が履歴に戻って次のお手本になり、AI が好む話題
 * （実例: ハイボールなどお酒）が自分で自分を強めて偏っていった。
 */
async function humanHistory(deps: EngineDeps, row: AutopilotRow): Promise<HistoryPost[]> {
  const ids = new Set(await deps.store.autopilotTweetIds(row.userId, AUTOPILOT_TWEET_LOOKBACK))
  return ids.size === 0 ? row.history : row.history.filter((p) => !ids.has(p.id))
}

/** 履歴がこれより古ければ、文を作る前に読み直す。短すぎると、書くたびに X の読み取りを呼んで費用がかさむ。 */
const FRESH_HISTORY_MS = 2 * 3600_000

/**
 * 文を作る前に、本人の最新の投稿を読み直す（毎回。2時間以内に読んでいれば、読み直さない）。
 * 書き方は変わる（2026年にそれまでの型が消えた）ので、画面のボタンを押した日の履歴のままでは、いずれ古くなる。
 * 差分だけを読み、新しい投稿が無ければ費用は出ない。読めなかった（X の障害・連携切れ・月の上限）ときは、いまある履歴で
 * そのまま書く（読めないことで、投稿の予約が止まらないように）。
 */
async function withFreshHistory(deps: EngineDeps, row: AutopilotRow): Promise<AutopilotRow> {
  const fetchedAt = row.historyFetchedAt ? Date.parse(row.historyFetchedAt) : 0
  if (deps.now().getTime() - fetchedAt < FRESH_HISTORY_MS) return row
  try {
    await readHistory(deps, row.userId)
    const latest = await deps.store.get(row.userId)
    return { ...row, history: latest.history, historyFetchedAt: latest.historyFetchedAt, usage: latest.usage }
  } catch {
    return row
  }
}

export async function buildProfile(deps: EngineDeps, userId: string): Promise<StyleProfile> {
  const row = await deps.store.get(userId)
  // 文体のまとめには、本人が自分で書いた投稿だけを渡す（自動運転が出した分は入れない）。
  const history = await humanHistory(deps, row)
  if (history.length < MIN_HISTORY) {
    throw new EngineError(
      `文体をまとめるには、投稿が${MIN_HISTORY}件以上必要です（いま${history.length}件）。先に過去の投稿を読み込んでください`
    )
  }
  const apiKey = deps.apiKey()
  if (!apiKey) throw new EngineError('ANTHROPIC_API_KEY が設定されていません', 500)

  const now = deps.now()
  const usage = usageFor(row, now)
  if (overBudget(usage, row.settings, 1)) throw new EngineError(budgetMessage(row.settings))

  const profile = await deps.writeProfile({
    apiKey,
    history,
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
  // 作り置きの投稿で、出る日の天気は分からない。本人の指示で、天気・気温の話は書かせない。
  const uncertain = uncertainIn(text)
  if (uncertain.length > 0) problems.push(`天気・気温の話（${uncertain.slice(0, 3).join('・')}）を含んでいる。出る日の天気は分からないので書かない`)
  // どのゲームか分からない文は書かせない（本人の指示。「回復アイテム、大事にしすぎて結局ずっと使えん」のような文）。
  const vague = vagueGameIn(text)
  if (vague.length > 0) problems.push(`どのゲームか分からないゲームの話（${vague.slice(0, 3).join('・')}）。ゲームの話は書かない`)
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
  /** 本人が「取り消す」で外した投稿。同じ話題・型・言い回しを出さないために、AIにも見せ、似すぎの検査にも使う。 */
  rejected: string[]
  /** 本人が自分で書いた投稿（新しい順）。自動運転が投稿した分は外してある（humanHistory）。お手本・傾向・話題の数え方に使う。 */
  history: HistoryPost[]
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
    ...ctx.rejected.slice(0, 60),
    ...ctx.plannedSameDay,
    ...ctx.history.slice(0, RECENT_HISTORY).map((p) => p.text),
  ]
  const autoTexts = ctx.recent.map((r) => r.text)
  const humanTexts = ctx.history.map((p) => p.text)
  const recentForPrompt = [...autoTexts, ...humanTexts.slice(0, 10)].slice(0, RECENT_AUTOPILOT)

  // 毎回、最新の履歴から計算して AI に渡す（AI は呼ばない）。書き方の傾向と、話題の偏り。
  //   多すぎる: 自動運転が最近出した12件のうち3件以上（25%）／本人の最近20件のうち5件以上（30%）の括り
  //   少ない  : 本人がふだん書くのに、最近の30件に1つも出ていない括り（根拠の無い話題は勧めない）
  const recentStyle = describeRecentStyle(ctx.history)
  const crowdedList = mergeCrowded([
    crowdedTopics(autoTexts.slice(0, 12), { minCount: 3, minShare: 0.25 }),
    crowdedTopics(humanTexts.slice(0, 20), { minCount: 5, minShare: 0.3 }),
  ])
  const neglected = neglectedTopics(humanTexts, [...autoTexts.slice(0, 15), ...humanTexts.slice(0, 15)], 3).filter(
    (name) => !crowdedList.some((t) => t.name === name)
  )

  // 言葉の偏り（同じ言葉が何度も出る）と、まだ書いたことがない題材。AI は呼ばない。
  //   使いすぎの言葉: 自動運転が最近出した投稿で、2本以上に出ている言葉。今回は使わせない（案に入っていたら書き直させる）。
  //                   本人が自分で書く言葉（会社・ゲームなど、本人のふだんの題材）は、ここには入れない。偏っていたのは自動運転の側。
  //   新しい題材  : 過去の投稿（本人・自動運転）に1度も出ていない題材の候補を、枠ごとに違う組み合わせで渡す。
  const overused = frequentWords(autoTexts.slice(0, RECENT_AUTOPILOT_FOR_WORDS), 2, 16)
  const fresh = pickFreshThemes(ctx.slotAt, 4, [...autoTexts, ...humanTexts.slice(0, HUMAN_FOR_WORDS)])

  // 取り消した文の分析: どういう言葉・話題が、取り消されてばかりで、残っていないか（本人が何度も「要らない」と判断したもの）。
  // 取り消し3本以上で割合が高い言葉は「使わない」（案に入っていたら書き直させる）。一覧と話題は、AIにも伝える。
  const rejectedAnalysis = analyzeRejected(ctx.rejected, autoTexts)
  const rejectedBlocked = blockedWords(rejectedAnalysis)

  // 毎回同じ骨組みにならないよう、枠ごとに「型」と「長さ」を決めて指定し、最近の投稿で何度も使っている書き出し・締めは避けさせる。
  // 守られなかった案（長さが範囲の外・最近と同じ書き出し）は、理由を伝えて書き直させる。
  const variety = pickVariety(ctx.slotAt)
  const recentForShape = autoTexts.slice(0, 12)
  const avoidOpenings = repeatedOpenings(recentForShape)
  const avoidEndings = repeatedEndings(recentForShape)
  const recentOpenings = recentForShape.map(openingOf)

  let feedback: string | undefined
  let last: Generated = { problems: ['本文が空'] }
  for (let attempt = 0; attempt <= MAX_REWRITES; attempt++) {
    // 書き直しは、時間に余裕があるときだけ。無ければ、いまある案と理由をそのまま返す。
    if (attempt > 0 && deps.canStartAi && !deps.canStartAi()) break
    const rawText = await deps.writePost({
      apiKey,
      quality: row.settings.quality,
      profile: ctx.profile,
      samples: pickSamples(ctx.history, SAMPLES_PER_POST, ctx.seed + attempt),
      recent: recentForPrompt,
      rejected: ctx.rejected.slice(0, REJECTED_FOR_PROMPT),
      rejectedWords: rejectedWordLines(rejectedAnalysis),
      rejectedTopics: describeRejectedTopics(rejectedAnalysis),
      recentStyle,
      crowded: crowdedList.map(describeCrowded),
      neglected,
      overused,
      fresh,
      form: variety.form,
      length: variety.length,
      avoidOpenings,
      avoidEndings,
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
    // AIが入れた改行は取り除く（本人の指示。ひとつながりの文章にする）
    const text = rawText ? flattenLines(rawText) : rawText
    const problems = text ? checkPost(text, against) : ['本文が空']
    // 使いすぎの言葉が入っていたら、使えない案として、理由を伝えて書き直させる。
    if (text) {
      const hit = overusedIn(text, overused)
      if (hit.length > 0) problems.push(`使いすぎの言葉（${hit.join('・')}）を含んでいる`)
      const lengthIssue = lengthProblem(text, variety.length)
      if (lengthIssue) problems.push(lengthIssue)
      // 最近の投稿の2本以上と、同じ書き出し（最初の3文字）なら、使えない案にする。
      const open = openingOf(text)
      if (open.length >= 3 && recentOpenings.filter((o) => o === open).length >= 2) problems.push(`書き出し「${open}」が、最近の投稿と同じ`)
      // 「A、B、C。」の3つ並べが最近の投稿にもあれば、続けさせない（同じ骨組みで単調になるため）。
      if (isTripleBeat(text) && recentForShape.some(isTripleBeat)) problems.push('短い言葉を3つ並べるだけの型が、最近の投稿と同じ')
      const refused = overusedIn(text, rejectedBlocked)
      if (refused.length > 0) problems.push(`本人が何度も取り消している言葉（${refused.join('・')}）を含んでいる`)
    }
    last = { text, problems }
    if (problems.length === 0) return last
    feedback = problems.join('、')
  }
  return last
}

/** 整えてもらう文章・指示の長さの上限（AIへの入力が大きくなりすぎないように）。 */
const REVISE_MAX_TEXT = 600
const REVISE_MAX_INSTRUCTION = 200

/**
 * 予約してある1本を、AIが読んで本人の文体に整える。保存はしない（直した案を返すだけ。保存するかは本人が決める）。
 * 検査（長さ・URL・天気・未成年）に落ちた案も、理由つきで返す（見て判断してもらう）。
 */
export async function revisePost(
  deps: EngineDeps,
  userId: string,
  input: { text: string; instruction?: string }
): Promise<Generated & { usage: AutopilotUsage }> {
  const text = input.text.trim()
  if (!text) throw new EngineError('直したい文章が空です')
  if (text.length > REVISE_MAX_TEXT) throw new EngineError('文章が長すぎます')
  const instruction = (input.instruction ?? '').trim().slice(0, REVISE_MAX_INSTRUCTION)
  const row = await deps.store.get(userId)
  if (!row.profile) throw new EngineError('先に、過去の投稿から文体をまとめてください')
  const apiKey = deps.apiKey()
  if (!apiKey) throw new EngineError('ANTHROPIC_API_KEY が設定されていません', 500)
  const now = deps.now()
  const usage = usageFor(row, now)
  if (overBudget(usage, row.settings, onePostYen(row.settings.quality))) throw new EngineError(budgetMessage(row.settings))

  const history = await humanHistory(deps, row)
  const revisedRaw = await deps.revisePost({
    apiKey,
    quality: row.settings.quality,
    profile: row.profile,
    samples: pickSamples(history, 8, now.getTime() >>> 10),
    text,
    instruction: instruction || undefined,
    timeoutMs: deps.aiTimeoutMs,
    onUsage: (u) => {
      usage.yen += aiCostYen(row.settings.quality, u.inputTokens, u.outputTokens)
      usage.generations += 1
    },
  })
  await deps.store.save(userId, { usage })
  const revised = revisedRaw ? flattenLines(revisedRaw) : undefined
  // 似すぎの検査は、元の文と似ているのが当たり前なので、ここでは使わない（長さ・URL・天気・未成年だけ見る）。
  const problems = revised ? checkPost(revised, []) : ['AIが直した案を作れませんでした']
  return { text: revised, problems, usage }
}

/** 保存せずに、いまの設定で1本書いてみる。検査に落ちた場合も、最後の案と理由を返す（見て判断してもらう）。 */
export async function previewPost(deps: EngineDeps, userId: string): Promise<Generated & { usage: AutopilotUsage }> {
  let row = await deps.store.get(userId)
  if (!row.profile) throw new EngineError('先に、過去の投稿から文体をまとめてください')
  const profile = row.profile // row を最新の履歴で入れ替えても、まとめは変わらない
  const now = deps.now()
  if (overBudget(usageFor(row, now), row.settings, onePostYen(row.settings.quality))) throw new EngineError(budgetMessage(row.settings))

  // 試し書きも、本番と同じ材料で書く（最新の投稿を読み直し、自動運転が出した分は学習から外す）。
  row = await withFreshHistory(deps, row)
  const history = await humanHistory(deps, row)
  const usage = usageFor(row, now)
  const recent = await deps.store.recentTexts(userId, RECENT_AUTOPILOT_FOR_WORDS)
  const rejected = await deps.store.rejectedTexts(userId, REJECTED_FOR_ANALYSIS)
  const slotAt = new Date(now.getTime() + 3600_000).toISOString()
  const result = await generateOne({
    deps,
    row,
    profile,
    usage,
    slotAt,
    seed: now.getTime() >>> 10,
    recent,
    rejected,
    history,
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
  const profile = row.profile // row を最新の履歴で入れ替えても、まとめは変わらない

  const now = deps.now()
  const { settings } = row
  // 確認してから投稿する設定では、確認待ちが残っているあいだは新しく作らない（投稿可能にする・取り消すと、次の1件を作る）。
  // 先に何日ぶんも作り置くと、読まれないまま取り消される文にAI費用がかかるため。
  if (settings.requireApproval) {
    const room = (deps.maxPendingDrafts ?? MAX_PENDING_DRAFTS) - (await deps.store.draftCount(row.userId))
    if (room <= 0) return result
    options = { ...options, maxGenerations: Math.min(options.maxGenerations, room) }
  }
  const sinceDate = localDate(now.getTime() - 86_400_000, settings.timeZone)
  // 本人が「取り消す」で外した枠は、記録に残っていても「空いた枠」として、あらためて別の文で作り直す。
  // 以前は「取り消した枠は作り直さない」だったが、今日・明日の枠を取り消すと、その日の投稿が無くなり、
  // 自動運転を止めて始め直すまで戻らなかった（本人の指摘）。作り直すときは、取り消した文を AI に「出さない」として渡す。
  // 手で削除した枠（行ごと消えて印が無い）と、「止める」での一括の取り消し（印なし）は、いままでどおり作り直さない。
  // ただし、確認してから投稿する設定（requireApproval）のときは、近い枠（いまから2時間以内・過ぎた枠）は作り直さない。
  // 本人が選んで外したものなので、消したのにまた同じ時間帯に新しい文が出てくる、を作らない。
  // 遠い枠（たとえば明日）は作り直す（作り直さないと、候補が減る一方で、AIの文章が止まったように見える）。
  // 確認してから投稿する設定では、確認の途中で取り消す・投稿可能にするたびに候補が減っていくので、設定の「何日先まで」より
  // 多め（最低4日先まで）に、確認待ちを作り置く（候補が1つしか無い、を避ける）。確認なしの設定は、設定のとおり。
  const planned = planSlots(
    now,
    settings.requireApproval ? { ...settings, horizonDays: Math.max(settings.horizonDays, APPROVAL_HORIZON_DAYS) } : settings
  )
  const rejectedAll = await deps.store.rejectedSlotKeys(row.userId, sinceDate)
  const refillable = (key: string) => {
    if (!settings.requireApproval) return true
    const slot = planned.find((s) => s.key === key)
    return !!slot && Date.parse(slot.at) >= now.getTime() + REFILL_MIN_LEAD_MS
  }
  const rejectedSlots = rejectedAll.filter(refillable)
  let missing: Slot[] = planned.filter((s) => !row.slots.includes(s.key) || rejectedSlots.includes(s.key))
  // 確認してから投稿する設定では、もう朝（6時以降）なら、今日の午前中の枠は新しく作らない（本人の指示）。
  // 前の日までに作ってあった午前の予約は、そのまま残る。
  if (settings.requireApproval) missing = missing.filter((s) => !isLateMorningSlot(s.at, now.getTime(), settings.timeZone))
  if (missing.length === 0) return result

  // 記録に無くても、予約として生きている枠は作り直さない。記録だけが空になる場面（設定を変えて作り直したとき）に、
  // 今日すでに投稿した枠をAIに書かせてから重複と分かると、費用だけがかかる。足りない枠があるときだけ調べる。
  // 取り消した枠も、作り直した予約が生きているなら、もう空きではない（作り直しを繰り返さない）。
  const alive = await deps.store.activeSlotKeys(row.userId, sinceDate)
  const slots = [...row.slots, ...alive.filter((key) => !row.slots.includes(key))]
  missing = missing.filter((s) => !alive.includes(s.key) && (rejectedSlots.includes(s.key) || !slots.includes(s.key)))
  // いちばん近い時刻の枠から作る（取り消したのは、たいてい近い枠。遠い先の枠より先に埋める）。
  missing.sort((a, b) => a.at.localeCompare(b.at))
  if (missing.length === 0) {
    // 生きている枠を記録に足しておく（毎分、同じ調べ直しをしないため）。
    if (slots.length > row.slots.length) await deps.store.save(row.userId, { slots: pruneSlots(slots, settings.timeZone, now) })
    return result
  }

  // 文を作る前に、本人の最新の投稿を読み直し（毎回。2時間以内に読んでいれば読み直さない）、
  // 自動運転が出した分を外した「本人が自分で書いた投稿」だけを、お手本・傾向・話題の数え方に使う。
  row = await withFreshHistory(deps, row)
  const history = await humanHistory(deps, row)
  const usage = usageFor(row, now)
  const recent = await deps.store.recentTexts(row.userId, RECENT_AUTOPILOT_FOR_WORDS)
  const rejected = await deps.store.rejectedTexts(row.userId, REJECTED_FOR_ANALYSIS)
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
        profile,
        usage,
        slotAt: slot.at,
        seed: parseInt(slot.key.replace(/\D/g, '').slice(0, 9), 10) || 1,
        recent: [...createdToday, ...recent],
        rejected,
        history,
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
      // AIが書いているあいだに、ほかの実行（毎分の補充・画面からの作り直し）が先に確認待ちを作っていることがある。
      // 上で数えたのは書く前なので、入れる直前にもう一度数える（数えないと、確認待ちが2件になる）。
      // 先に作られていたら、いま書いた文は捨てる（費用は戻らないが、確認待ちを増やさない）。
      if (settings.requireApproval && (await deps.store.draftCount(row.userId)) >= (deps.maxPendingDrafts ?? MAX_PENDING_DRAFTS)) {
        break
      }
      const outcome = await deps.store.insertPost({
        userId: row.userId,
        at: slot.at,
        text: generated.text,
        slotKey: slot.key,
        status: row.settings.requireApproval ? 'draft' : 'scheduled',
      })
      if (outcome === 'inserted' && settings.requireApproval) {
        // 数えてから入れるまでのあいだに、ほかの実行が同時に確認待ちを作ると、2件になる。入れた直後に、
        // 古い順に上限まで残して、あとから作った分を取り消す（同時に動いても、どちらの実行も同じ1件を残す）。
        await deps.store.trimDrafts(row.userId, deps.maxPendingDrafts ?? MAX_PENDING_DRAFTS)
      }
      if (outcome === 'inserted') {
        usage.yen += PRICE.xPostUsd * USD_JPY
        usage.posts += 1
        result.created += 1
        createdToday.push({ text: generated.text, at: slot.at })
      }
      if (!slots.includes(slot.key)) slots.push(slot.key) // 作り直した枠は、すでに記録にある
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

/**
 * 空いた枠（本人が「取り消す」で外した枠など）のうち、いちばん近い時刻の1つを、いますぐ別の文で作り直す。
 * 画面の「取り消す」のあとに呼ぶ。毎分の補充（topUpAll）も同じ空きを拾うが、最大で1分、AI の持ち時間が他の仕事で
 * 使われていればもっと待つ。取り消したのに空いたまま何分も待たされないよう、画面から直接頼めるようにしてある。
 * 自動運転が OFF・文体のまとめが無いときは、何もしない（費用が出ない）。月の上限に近いときは、理由を伝えて止まる。
 */
export async function refill(deps: EngineDeps, userId: string): Promise<TopUpResult> {
  const row = await deps.store.get(userId)
  return topUp(deps, row, { maxGenerations: 1 })
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

  // 「前の投稿を X から消す」は、オンにした時刻をここで記録する（画面からは送らせない）。
  // オンにする前に溜まっていた投稿を消さないための線引きで、オンのまま他の設定を保存しても動かさない。
  const wasOn = row.settings.deletePrevious === true
  const merged: Partial<AutopilotSettings> = { ...row.settings, ...input }
  merged.deletePreviousFrom =
    merged.deletePrevious === true ? (wasOn ? row.settings.deletePreviousFrom : deps.now().toISOString()) : null
  const settings = normalizeSettings(merged)
  // 「確認してから投稿する」をオフにしたら、確認待ちだった予約は、確認したものとして投稿可能にする
  // （オフにしたのに、確認待ちが残って投稿されない、を作らない）。
  if (row.settings.requireApproval && !settings.requireApproval) await deps.store.approveUpcoming(userId)
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

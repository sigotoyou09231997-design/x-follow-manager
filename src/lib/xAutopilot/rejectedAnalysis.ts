import { crowdedTopics, type TopicCount } from './recentStyle.js'
import { wordsOf } from './words.js'

// 本人が「取り消す」で外した自動運転の文を集めて、どういう言葉・話題が取り消されやすいかを数える（AIは呼ばない）。
// 取り消した文は、scheduled_posts に「取り消した」印つきで残してある（削除しない）。ここは、その全部を材料にする。
// 取り消されなかった（残した・投稿した）文と見比べて、「取り消されてばかりで、残っていない言葉」を見つける。

export interface RejectedWord {
  word: string
  /** その言葉が入った、取り消した文の数。 */
  rejected: number
  /** その言葉が入った、取り消されなかった文の数。 */
  kept: number
}

export interface RejectedAnalysis {
  /** 取り消した文の数。 */
  total: number
  /** よく取り消される言葉（多い順）。 */
  words: RejectedWord[]
  /** よく取り消される話題の括り。 */
  topics: TopicCount[]
}

/** 取り消した文のうち、この本数以上に出ている言葉だけを数える（1度きりの偶然は数えない）。 */
const MIN_REJECTED_DOCS = 2
/** 取り消した文に出る割合（取り消した本数 ÷ 取り消した本数＋残った本数）が、これ以上の言葉。 */
const MIN_REJECT_RATIO = 0.6
/** 「使わない」と決めるほどの言葉: 取り消した本数がこれ以上で、割合も高い。 */
export const BLOCK_MIN_DOCS = 3
export const BLOCK_MIN_RATIO = 0.7

export function analyzeRejected(rejected: string[], kept: string[], limit = 20): RejectedAnalysis {
  const rejDocs = new Map<string, number>()
  for (const text of rejected) for (const word of wordsOf(text)) rejDocs.set(word, (rejDocs.get(word) ?? 0) + 1)
  const keptDocs = new Map<string, number>()
  for (const text of kept) for (const word of wordsOf(text)) keptDocs.set(word, (keptDocs.get(word) ?? 0) + 1)

  const words: RejectedWord[] = [...rejDocs.entries()]
    .map(([word, count]) => ({ word, rejected: count, kept: keptDocs.get(word) ?? 0 }))
    .filter((w) => w.rejected >= MIN_REJECTED_DOCS && w.rejected / (w.rejected + w.kept) >= MIN_REJECT_RATIO)
    .sort((a, b) => b.rejected - a.rejected || a.kept - b.kept || a.word.localeCompare(b.word))
    .slice(0, limit)

  const topics = rejected.length === 0 ? [] : crowdedTopics(rejected, { minCount: 3, minShare: 0.15 })
  return { total: rejected.length, words, topics }
}

/** 「使わない」と決める言葉（取り消された回数が多く、残った文にはほとんど出ない）。 */
export function blockedWords(analysis: RejectedAnalysis): string[] {
  return analysis.words
    .filter((w) => w.rejected >= BLOCK_MIN_DOCS && w.rejected / (w.rejected + w.kept) >= BLOCK_MIN_RATIO)
    .map((w) => w.word)
}

/** AI に渡す、1行ずつの説明。 */
export function describeRejectedWords(analysis: RejectedAnalysis): string[] {
  return analysis.words.slice(0, 14).map((w) => `${w.word}（取り消し${w.rejected}回${w.kept > 0 ? `、残した文には${w.kept}回` : ''}）`)
}

/**
 * AI に渡す「取り消された言葉」の一覧。上位14個の説明に加えて、「使わない」と決めた言葉（blockedWords）は、
 * 14個に入っていなくても必ず入れる。入れないと、AI は禁止の言葉を知らないまま書き、案が毎回検査で落ちて、
 * 書き直しと毎回のやり直しでAI費用だけがかかり続ける。
 */
export function rejectedWordLines(analysis: RejectedAnalysis): string[] {
  const lines = describeRejectedWords(analysis)
  const top = new Set(analysis.words.slice(0, 14).map((w) => w.word))
  const extra = blockedWords(analysis)
    .filter((w) => !top.has(w))
    .map((w) => `${w}（取り消しが多いので使用禁止）`)
  return [...lines, ...extra]
}

export function describeRejectedTopics(analysis: RejectedAnalysis): string[] {
  return analysis.topics.map((t) => `${t.name}（取り消した${t.total}件のうち${t.count}件）`)
}

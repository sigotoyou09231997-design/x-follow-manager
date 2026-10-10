// 自動運転でかかるお金の見積もり。画面に出す「月の目安」と、月の上限の判定の両方がここを使う。
// 単価は2026年10月時点の公開料金。変わったらここだけ直す。
//   AI    : 入力・出力（100万トークンあたり）。thinking も出力として数える
//   X API : 投稿1件 $0.015（URL入りは $0.200 なので、自動運転ではURLを入れない）
//           自分の投稿の読み取り 1件 $0.001

import type { Quality } from './types'

export const USD_JPY = 150

/** 文章の質（＝使うAI）ごとの料金。 */
export const QUALITY_MODELS: Record<
  Quality,
  { id: string; label: string; inputPerMillionUsd: number; outputPerMillionUsd: number }
> = {
  standard: { id: 'claude-opus-5-5', label: '標準（Opus 5.5）', inputPerMillionUsd: 4, outputPerMillionUsd: 20 },
  saver: { id: 'claude-sonnet-5-5', label: '節約（Sonnet 5.5）', inputPerMillionUsd: 2, outputPerMillionUsd: 10 },
}

export const PRICE = {
  xPostUsd: 0.015,
  xOwnedReadUsd: 0.001,
} as const

/** 1回あたりのトークン数の目安（日本語の投稿文を書かせる用途。実測は usage で見直す）。 */
export const TYPICAL_TOKENS = {
  /** 1本書く: 文体まとめ＋お手本＋直近の投稿を渡す。 */
  postInput: 4000,
  /** 1本書く: 考える分を含めた出力。 */
  postOutput: 1200,
  /** 文体のまとめ: 履歴200件ぶん。 */
  profileInput: 15_000,
  profileOutput: 5000,
} as const

/** AIの呼び出し1回の費用（円）。 */
export function aiCostYen(quality: Quality, inputTokens: number, outputTokens: number): number {
  const m = QUALITY_MODELS[quality]
  const usd = (inputTokens * m.inputPerMillionUsd + outputTokens * m.outputPerMillionUsd) / 1_000_000
  return usd * USD_JPY
}

/** 投稿1本ぶん（AIが書く＋Xへ投稿）の費用（円）。 */
export function onePostYen(quality: Quality): number {
  return aiCostYen(quality, TYPICAL_TOKENS.postInput, TYPICAL_TOKENS.postOutput) + PRICE.xPostUsd * USD_JPY
}

/** 履歴の読み込み＋文体のまとめ（最初の1回）の費用（円）。 */
export function setupYen(quality: Quality, historyCount = 200): number {
  const read = historyCount * PRICE.xOwnedReadUsd * USD_JPY
  const scale = historyCount / 200
  const profile = aiCostYen(quality, TYPICAL_TOKENS.profileInput * scale, TYPICAL_TOKENS.profileOutput)
  return read + profile
}

/** AIが長さ超過・内容の重なりで書き直す割合の見込み。 */
export const RETRY_RATE = 0.15

/** 月ごとの固定ぶん: 文体の更新1回＋「試し書き」10回＋新しい投稿の読み取り。 */
export function monthlyFixedYen(quality: Quality): number {
  const profile = aiCostYen(quality, TYPICAL_TOKENS.profileInput, TYPICAL_TOKENS.profileOutput)
  const trials = 10 * aiCostYen(quality, TYPICAL_TOKENS.postInput, TYPICAL_TOKENS.postOutput)
  const reads = 30 * PRICE.xOwnedReadUsd * USD_JPY
  return profile + trials + reads
}

/** 1日 postsPerDay 本を30日続けたときの月の目安（円）。10円単位に丸める。 */
export function monthlyYen(quality: Quality, postsPerDay: number, days = 30): number {
  const aiPerPost = aiCostYen(quality, TYPICAL_TOKENS.postInput, TYPICAL_TOKENS.postOutput) * (1 + RETRY_RATE)
  const xPerPost = PRICE.xPostUsd * USD_JPY
  const total = postsPerDay * days * (aiPerPost + xPerPost) + monthlyFixedYen(quality)
  return Math.round(total / 10) * 10
}

/** 「1,100円」のような表示。 */
export const formatYen = (yen: number): string => `${Math.round(yen).toLocaleString('ja-JP')}円`

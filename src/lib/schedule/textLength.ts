// Xの文字数カウントは単純な文字数ではなく「重み付き」で行われる。
// twitter-text の設定 v3 に合わせた実装:
//   - 既定の重みは2（CJK・絵文字などはこちら）
//   - ラテン文字を含む下記のUnicode範囲だけ重み1
//   - URLは実際の長さに関わらず一律23としてカウントされる（t.co短縮のため）
// 上限は重み付き280。

const LIGHT_RANGES: [number, number][] = [
  [0x0000, 0x10ff],
  [0x2000, 0x200d],
  [0x2010, 0x201f],
  [0x2032, 0x2037],
]

export const MAX_WEIGHTED_LENGTH = 280
const URL_WEIGHT = 23

// t.co に短縮される対象を拾うための実用的なURL検出。
// 完全なtwitter-textの実装ではないが、http(s)始まりと `example.com/path` 形式を拾う。
const URL_PATTERN =
  /\b(?:https?:\/\/[^\s<>"']+|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|net|org|jp|io|co|dev|app|ai|me|tv|info|biz)(?:\/[^\s<>"']*)?)/gi

function codePointWeight(codePoint: number): number {
  for (const [start, end] of LIGHT_RANGES) {
    if (codePoint >= start && codePoint <= end) return 1
  }
  return 2
}

/**
 * Xの数え方に合わせた重み付き文字数を返す。
 * 「日本語は1文字2カウント、英数字は1カウント、URLは23カウント固定」。
 */
export function weightedLength(text: string): number {
  // URLを先に取り除き、その分を固定値で加算する。
  let total = 0
  let rest = ''
  let lastIndex = 0
  URL_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = URL_PATTERN.exec(text)) !== null) {
    rest += text.slice(lastIndex, match.index)
    total += URL_WEIGHT
    lastIndex = match.index + match[0].length
  }
  rest += text.slice(lastIndex)

  for (const char of rest) {
    total += codePointWeight(char.codePointAt(0) ?? 0)
  }
  return total
}

export function remainingLength(text: string): number {
  return MAX_WEIGHTED_LENGTH - weightedLength(text)
}

export function isOverLimit(text: string): boolean {
  return weightedLength(text) > MAX_WEIGHTED_LENGTH
}

/** 本文中にURLが含まれるか。X APIはURL入り投稿の課金が13倍になるため画面で警告する。 */
export function containsUrl(text: string): boolean {
  URL_PATTERN.lastIndex = 0
  return URL_PATTERN.test(text)
}

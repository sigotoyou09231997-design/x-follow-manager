// 自動運転の文が、毎回同じ骨組み（「◯◯、△△。□□。」の短い不満＋オチ）になるのを避けるための部品（AIは呼ばない）。
// 枠ごとに「型」と「長さ」を決めて指定し、最近の投稿で何度も使っている書き出し・締めは避けさせる。

export interface WritingForm {
  name: string
  /** AI への指示（どう書くか）。 */
  how: string
}

/** 文の型。事実や体験談を作らなくても書ける型だけ。 */
export const FORMS: WritingForm[] = [
  { name: '一言の言い切り', how: '余計な説明を足さず、ひとつのことを短く言い切る' },
  { name: '問いかけ', how: '読み手に聞く形で、疑問や問いかけで終える' },
  { name: '二つを比べて迷う', how: 'AとB、どちらを選ぶか迷っている形にする（「どっち派？」でもよい）' },
  { name: 'いまの実況', how: '目の前で起きていることを、現在形でそのまま実況するように書く' },
  { name: '自分へのツッコミ', how: '自分の癖や行動に、自分でツッコむ形にする' },
  { name: '願望', how: '「〜してほしい」「〜したい」と、願いを言う形にする' },
  { name: '呼びかけ・提案', how: '読み手に「〜してみない？」「〜しよう」と呼びかける形にする' },
  { name: '素朴な疑問', how: '「なんで〜なんやろ」と、ふと浮かんだ疑問を言う形にする' },
  { name: '前置き＋切り返し', how: '前置きのあとに、意外な切り返しを続ける（改行はせず、1つの文章でつなぐ）' },
  { name: '並べて一言', how: '「〜と〜と〜」と3つ並べて、最後に一言添える' },
  { name: '気づき', how: '「〜って、〜なんだな」と、気づいたことを言う形にする' },
  { name: '話しかけ', how: '誰かに話しかけるような口調で書く' },
  { name: '否定から入る', how: '「〜じゃなくて、〜」と、ひとつ否定してから言い直す' },
  { name: '決めつけ', how: '「〜はたぶん〜」と、軽く決めつけるように言う（根拠のある事実のふりはしない）' },
]

export interface LengthTarget {
  label: string
  /** AI への指示。 */
  hint: string
  /** 文字数（改行を除く）の許容範囲。範囲の外なら、書き直させる。 */
  min: number
  max: number
}

export const LENGTHS: LengthTarget[] = [
  { label: '短め', hint: '15〜30字ほどの短い一文', min: 10, max: 38 },
  { label: 'ふつう', hint: '30〜60字ほど', min: 24, max: 76 },
  { label: '長め', hint: '60〜110字ほど（改行はしない）', min: 50, max: 125 },
]

/**
 * 「ネギ買う、半分余る、結局冷凍する。」のように、短い言葉を読点で3つ並べて終わる型か。
 * 改行をやめさせたあと、この型ばかりが出て単調になったので、最近の投稿にもあれば続けさせない。
 */
export const isTripleBeat = (text: string): boolean => {
  const parts = text.trim().replace(/[。.!！?？]+$/, '').split('、')
  return parts.length === 3 && parts.every((p) => p.length >= 2 && p.length <= 14)
}

/** 小さな文字列から、決まった0以上1未満の数を作る（FNV-1a）。同じ枠なら同じ結果、枠が違えば違う結果。 */
function hash01(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) / 0x1_0000_0000
}

/** 枠（seed）ごとに、型と長さを決める。 */
export function pickVariety(seed: string): { form: WritingForm; length: LengthTarget } {
  const form = FORMS[Math.floor(hash01(`${seed}:form`) * FORMS.length)]
  // 長さは、短め・ふつうを多めに（本人の投稿は短いものが多い）。
  const r = hash01(`${seed}:length`)
  const length = r < 0.4 ? LENGTHS[0] : r < 0.85 ? LENGTHS[1] : LENGTHS[2]
  return { form, length }
}

const trimmed = (text: string) => text.replace(/^[\s「『（(【[]+/, '').replace(/\s+/g, '')

/** 書き出し（最初の3文字）。 */
export function openingOf(text: string): string {
  return [...trimmed(text)].slice(0, 3).join('')
}

/** 締め（最後の4文字。句点も含める）。 */
export function endingOf(text: string): string {
  return [...trimmed(text)].slice(-4).join('')
}

function repeated(values: string[], minCount: number, limit: number): string[] {
  const counts = new Map<string, number>()
  for (const v of values) if (v.length >= 3) counts.set(v, (counts.get(v) ?? 0) + 1)
  return [...counts.entries()]
    .filter(([, n]) => n >= minCount)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([v]) => v)
}

/** 最近の投稿で、2回以上使っている書き出し。 */
export function repeatedOpenings(recent: string[]): string[] {
  return repeated(recent.map(openingOf), 2, 5)
}

/** 最近の投稿で、3回以上使っている締め。 */
export function repeatedEndings(recent: string[]): string[] {
  return repeated(recent.map(endingOf), 3, 4)
}

/** 文字数（改行・空白を除く）が、指定の範囲に入っているか。 */
export function lengthProblem(text: string, target: LengthTarget): string | undefined {
  const n = [...text.replace(/\s+/g, '')].length
  if (n < target.min) return `短すぎる（指定: ${target.hint}）`
  if (n > target.max) return `長すぎる（指定: ${target.hint}）`
  return undefined
}

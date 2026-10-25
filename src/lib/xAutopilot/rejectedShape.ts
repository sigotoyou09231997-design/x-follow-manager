import { isTripleBeat } from './variety.js'

// 取り消した文の「形」の分析。言葉・話題（rejectedAnalysis.ts）だけでは、言葉が違えば同じ型が通ってしまう
// （「ネギ買う、半分余る、結局冷凍する。」と「卵焼き巻く、崩れる、…になる。」のように、骨組みが同じ）。
// 1つの文から「長さ・読点の数・文の数・問いかけ・体言止め・書き出し・締め・絵文字」などの特徴を取り出し、
// 取り消した文には多く、残した文には少ない形を見つける（AIは呼ばない）。

export interface ShapeFeature {
  label: string
  /** 禁止にしてよい形（型・書き出し・締め・絵文字）。長さ・読点の数・文の数は、数の範囲なので、AIに伝えるだけで禁止にはしない。 */
  hard: boolean
}

const EMOJI = /\p{Extended_Pictographic}/u
const clean = (text: string) => text.replace(/\s+/g, '')

function bucket(n: number, edges: number[], names: string[]): string {
  const i = edges.findIndex((e) => n <= e)
  return i === -1 ? names[names.length - 1] : names[i]
}

/** 1つの文の、形の特徴（重複なし）。 */
export function shapeFeatures(text: string): ShapeFeature[] {
  const t = text.trim()
  if (!t) return []
  const body = clean(t)
  const chars = [...body]
  const out: ShapeFeature[] = []
  const add = (label: string, hard = true) => out.push({ label, hard })

  add(`長さ: ${bucket(chars.length, [20, 40, 70], ['20字以下', '21〜40字', '41〜70字', '71字以上'])}`, false)
  const commas = (body.match(/、/g) ?? []).length
  add(`読点の数: ${commas >= 3 ? '3つ以上' : `${commas}つ`}`, false)
  const sentences = body.split(/[。！？!?]+/).filter(Boolean).length
  add(`文の数: ${sentences >= 3 ? '3文以上' : `${Math.max(sentences, 1)}文`}`, false)

  if (isTripleBeat(t)) add('型: 短い言葉を読点で3つ並べて終わる')
  if (/[？?]/.test(t)) add('型: 問いかけ（？を含む）')
  const last = t.replace(/[\s]+$/g, '')
  if (!/[。！？!?…）)」』w草]$/.test(last) && !EMOJI.test(chars[chars.length - 1] ?? '')) add('型: 句点なしで終わる（体言止め・言いさし）')
  if (/(けど|けれど|が|のに|し)[。]?$/.test(last)) add('型: 「〜けど」「〜のに」で言いさして終わる')
  const sentenceList = t.split(/[。！？!?]+/).map((s) => clean(s)).filter(Boolean)
  const finalSentence = sentenceList[sentenceList.length - 1] ?? ''
  if (sentenceList.length >= 2 && [...finalSentence].length <= 10) add('型: 最後に短い一言で落とす')
  if (/^[^、。]{1,12}って、/.test(body)) add('型: 「〜って、」で始める')
  if (/じゃなくて|ではなく/.test(body)) add('型: 否定してから言い直す')
  if (/たぶん|きっと|おそらく/.test(body)) add('型: 「たぶん」「きっと」で決めつける')
  if (/[「『][^」』]+[」』]/.test(body)) add('型: 「」でことばを引く')
  if (/[0-9０-９]/.test(body)) add('型: 数字を含む')
  if (/(w|ｗ|草)+[。]?$/.test(last)) add('型: 「w」「草」で終わる')
  if (EMOJI.test(t)) add('型: 絵文字を使う')
  if (chars.length >= 3) add(`書き出し「${chars.slice(0, 2).join('')}」`)
  const tail = last.replace(/[。！？!?…]+$/, '')
  const tailChars = [...clean(tail)]
  if (tailChars.length >= 3) add(`締め「〜${tailChars.slice(-2).join('')}」`)

  return out
}

export interface ShapeStat {
  label: string
  rejected: number
  kept: number
  hard: boolean
}

/** 形として取り上げる最低条件: 取り消した本数。 */
const MIN_SHAPE_DOCS = 3
/** 取り消した文に出る割合（取り消し ÷ 取り消し＋残し）。 */
const MIN_SHAPE_RATIO = 0.7
/** 全体の取り消し率（取り消し ÷ 全部）より、どれだけ取り消されやすいか。1.0 なら全体と同じ。 */
const MIN_SHAPE_LIFT = 1.3
/** 禁止にするのは、さらに強く偏った形だけ。 */
const HARD_MIN_DOCS = 4
const HARD_MIN_RATIO = 0.75
const HARD_MIN_LIFT = 1.5

/** 取り消した文に多く、残した文に少ない形（取り消した本数の多い順）。 */
export function analyzeShapes(rejected: string[], kept: string[], limit = 12): ShapeStat[] {
  if (rejected.length < MIN_SHAPE_DOCS) return []
  const count = (texts: string[]) => {
    const m = new Map<string, { n: number; hard: boolean }>()
    for (const text of texts)
      for (const f of shapeFeatures(text)) m.set(f.label, { n: (m.get(f.label)?.n ?? 0) + 1, hard: f.hard })
    return m
  }
  const rej = count(rejected)
  const keep = count(kept)
  const base = rejected.length / (rejected.length + kept.length)
  return [...rej.entries()]
    .map(([label, v]) => ({ label, rejected: v.n, kept: keep.get(label)?.n ?? 0, hard: v.hard }))
    .filter((s) => {
      const ratio = s.rejected / (s.rejected + s.kept)
      return s.rejected >= MIN_SHAPE_DOCS && ratio >= MIN_SHAPE_RATIO && ratio / base >= MIN_SHAPE_LIFT
    })
    .sort((a, b) => b.rejected - a.rejected || a.kept - b.kept || a.label.localeCompare(b.label))
    .slice(0, limit)
}

/** 書かせない形（強く偏った、型・書き出し・締めだけ）。 */
export function blockedShapes(stats: ShapeStat[], rejectedTotal: number, keptTotal: number): string[] {
  const base = rejectedTotal / Math.max(rejectedTotal + keptTotal, 1)
  return stats
    .filter((s) => {
      const ratio = s.rejected / (s.rejected + s.kept)
      return s.hard && s.rejected >= HARD_MIN_DOCS && ratio >= HARD_MIN_RATIO && ratio / base >= HARD_MIN_LIFT
    })
    .map((s) => s.label)
}

/** 文が、書かせない形のどれに当たるか（無ければ空）。 */
export function shapesIn(text: string, blocked: string[]): string[] {
  if (blocked.length === 0) return []
  const have = new Set(shapeFeatures(text).map((f) => f.label))
  return blocked.filter((label) => have.has(label))
}

/** AIに渡す、1行ずつの説明。 */
export function describeRejectedShapes(stats: ShapeStat[]): string[] {
  return stats.map((s) => `${s.label}（取り消し${s.rejected}回${s.kept > 0 ? `、残した文には${s.kept}回` : ''}）`)
}

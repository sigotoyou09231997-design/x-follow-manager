import { describe, expect, it } from 'vitest'
import { analyzeShapes, blockedShapes, describeRejectedShapes, shapeFeatures, shapesIn } from './rejectedShape'

const labels = (text: string) => shapeFeatures(text).map((f) => f.label)

describe('文の形の特徴', () => {
  it('短い言葉を読点で3つ並べる型を見つける', () => {
    expect(labels('ネギ買う、半分余る、結局冷凍する。')).toContain('型: 短い言葉を読点で3つ並べて終わる')
    expect(labels('今日はお昼にラーメンを食べた。')).not.toContain('型: 短い言葉を読点で3つ並べて終わる')
  })

  it('長さ・読点の数・文の数を、範囲で数える（改行・空白は数えない）', () => {
    const l = labels('朝だ。\n 眠い。')
    expect(l).toContain('長さ: 20字以下')
    expect(l).toContain('読点の数: 0つ')
    expect(l).toContain('文の数: 2文')
  })

  it('問いかけ・体言止め・言いさし・最後の一言・書き出し・締めを見つける', () => {
    expect(labels('なんで毎回こうなるんやろ？')).toContain('型: 問いかけ（？を含む）')
    expect(labels('今日も疲れた朝の電車')).toContain('型: 句点なしで終わる（体言止め・言いさし）')
    expect(labels('頑張ってるけど')).toContain('型: 「〜けど」「〜のに」で言いさして終わる')
    expect(labels('美容室で今日はどうしますと聞かれて困る。おまかせは怖い。')).toContain('型: 最後に短い一言で落とす')
    expect(labels('イヤホン、いつも絡まってる。')).toEqual(expect.arrayContaining(['書き出し「イヤ」', '締め「〜てる」']))
  })

  it('空の文は、特徴が無い', () => {
    expect(shapeFeatures('  ')).toEqual([])
  })
})

describe('取り消した文の形の分析', () => {
  const triple = ['ネギ買う、半分余る、結局冷凍する。', '卵焼き巻く、崩れる、スクランブルになる。', '傘買う、失くす、また買う。', '朝起きる、二度寝する、遅刻する。']
  const kept = ['今日はお昼にラーメンを食べて、少し眠くなった。', '最近、電車の中でぼんやりしていることが増えた気がする。', 'イヤホンがいつも絡まってるのはなんでなんやろ。', '日曜の夜って、一週間でいちばん短く感じる。', 'コンビニの新作スイーツを見ると、つい手に取ってしまう。']

  it('取り消した文に多く、残した文に出ない形を見つける（言葉が違っても同じ型）', () => {
    const stats = analyzeShapes(triple, kept)
    const hit = stats.find((s) => s.label === '型: 短い言葉を読点で3つ並べて終わる')
    expect(hit).toMatchObject({ rejected: 4, kept: 0 })
  })

  it('強く偏った型は、書かせない形になり、その形の文を見つけられる', () => {
    const stats = analyzeShapes(triple, kept)
    const blocked = blockedShapes(stats, triple.length, kept.length)
    expect(blocked).toContain('型: 短い言葉を読点で3つ並べて終わる')
    expect(shapesIn('歯磨く、忘れる、また磨く。', blocked)).toContain('型: 短い言葉を読点で3つ並べて終わる')
    expect(shapesIn('今日はお昼にラーメンを食べた。', blocked)).toEqual([])
  })

  it('長さ・読点の数は、AIに伝えるだけで、禁止にはしない', () => {
    const blocked = blockedShapes(analyzeShapes(triple, kept), triple.length, kept.length)
    expect(blocked.some((l) => l.startsWith('長さ:') || l.startsWith('読点の数:') || l.startsWith('文の数:'))).toBe(false)
  })

  it('取り消しが3本に満たなければ、分析しない。AIに渡す説明は回数つき', () => {
    expect(analyzeShapes(triple.slice(0, 2), kept)).toEqual([])
    const lines = describeRejectedShapes(analyzeShapes(triple, kept))
    expect(lines.join('\n')).toMatch(/短い言葉を読点で3つ並べて終わる（取り消し4回）/)
  })
})

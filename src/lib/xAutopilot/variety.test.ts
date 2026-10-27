import { describe, expect, it } from 'vitest'
import { endingOf, FORMS, isTripleBeat, lengthProblem, LENGTHS, openingOf, pickVariety, repeatedEndings, repeatedOpenings } from './variety'

describe('型と長さ', () => {
  it('枠が同じなら同じ、違えば、いろいろな型・長さが出る', () => {
    expect(pickVariety('2026-10-15#0')).toEqual(pickVariety('2026-10-15#0'))
    const seeds = Array.from({ length: 60 }, (_, i) => `2026-10-${10 + (i % 20)}#${i}`)
    const forms = new Set(seeds.map((s) => pickVariety(s).form.name))
    const lengths = new Set(seeds.map((s) => pickVariety(s).length.label))
    expect(forms.size).toBeGreaterThanOrEqual(8)
    expect(lengths.size).toBe(LENGTHS.length)
    expect(FORMS.length).toBeGreaterThanOrEqual(12)
  })
})

describe('書き出し・締めの繰り返し', () => {
  const recent = [
    '最近、朝の空気がちょっと冷たくなってきた。上着どうするか迷う季節。',
    '最近、スマホの充電が減るの早い気がする。',
    '自販機の飲み物、いつの間にか220円が普通になってる。高過ぎやろ。',
    '映画館のポップコーン、量の割に値段おかしい。でも買ってまう。',
    '雨の日の信号待ち、傘の水滴がズボンに全部くる。',
  ]

  it('書き出し（最初の3文字）と締め（最後の4文字）を取り出す。かっこ・空白は飛ばす', () => {
    expect(openingOf('「最近、朝の空気')).toBe('最近、')
    expect(endingOf('高過ぎやろ。\n')).toBe('過ぎやろ。'.slice(-4))
  })

  it('最近の投稿で2回以上使っている書き出しを出す', () => {
    expect(repeatedOpenings(recent)).toEqual(['最近、'])
  })

  it('3回以上使っている締めだけを出す', () => {
    const endings = ['ってる。', 'ってる。', 'ってる。', 'ている。'].map((e, i) => `文${i}は${e}`)
    expect(repeatedEndings(endings)).toEqual(['ってる。'])
    expect(repeatedEndings(recent)).toEqual([])
  })
})

describe('長さの検査', () => {
  it('範囲に入っていれば問題なし。外れていれば、短い／長いと理由を返す（改行・空白は数えない）', () => {
    const short = LENGTHS[0]
    expect(lengthProblem('電車が遅れて、少し焦った朝だった。', short)).toBeUndefined()
    expect(lengthProblem('あ', short)).toMatch(/^短すぎる/)
    expect(lengthProblem('あ'.repeat(60), short)).toMatch(/^長すぎる/)
    expect(lengthProblem('あ\nい\nう\nえ\nお\nか\nき\nく\nけ\nこ', short)).toBeUndefined() // 10字
  })
})

describe('短い言葉を3つ並べるだけの型', () => {
  it('「A、B、C。」の3つ並べを見つける', () => {
    expect(isTripleBeat('ネギ買う、半分余る、結局冷凍する。')).toBe(true)
    expect(isTripleBeat('卵焼き巻く、崩れる、スクランブルエッグになる。')).toBe(true)
  })

  it('2つ・4つの並びや、長い文は、3つ並べとは見ない', () => {
    expect(isTripleBeat('今日は眠い、でも頑張る。')).toBe(false)
    expect(isTripleBeat('朝、起きる、歩く、食べる。')).toBe(false)
    expect(isTripleBeat('美容室の「今日はどうします？」いつも答えに困る、おまかせって言うのも怖い、結局いつも同じ。')).toBe(false)
  })
})

describe('文の長さの目安（2026-10-27 に短くした）', () => {
  it('長めでも85字までで、長めは枠のうち1割ほどだけ', () => {
    expect(Math.max(...LENGTHS.map((l) => l.max))).toBeLessThanOrEqual(85)
    const seeds = Array.from({ length: 400 }, (_, i) => `2026-10-${i}#0`)
    const longShare = seeds.filter((s) => pickVariety(s).length.label === '長め').length / seeds.length
    expect(longShare).toBeLessThan(0.15)
    const shortShare = seeds.filter((s) => pickVariety(s).length.label === '短め').length / seeds.length
    expect(shortShare).toBeGreaterThan(0.4)
  })

  it('70字の文は、長めの範囲には入るが、ふつうの範囲（55字まで）は超える', () => {
    const text = 'あ'.repeat(70)
    expect(lengthProblem(text, LENGTHS[2])).toBeUndefined()
    expect(lengthProblem(text, LENGTHS[1])).toContain('長すぎる')
  })
})

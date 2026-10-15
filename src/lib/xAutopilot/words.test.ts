import { describe, expect, it } from 'vitest'
import { uncertainIn } from './text'
import { frequentWords, FRESH_THEMES, overusedIn, pickFreshThemes, wordsOf } from './words'

describe('言葉の取り出し', () => {
  it('漢字・かな混じりの言葉（焼き芋）とカタカナ（ハイボール）を取り出し、「今日」などは除く', () => {
    const words = wordsOf('今日は焼き芋とハイボールで最近の疲れを取る。電車は混んでた。')
    expect(words).toEqual(expect.arrayContaining(['焼き芋', 'ハイボール', '電車']))
    expect(words).not.toContain('今日')
    expect(words).not.toContain('最近')
  })
})

describe('使いすぎの言葉', () => {
  const texts = [
    '帰り道に焼き芋の匂いがして、つい目で追ってしまう。',
    '焼き芋の季節になった。ハイボールと合わせたい。',
    'ハイボールの缶、冷蔵庫に常備してる。',
    '電車の中で寝落ちした。',
    '焼き芋、焼き芋、焼き芋と同じ文の中で繰り返しても1本と数える。',
  ]

  it('複数の投稿にまたがって出る言葉を、多い順に出す（1本の中の繰り返しは1本と数える）', () => {
    // 焼き芋は3本（5本目は、1本の中で3回出ても1本）、ハイボールは2本
    expect(frequentWords(texts, 2, 10)).toEqual(['焼き芋', 'ハイボール'])
    expect(frequentWords(texts, 3, 10)).toEqual(['焼き芋'])
    expect(frequentWords(texts, 4, 10)).toEqual([])
  })

  it('本文に使いすぎの言葉が入っていれば、見つける', () => {
    expect(overusedIn('焼き芋を買って帰った。', ['焼き芋', 'ハイボール'])).toEqual(['焼き芋'])
    expect(overusedIn('今日は雨だった。', ['焼き芋'])).toEqual([])
  })
})

describe('まだ書いたことがない題材の候補', () => {
  it('天気・気温の題材は入れない（入れると、検査で落ちる文を毎回書かせることになる）', () => {
    expect(FRESH_THEMES.filter((t) => uncertainIn(t.theme).length > 0).map((t) => t.theme)).toEqual([])
    for (const gone of ['天気予報と実際の天気のずれ', '雨の日の信号待ち', '洗濯物が乾かない季節の悩み', '月や星の見え方']) {
      expect(FRESH_THEMES.map((t) => t.theme)).not.toContain(gone)
    }
  })

  it('過去の投稿にキーワードが出ている題材は外す', () => {
    const picks = pickFreshThemes('seed', FRESH_THEMES.length, ['傘を忘れた', 'エレベーターが遅い'])
    expect(picks).not.toContain('傘をなくしがちな話')
    expect(picks).not.toContain('エレベーターで一緒になった時の気まずさ')
    expect(picks.length).toBe(FRESH_THEMES.length - 2)
  })

  it('枠（seed）が同じなら同じ候補、違えば違う候補。指定した数だけ返す', () => {
    const a = pickFreshThemes('2026-10-15#0', 4, [])
    expect(a).toHaveLength(4)
    expect(pickFreshThemes('2026-10-15#0', 4, [])).toEqual(a)
    expect(pickFreshThemes('2026-10-15#1', 4, [])).not.toEqual(a)
  })

  it('候補が足りなければ、ある分だけ', () => {
    expect(pickFreshThemes('s', 5, FRESH_THEMES.flatMap((t) => t.keywords))).toEqual([])
  })
})

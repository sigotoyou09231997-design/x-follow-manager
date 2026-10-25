import { describe, expect, it } from 'vitest'
import { analyzeRejected, blockedWords, describeRejectedTopics, describeRejectedWords, rejectedWordLines } from './rejectedAnalysis'

const rejected = [
  '帰り道に焼き芋の匂いがして目で追った。',
  '焼き芋の季節になったと思う。',
  '駅前で焼き芋が売っていた。',
  '焼き芋を買って帰った。',
  'ハイボールの缶を冷蔵庫に常備してる。',
  'ハイボールが一番うまい。',
  '電車が遅れていた。',
  '仕事終わりのビールが楽しみ。',
]
const kept = ['雨の日の傘って安心する。', '電車の中で寝落ちした。', '図書館の静けさが好き。']

describe('取り消した文の分析', () => {
  const a = analyzeRejected(rejected, kept)

  it('取り消した文の数と、よく取り消される言葉（多い順）を出す', () => {
    expect(a.total).toBe(8)
    expect(a.words.map((w) => w.word)).toEqual(['焼き芋', 'ハイボール'])
    expect(a.words[0]).toEqual({ word: '焼き芋', rejected: 4, kept: 0 })
  })

  it('残した文にも出る言葉（電車）は、取り消されてばかりとは言えないので、入れない', () => {
    expect(a.words.map((w) => w.word)).not.toContain('電車')
    // 取り消し1・残し1 → 割合0.5 かつ 取り消し1本だけ
  })

  it('1度しか取り消していない言葉は数えない', () => {
    expect(analyzeRejected(['傘を忘れた。'], []).words).toEqual([])
  })

  it('話題の括り（お酒・晩酌）も数える', () => {
    expect(a.topics.map((t) => t.name)).toContain('お酒・晩酌')
    expect(describeRejectedTopics(a)[0]).toMatch(/^お酒・晩酌（取り消した8件のうち\d件）$/)
  })

  it('「使わない」と決める言葉は、取り消し3本以上で割合が高いものだけ', () => {
    expect(blockedWords(a)).toEqual(['焼き芋']) // ハイボールは2本だけ → 使わない言葉にはしないが、一覧には出す
  })

  it('使用禁止の言葉は、AIに渡す一覧の上位14個に入っていなくても、必ず渡す（知らずに書いて検査で落ち続けるのを防ぐ）', () => {
    // 取り消し5回の言葉が14個あり、その後ろに、取り消し3回で使用禁止になる言葉がある
    const words = [...Array.from({ length: 14 }, (_, i) => ({ word: `言葉${i}`, rejected: 5, kept: 0 })), { word: '片方', rejected: 3, kept: 0 }]
    const b = { total: 73, words, topics: [], shapes: [] }
    expect(blockedWords(b)).toContain('片方')
    expect(describeRejectedWords(b).join('\n')).not.toContain('片方') // 上位14個には入らない
    expect(rejectedWordLines(b).join('\n')).toContain('片方（取り消しが多いので使用禁止）')
  })

  it('AIに渡す説明は、回数つき。残した文に出ていれば、それも添える', () => {
    const b = analyzeRejected(['焼き芋の話。', '焼き芋の匂い。', '焼き芋を買った。'], ['焼き芋はうまい。'])
    expect(describeRejectedWords(b)).toEqual(['焼き芋（取り消し3回、残した文には1回）'])
  })

  it('取り消しが無ければ、空', () => {
    expect(analyzeRejected([], kept)).toEqual({ total: 0, words: [], topics: [], shapes: [] })
  })
})

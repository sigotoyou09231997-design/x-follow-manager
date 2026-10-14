import { describe, expect, it } from 'vitest'
import {
  countTopics,
  crowdedTopics,
  describeCrowded,
  describeRecentStyle,
  mergeCrowded,
  neglectedTopics,
} from './recentStyle'
import type { HistoryPost } from './types'

const posts = (texts: string[]): HistoryPost[] =>
  texts.map((text, i) => ({ id: String(i), text, at: new Date(Date.UTC(2026, 9, 14) - i * 3600_000).toISOString(), likes: 0, reposts: 0 }))

describe('describeRecentStyle: 直近の書き方の傾向を、履歴から毎回数える', () => {
  const sample = posts([
    '会社の人に、ハイボールのことをバカにされました。\nウイスキーを炭酸で割る意味がわからんと。',
    'これ日本の事じゃないの草',
    '人生で1番幸せを感じるときは、\n仕事終わりの1杯目のハイボールだと思う。',
    '無性に明日仕事行きたくない。',
    '今年も白菜漬けは諦めか。',
    '平日もこれくらい寝れたらな〜。',
    '納豆の混ぜ過ぎで、腕がつりそう。',
    'そういえば、UFOキャッチャーで取れました😊 #ゲーム',
    '本日のお昼。',
    'やべぇ、午前中は水を1滴も飲まずに仕事に集中してた。',
  ])

  it('長さ・行数・句点・絵文字・草などの割合を出す', () => {
    const text = describeRecentStyle(sample)!
    expect(text).toContain('直近10件')
    expect(text).toMatch(/長さ: 中央値\d+字/)
    expect(text).toMatch(/行数は中央値[12]行/)
    expect(text).toContain('句点「。」で終わる 80%') // 10件中8件が「。」で終わる
    expect(text).toContain('絵文字 10%')
    expect(text).toContain('ハッシュタグ 10%')
    expect(text).toContain('「w」「草」を含む 10%')
    expect(text).toContain('「笑」を含む 0%')
    expect(text).toContain('「おはよう」で始まる 0%')
    expect(text).toContain('自動運転が出した分は入れていない')
  })

  it('少なすぎる(8件未満)集計は出さない（偶然を特徴と取り違えないため）', () => {
    expect(describeRecentStyle(sample.slice(0, 7))).toBeUndefined()
    expect(describeRecentStyle([])).toBeUndefined()
  })

  it('新しい順の先頭 size 件だけを数える。URL は数えない', () => {
    const many = posts([...Array(8).fill('短い。'), ...Array(40).fill('おはようございます。とても長い文章を書いています。')])
    expect(describeRecentStyle(many, 8)).toContain('中央値3字')
    const withUrl = posts(Array(8).fill('本日のお昼。 https://t.co/abc123'))
    expect(describeRecentStyle(withUrl)).toContain('中央値6字')
  })
})

describe('話題の括りの数え方', () => {
  it('「ハイボール」も「ジンソーダ」も「晩酌」も、まとめて「お酒・晩酌」に数える', () => {
    const c = countTopics(['ハイボールが好き', 'ジンソーダの炭酸が強い', '晩酌の楽しみが増えた', '今日は天気がいい', '電車が混んでいた'])
    const drink = c.find((t) => t.name === 'お酒・晩酌')!
    expect(drink.count).toBe(3)
    expect(drink.total).toBe(5)
    expect(drink.words.map((w) => w.word)).toEqual(expect.arrayContaining(['ハイボール', 'ジンソーダ', '晩酌']))
    expect(c.find((t) => t.name === '電車・通勤')!.count).toBe(1)
  })

  it('1つの投稿が複数の括りに入る', () => {
    const c = countTopics(['会社の人とハイボールを飲んだ'])
    expect(c.find((t) => t.name === 'お酒・晩酌')!.count).toBe(1)
    expect(c.find((t) => t.name === '会社・仕事')!.count).toBe(1)
  })

  it('大文字小文字: AI は大文字だけ（ai が mail などに当たって、アプリ・IT と誤判定しない）', () => {
    expect(countTopics(['mail を確認した', 'wait して待つ']).find((t) => t.name === 'アプリ・IT')!.count).toBe(0)
    expect(countTopics(['AIに聞いてみた']).find((t) => t.name === 'アプリ・IT')!.count).toBe(1)
  })
})

describe('crowdedTopics: 最近多すぎる話題', () => {
  // 実例: 自動運転の文が、ハイボール・ジンソーダ・晩酌などお酒の話に偏った
  const biased = [
    '最近、ジンソーダの炭酸が強いほうが好きやと気づいた。',
    '会社の人に、ハイボールのことをバカにされました。',
    '仕事終わりの1杯目のハイボールが人生の幸せ。',
    '電車で席が空いてるのに立ってる人がいた。',
    '晩酌の楽しみが増えた。',
    '昼に食べたおにぎり、具が最後まで来なかった。',
    '週末は何もしないで寝ていたい。',
    '税金が高すぎる。',
  ]

  it('一定の件数と割合を超えた括りだけを、多い順に返す', () => {
    const crowded = crowdedTopics(biased, { minCount: 3, minShare: 0.25 })
    expect(crowded.map((t) => t.name)).toEqual(['お酒・晩酌'])
    expect(crowded[0].count).toBe(4)
    expect(describeCrowded(crowded[0])).toContain('お酒・晩酌（直近8件のうち4件')
    expect(describeCrowded(crowded[0])).toContain('ハイボール×2')
  })

  it('件数が足りなければ、割合が高くても挙げない（2件だけで「多すぎる」と言わない）', () => {
    expect(crowdedTopics(['ハイボール', 'ハイボール'], { minCount: 3, minShare: 0.25 })).toEqual([])
    expect(crowdedTopics([], { minCount: 3, minShare: 0.25 })).toEqual([])
  })

  it('割合が低ければ、件数が多くても挙げない（長い履歴の中の3件は普通）', () => {
    const texts = [...Array(3).fill('ハイボールを飲んだ'), ...Array(27).fill('今日は特に何もなかった')]
    expect(crowdedTopics(texts, { minCount: 3, minShare: 0.25 })).toEqual([])
  })

  it('別の集計で同じ括りが出たら、割合が高いほうだけ残す', () => {
    const a = crowdedTopics(biased, { minCount: 3, minShare: 0.25 })
    const b = crowdedTopics(Array(10).fill('ハイボールの話'), { minCount: 3, minShare: 0.25 })
    const merged = mergeCrowded([a, b])
    expect(merged).toHaveLength(1)
    expect(merged[0].count).toBe(10)
  })
})

describe('neglectedTopics: ふだん書くのに、最近出ていない話題', () => {
  const longHistory = [
    ...Array(30).fill('今日の仕事は忙しかった'), // 会社・仕事
    ...Array(10).fill('パズドラのダンジョンをクリアした'), // ゲーム
    ...Array(10).fill('ハイボールを飲んだ'), // お酒
    ...Array(2).fill('旅行に行ってきた'), // お出かけ（2件だけ。ふだん書くとは言えない）
  ]

  it('履歴にある程度あって、直近には1つも出ていない括りだけを返す', () => {
    const recent = ['ハイボールが好き', 'ジンソーダを飲んだ', '晩酌の楽しみ']
    const names = neglectedTopics(longHistory, recent)
    expect(names).toEqual(expect.arrayContaining(['会社・仕事', 'ゲーム']))
    expect(names).not.toContain('お酒・晩酌') // 最近出ている
    expect(names).not.toContain('お出かけ・旅行') // 履歴に根拠が弱い（無かった体験を作らせない）
  })

  it('履歴が少なければ（20件未満）、何も勧めない', () => {
    expect(neglectedTopics(Array(10).fill('今日の仕事'), [])).toEqual([])
  })
})

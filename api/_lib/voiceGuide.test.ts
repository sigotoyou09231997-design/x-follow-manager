// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildSystemPrompt } from '../generatePosts.js'
import { buildPostSystemPrompt } from './autopilotWriter.js'
import { buildDailySystemPrompt } from './dailyWriter.js'
import { WRITING_RULES } from './postWriter.js'
import { VOICE_GUIDE } from './voiceGuide.js'

// 本人の「いまの書き方」が、文章を作る3つの入口（AI下書き・繰り返しのAIおまかせ・自動運転）すべての指示に入っていること。
// 入口ごとに別々に書くと、片方だけ古いままになる（WRITING_RULES を共有している理由と同じ）。

describe('本人の「いまの書き方」', () => {
  it('3つの文章作成の指示すべてに入っている', () => {
    expect(buildSystemPrompt('single', 3)).toContain(VOICE_GUIDE)
    expect(buildSystemPrompt('thread', 5)).toContain(VOICE_GUIDE)
    expect(buildDailySystemPrompt()).toContain(VOICE_GUIDE)
    expect(buildPostSystemPrompt()).toContain(VOICE_GUIDE)
    expect(WRITING_RULES).toContain(VOICE_GUIDE)
  })

  it('いまの型（短い独り言・句点・一言で落とす）と、やめた型（🍋あいさつ・PUBG）が書いてある', () => {
    expect(VOICE_GUIDE).toContain('短い独り言')
    expect(VOICE_GUIDE).toContain('句点')
    expect(VOICE_GUIDE).toContain('短い一言で落とす')
    expect(VOICE_GUIDE).toContain('「おはようございます🍋」の型で始めない')
    expect(VOICE_GUIDE).toContain('PUBG')
  })

  // 実例: ガイドに言い回しの例（〜なんかな？・〜やん）を並べたら、自動運転の文が「〜なんかな？ 〜やん。そう思いながら〜」の
  // 同じ型ばかりになり、本人が取り消しても似た文が出続けた。例は挙げすぎず、毎回使わないこと・型を変えることを書く。
  it('言い回しや型を固定しない（例を並べすぎない・毎回は使わない・骨組みを続けない）', () => {
    expect(VOICE_GUIDE).not.toContain('なんかな')
    expect(VOICE_GUIDE).toContain('使うのは1本に1つまで')
    expect(VOICE_GUIDE).toContain('毎回は使わず')
    expect(VOICE_GUIDE).toContain('同じ骨組み')
    expect(VOICE_GUIDE).toContain('続けない')
    expect(VOICE_GUIDE).toContain('会社や仕事の不満が続かない')
  })

  it('依頼の指定が優先される・お手本と食い違うときはこの書き方に合わせる', () => {
    expect(VOICE_GUIDE).toContain('依頼に長さ・口調・スレッドなどの指定があれば、それを優先する')
    expect(VOICE_GUIDE).toContain('この書き方に合わせる')
  })

  // 既存の守りを、ガイドが緩めたり、逆のことを言ったりしていないこと
  it('作り話・URL・ハッシュタグ・年齢に関わる守りと食い違うことを言っていない', () => {
    expect(VOICE_GUIDE).not.toMatch(/ハッシュタグ(を|も)?(付け|入れ|使)/)
    expect(VOICE_GUIDE).not.toMatch(/https?:|URLを(付け|入れ|含め)/)
    expect(VOICE_GUIDE).not.toMatch(/体験(談)?を(作|創|足)|実績を|でっち上げ/)
    // 守りの本体は、いままでどおり WRITING_RULES と自動運転の指示に残っている
    expect(WRITING_RULES).toContain('ハッシュタグは、明示的に求められた場合のみ付ける')
    expect(WRITING_RULES).toContain('URLを含めない')
    expect(buildPostSystemPrompt()).toContain('事実を作らない')
    expect(buildPostSystemPrompt()).toContain('未成年・学生・年齢が曖昧な相手を連想させる表現')
  })

  it('本人の過去の投稿の文そのものは、ガイドに書かない（お手本の内容は流用しない、を破らないため）', () => {
    for (const line of ['つまりガリガリ', '死ぬんだろうか', '多分間違ってる', '料理系男子', '本日のお昼']) {
      expect(VOICE_GUIDE).not.toContain(line)
    }
  })
})

describe('天気・確かめられないことは書かない（本人の指示 2026-10-15）', () => {
  it('3つの文章作成の指示すべてに入っている（共通の WRITING_RULES から）', () => {
    for (const prompt of [buildSystemPrompt('single', 3), buildSystemPrompt('thread', 5), buildDailySystemPrompt(), buildPostSystemPrompt()]) {
      expect(prompt).toContain('天気・気温の話')
      expect(prompt).toContain('出る日の天気は分からず')
    }
  })

  it('【お手本】に天気の話があっても書かない・天気のほかの確かめられないことも書かない・依頼文に本人が書いた事実は使える', () => {
    expect(WRITING_RULES).toContain('【お手本】に天気の話があっても書かない')
    expect(WRITING_RULES).toContain('ニュース・世の中の出来事・店の混雑や営業')
    expect(WRITING_RULES).toContain('依頼文に本人が書いた事実だけは、そのまま使ってよい')
  })

  it('いまの書き方（VOICE_GUIDE）の話題の例に、天気を入れない', () => {
    expect(VOICE_GUIDE).not.toMatch(/天気|雨|暑い|寒い|気温/)
  })
})

describe('本人の「いまの書き方」: 話題の偏りと、毎回計算する数字', () => {
  it('お酒の話は10本に1本まで。続けて出さない（本人が最近書いても、自動で作る文は寄せない）', () => {
    expect(VOICE_GUIDE).toContain('お酒の話（ハイボール・ジンソーダ・晩酌など）は、10本に1本までにする')
    expect(VOICE_GUIDE).toContain('続けて出さない')
  })

  it('【最近の投稿の傾向】（毎回計算した数字）があるときは、この書き方の数字ではなく、そちらに合わせる', () => {
    expect(VOICE_GUIDE).toContain('【最近の投稿の傾向】（毎回、最新の履歴から計算した数字）があるときは')
    expect(VOICE_GUIDE).toContain('この書き方の数字は分析した時点のもの')
  })
})

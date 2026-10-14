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

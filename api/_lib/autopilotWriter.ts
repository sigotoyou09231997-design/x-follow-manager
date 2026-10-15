import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import { QUALITY_MODELS } from '../../src/lib/xAutopilot/cost.js'
import { recentWindow } from '../../src/lib/xAutopilot/text.js'
import type { HistoryPost, Quality, StyleProfile } from '../../src/lib/xAutopilot/types.js'
import { RefusedError, WRITING_RULES, writePosts } from './postWriter.js'
import type { LengthTarget, WritingForm } from '../../src/lib/xAutopilot/variety.js'

// X の自動運転で、AIに頼む2つの仕事。
//   1. 過去の投稿から「この人らしさ」（語調・話題の傾向）をまとめる      … writeProfile
//   2. その人らしさとお手本・最近の投稿から、次の1本を書く              … writeAutopilotPost
// 書いたものは、検査（長さ・URL・似すぎ・未成年の連想）を通ったあと、ご本人が見られる予約として並ぶ。

export interface Usage {
  inputTokens: number
  outputTokens: number
}

// ------------------------------------------------------------------ 1. 文体のまとめ

export const StyleProfileSchema = z.object({
  summary: z.string(),
  voice: z.object({
    person: z.string(),
    endings: z.array(z.string()),
    emoji: z.string(),
    layout: z.string(),
  }),
  themes: z.array(z.object({ name: z.string(), note: z.string() })),
  avoid: z.array(z.string()),
})

export const PROFILE_SYSTEM_PROMPT = `あなたは、X(旧Twitter)の過去の投稿を読んで、その人の書き方の特徴をまとめる編集者です。
まとめは、別のAIが「この人が書いたと感じられる新しい投稿」を書くための手引きになります。
本人の画面にもそのまま表示されるので、本人が読んで「そのとおり」と思える、具体的で短い日本語にしてください。

まとめ方:
- 渡された投稿にあることだけを書く。投稿に無い性格・経歴・職業・年齢・好みを推測で足さない
- summary: この人の投稿の印象を1〜2文で
- voice.person: 一人称・相手への呼びかけの癖（無ければ「特になし」）
- voice.endings: よく使う語尾・口癖を、実際の投稿から抜き出して3〜8個
- voice.emoji: 絵文字・記号・顔文字の使い方（使わないならそう書く）
- voice.layout: 1本の長さの目安（文字数）と、改行・段落の癖
- themes: よく書く話題を3〜8個。name は短い名前、note は「どんな切り口で書くか」を1文で
- avoid: 投稿から読み取れる「やらないこと」（書かない話題・使わない言い回し・使わない記号）を0〜6個。無ければ空
- 反応（♥）が多い投稿は、読み手に届いている書き方の手がかりとして重みをつける。ただし、少数の例だけで決めつけない
- 未成年・学生・年齢が曖昧な相手を連想させる内容が混ざっていても、themes にも summary にも書かない`

/**
 * 文体のまとめに渡す投稿を選ぶ。新しい順150件＋反応の多いもの50件（重複なし）。多すぎると費用が増える。
 * 反応の多い50件は、「いまの書き方」の範囲（いちばん新しい投稿から半年）の中から選ぶ。古い投稿は、反応が多くても入れない
 * （いまは使っていない書き方のまとめになり、AIがそれで書いてしまうため。理由は recentWindow）。
 */
export function selectForProfile(history: HistoryPost[]): HistoryPost[] {
  const newest = history.slice(0, 150)
  const used = new Set(newest.map((p) => p.id))
  const top = recentWindow(history, 150)
    .filter((p) => !used.has(p.id))
    .sort((a, b) => b.likes + b.reposts * 2 - (a.likes + a.reposts * 2))
    .slice(0, 50)
  return [...newest, ...top]
}

export function buildProfileUserMessage(history: HistoryPost[]): string {
  const posts = selectForProfile(history)
  const lines = posts.map((p, i) => {
    const day = p.at.slice(0, 10)
    const reaction = p.likes + p.reposts > 0 ? ` ♥${p.likes} RT${p.reposts}` : ''
    return `【${i + 1}】${day}${reaction}\n${p.text}`
  })
  return `この人の過去の投稿（${posts.length}件）:\n\n${lines.join('\n\n')}`
}

export interface WriteProfileInput {
  apiKey: string
  history: HistoryPost[]
  quality: Quality
  timeoutMs?: number
  onUsage?: (usage: Usage) => void
}

export async function writeProfile(input: WriteProfileInput): Promise<StyleProfile> {
  const client = new Anthropic({ apiKey: input.apiKey })
  const response = await client.messages.parse(
    {
      model: QUALITY_MODELS[input.quality].id,
      max_tokens: 8000,
      thinking: { type: 'adaptive' },
      system: PROFILE_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildProfileUserMessage(input.history) }],
      output_config: { effort: 'medium', format: zodOutputFormat(StyleProfileSchema) },
    },
    input.timeoutMs ? { timeout: input.timeoutMs } : undefined
  )
  input.onUsage?.({ inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens })
  if (response.stop_reason === 'refusal') throw new RefusedError('この内容では文体をまとめられませんでした')
  const profile = response.parsed_output
  if (!profile) throw new Error('AIから文体のまとめを受け取れませんでした')
  return profile
}

// ------------------------------------------------------------------ 2. 次の1本

export function buildPostSystemPrompt(): string {
  return `あなたはX(旧Twitter)で、ある人の名前で投稿する次の1本を書きます。

前提:
- 書いた文は、ご本人が予約一覧で見られる状態で並び、時刻が来るとそのまま投稿される。
  確認を求める文や、選択肢の提示は書かない。投稿そのものだけを書く
- 【この人らしさ】と【お手本】から、語調・一人称・語尾・文の長さ・改行・絵文字の使い方を読み取り、
  同じ書き手が書いたと感じられる文章にする
- 話題は【この人らしさ】のよく書く話題から選び、毎回切り口を変える。お手本の内容や言い回しをそのまま流用しない
- まず今回の話題を決めてから書く。話題は偏りやすい（同じ括りの話題が続くと、別の投稿に見えず飽きられる）ので、
  【最近多すぎる話題】にある括りは選ばず、【最近少ない話題】があればその中から選ぶ。
  括りは大きく見る（ハイボールもジンソーダも晩酌も、同じ「お酒」。その括りが挙がっていれば、別のお酒の話も不可）
- 【今回の書き方】があれば、型と長さに必ず従う。最近の投稿と同じ骨組み（「◯◯、△△。□□。」のように、場所や物の話→不満→オチ、の繰り返し）で書かない
- 【本人がよく取り消す言葉・話題】にあるものは、取り消される文の特徴なので、使わない・選ばない。
- 今までに書いたことがない題材を選ぶ。【まだ書いたことがない題材の候補】があれば、その中から1つ選び、
  【使いすぎの言葉】にある言葉は、使わない・言い換えない。題材は新しくても、語尾・口調・文の長さ・改行・絵文字・
  「w」や「草」の使い方は、【この人らしさ】と【お手本】から取り入れて、本人の言い回しで書く
- 【最近の投稿の傾向】があるときは、長さ・句点・絵文字・「w」「草」などの割合は、その数字に合わせる
  （本人の書き方は変わる。文章のルールにある書き方の説明より、毎回計算した最新の数字を優先する）

書いてはいけないもの:
- 事実を作らない。数字・出来事・固有名詞・体験談・実績・約束・予定をでっち上げない。
  本人が過去に言っていない意見を代弁しない（毎日そのまま本人の名前で出るため、作り話が混ざると本人が嘘をついたことになる）
- 【最近の投稿】と、同じ話題・同じ書き出し・同じ語尾の組み合わせを繰り返さない。言い換えただけの文も不可
- 【最近の投稿】と、同じ文の型を続けない。話題が違っても、「問いかけ→皮肉→そう思いながら〜」のような同じ骨組みで
  書くと、別の投稿に見えず飽きられる。長さ・書き出し・締め方も、毎回変える
- 【本人が取り消した投稿】がある場合、それと同じ話題・同じ型・同じ言い回し・似た切り口は書かない。
  取り消されたのは、本人が「これは要らない」と判断したため。言い換えただけの文も不可
- 同じ日の【ほかの予約】と話題が重ならないようにする
- URL・ハッシュタグ・メンション（@）を入れない
- 過去の投稿の範囲を超えて過激にしない。露骨な描写は避け、お手本と同じ程度のほのめかしにとどめる
  （露骨な表現はXの規約で投稿や口座が止まりやすい）
- 未成年・学生・年齢が曖昧な相手を連想させる表現は、どんな形でも書かない

出力の形:
- posts 配列に案を1つだけ入れる
- segments は必ず1要素だけにする（単発投稿）
- note には「どういう切り口か」を日本語で15字程度で書く

${WRITING_RULES}`
}

export interface PostPromptInput {
  profile: StyleProfile
  samples: HistoryPost[]
  /** 最近の投稿（新しい順）。自動運転で作ったものと、ご本人の実際の投稿。 */
  recent: string[]
  /** 本人が「取り消す」で外した投稿（新しい順）。同じ話題・型・言い回しを出さない。無ければ省略してよい。 */
  rejected?: string[]
  /** 直近の本人の投稿から毎回計算した、書き方の傾向（長さ・句点・絵文字などの割合）。describeRecentStyle。無ければ省略。 */
  recentStyle?: string
  /** 最近多すぎる話題（1行ずつ）。今回は選ばない。無ければ省略。describeCrowded。 */
  crowded?: string[]
  /** ふだん書くのに最近出ていない話題の括り。今回はここから選ぶ。無ければ省略。neglectedTopics。 */
  neglected?: string[]
  /** 今回の書き方（枠ごとに決める）。型と長さ。無ければ省略。pickVariety。 */
  form?: WritingForm
  length?: LengthTarget
  /** 最近の投稿で何度も使っている書き出し・締め。今回は避ける。無ければ省略。repeatedOpenings / repeatedEndings。 */
  avoidOpenings?: string[]
  avoidEndings?: string[]
  /** よく取り消される言葉（回数つき、1行ずつ）。本人が何度も「要らない」と取り消したもの。今回は使わない。無ければ省略。describeRejectedWords。 */
  rejectedWords?: string[]
  /** よく取り消される話題の括り。今回は選ばない。無ければ省略。describeRejectedTopics。 */
  rejectedTopics?: string[]
  /** 最近の投稿で何度も出ている言葉（「焼き芋」「ハイボール」など）。今回は使わない。無ければ省略。frequentWords。 */
  overused?: string[]
  /** まだ書いたことがない題材の候補。今回はここから選ぶと、新しい内容になる。無ければ省略。pickFreshThemes。 */
  fresh?: string[]
  /** 同じ日にすでに予約されている投稿。話題の重なりを避ける。 */
  plannedSameDay: string[]
  scheduledAt: string
  timeZone: string
  /** 直前の案が検査で弾かれた理由。書き直すときだけ渡す。 */
  feedback?: string
}

function describeProfile(profile: StyleProfile): string {
  const v = profile.voice
  return [
    `概要: ${profile.summary}`,
    `一人称・呼びかけ: ${v.person}`,
    `よく使う語尾: ${v.endings.join(' / ') || '特になし'}`,
    `絵文字・記号: ${v.emoji}`,
    `長さ・改行: ${v.layout}`,
    `よく書く話題:\n${profile.themes.map((t) => `- ${t.name}: ${t.note}`).join('\n') || '- 特になし'}`,
    profile.avoid.length ? `やらないこと:\n${profile.avoid.map((a) => `- ${a}`).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function describeSlot(scheduledAt: string, timeZone: string): string {
  const date = new Date(scheduledAt)
  if (Number.isNaN(date.getTime())) return ''
  try {
    return date.toLocaleString('ja-JP', {
      timeZone,
      month: 'long',
      day: 'numeric',
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    // 保存されたタイムゾーン名が実行環境で解決できないことがある。時刻が出せないだけで、書くことはできる。
    return date.toLocaleString('ja-JP', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }
}

export function buildPostUserMessage(input: PostPromptInput): string {
  const sections: string[] = [`【この人らしさ】\n${describeProfile(input.profile)}`]
  if (input.recentStyle?.trim()) {
    sections.push(`【最近の投稿の傾向】（毎回、最新の履歴から計算した数字。長さ・割合はこれに合わせる）\n${input.recentStyle.trim()}`)
  }

  if (input.samples.length) {
    sections.push(
      `【お手本】（この人の実際の投稿。書き方の参考。内容は流用しない）\n${input.samples
        .map((p, i) => `【例${i + 1}】\n${p.text}`)
        .join('\n\n')}`
    )
  }
  const recent = input.recent.map((t) => t.trim()).filter(Boolean)
  sections.push(
    recent.length
      ? `【最近の投稿】（新しい順。同じ話題・書き出し・語尾を繰り返さない）\n${recent.map((t, i) => `(${i + 1}) ${t}`).join('\n')}`
      : '【最近の投稿】まだない'
  )
  const rejected = (input.rejected ?? []).map((t) => t.trim()).filter(Boolean)
  if (rejected.length) {
    sections.push(
      `【本人が取り消した投稿】（新しい順。本人が「要らない」と判断したもの。同じ話題・型・言い回し・似た切り口は書かない）\n${rejected
        .map((t, i) => `(${i + 1}) ${t}`)
        .join('\n')}`
    )
  }
  const crowded = (input.crowded ?? []).map((t) => t.trim()).filter(Boolean)
  if (crowded.length) {
    sections.push(
      `【最近多すぎる話題】（最近の投稿を数えたもの。この括りの話題は、今回は書かない。同じ括りの別の話も不可）\n${crowded.map((t) => `- ${t}`).join('\n')}`
    )
  }
  const neglected = (input.neglected ?? []).map((t) => t.trim()).filter(Boolean)
  if (neglected.length) {
    sections.push(
      `【最近少ない話題】（本人がふだん書くのに、最近は出ていない括り。今回はここから選ぶとよい。事実は作らず、感想や考えとして書く）\n${neglected.map((t) => `- ${t}`).join('\n')}`
    )
  }
  if (input.form || input.length) {
    const lines = [
      input.form ? `型: ${input.form.name}（${input.form.how}）` : '',
      input.length ? `長さ: ${input.length.label}（${input.length.hint}）` : '',
      (input.avoidOpenings ?? []).length ? `書き出しは、次では始めない: ${(input.avoidOpenings ?? []).map((o) => `「${o}」`).join('')}` : '',
      (input.avoidEndings ?? []).length ? `締めは、次で終えない: ${(input.avoidEndings ?? []).map((o) => `「${o}」`).join('')}` : '',
    ].filter(Boolean)
    sections.push(`【今回の書き方】（必ず従う。内容が違っても、毎回同じ骨組みにならないようにするための指定）\n${lines.map((t) => `- ${t}`).join('\n')}`)
  }
  const rejectedWords = (input.rejectedWords ?? []).map((t) => t.trim()).filter(Boolean)
  const rejectedTopics = (input.rejectedTopics ?? []).map((t) => t.trim()).filter(Boolean)
  if (rejectedWords.length || rejectedTopics.length) {
    const lines = [...rejectedWords.map((t) => `言葉: ${t}`), ...rejectedTopics.map((t) => `話題: ${t}`)]
    sections.push(
      `【本人がよく取り消す言葉・話題】（これまでに取り消された自動運転の文を分析したもの。この言葉・話題は、今回は使わない・選ばない。言い換えや、同じ括りの別の話も不可）\n${lines.map((t) => `- ${t}`).join('\n')}`
    )
  }
  const overused = (input.overused ?? []).map((t) => t.trim()).filter(Boolean)
  if (overused.length) {
    sections.push(
      `【使いすぎの言葉】（最近の投稿で何度も出ている言葉。今回は、これらの言葉も、同じ題材も使わない。言い換えも不可）\n${overused.map((t) => `- ${t}`).join('\n')}`
    )
  }
  const fresh = (input.fresh ?? []).map((t) => t.trim()).filter(Boolean)
  if (fresh.length) {
    sections.push(
      `【まだ書いたことがない題材の候補】（過去の投稿に1度も出ていない題材。今回はここから1つ選ぶ。体験談や事実は作らず、見たこと・思ったこと・あるあるとして、本人の言い回しで書く）\n${fresh.map((t) => `- ${t}`).join('\n')}`
    )
  }
  const planned = input.plannedSameDay.map((t) => t.trim()).filter(Boolean)
  if (planned.length) sections.push(`【ほかの予約】（同じ日。話題が重ならないように）\n${planned.map((t) => `- ${t}`).join('\n')}`)

  const when = describeSlot(input.scheduledAt, input.timeZone)
  if (when) sections.push(`投稿する日時: ${when}`)
  if (input.feedback) sections.push(`直前の案は使えませんでした。理由: ${input.feedback}\n別の切り口で書き直してください。`)
  return sections.join('\n\n')
}

export interface WriteAutopilotPostInput extends PostPromptInput {
  apiKey: string
  quality: Quality
  timeoutMs?: number
  onUsage?: (usage: Usage) => void
}

/** 次の1本の本文を書く。作れなかったときは undefined。 */
export async function writeAutopilotPost(input: WriteAutopilotPostInput): Promise<string | undefined> {
  const posts = await writePosts({
    apiKey: input.apiKey,
    system: buildPostSystemPrompt(),
    user: buildPostUserMessage(input),
    model: QUALITY_MODELS[input.quality].id,
    // 短い1本を書く仕事で、深い推論は要らない。費用の大半は考える分なので medium に留める。
    effort: 'medium',
    timeoutMs: input.timeoutMs,
    onUsage: input.onUsage,
  })
  return posts[0]?.segments[0]?.trim() || undefined
}

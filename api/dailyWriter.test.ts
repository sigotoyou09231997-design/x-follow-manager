// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildDailySystemPrompt, buildDailyUserMessage } from './_lib/dailyWriter.js'

// 毎日の自動投稿は誰にも見られずにそのまま出る。画面から作る投稿と違って
// 「おかしければ人が直す」が効かないぶん、プロンプト側で釘を刺しておく必要がある。
describe('毎日投稿のシステムプロンプト', () => {
  it('人の確認を経ずに投稿されることを前提に書かせる', () => {
    const prompt = buildDailySystemPrompt()
    expect(prompt).toContain('人の目を通さずそのまま投稿される')
    expect(prompt).toContain('確認を求める文')
  })

  // お題しか無い状態で毎日書かせると、AIは具体性を出そうとして体験談を作りがち。
  // それが本人の名前で毎日出ると、本人が嘘をついたことになる。
  it('お題に無い事実を作らないよう指示する', () => {
    const prompt = buildDailySystemPrompt()
    expect(prompt).toContain('でっち上げない')
    expect(prompt).toContain('作り話が混ざると本人が嘘をついたことになる')
  })

  it('単発投稿1本だけを作らせる', () => {
    const prompt = buildDailySystemPrompt()
    expect(prompt).toContain('案を1つだけ入れる')
    expect(prompt).toContain('segments は必ず1要素だけにする')
  })

  // 画面からの生成と同じ制約（140字・URL・ハッシュタグ）を共有できているか。
  // ここがずれると、自動投稿だけが投稿時に失敗する。
  it('画面からの生成と同じ文章のルールを含む', () => {
    expect(buildDailySystemPrompt()).toContain('全角140字/半角280字以内')
  })
})

describe('毎日投稿のユーザーメッセージ', () => {
  const base = {
    topic: '個人開発で気づいたこと',
    recentTexts: [],
    scheduledAt: '2026-08-28T00:00:00.000Z',
    timeZone: 'Asia/Tokyo',
  }

  it('お題と投稿日を渡す', () => {
    const text = buildDailyUserMessage(base)
    expect(text).toContain('お題(毎回の題材):\n個人開発で気づいたこと')
    // JSTでは9時。日付がずれないことまで見る。
    expect(text).toContain('2026年8月28日金曜日')
  })

  it('直近の投稿を「繰り返さないもの」として渡す', () => {
    const text = buildDailyUserMessage({ ...base, recentTexts: ['きのうの投稿', 'おとといの投稿'] })
    expect(text).toContain('最近投稿したもの')
    expect(text).toContain('きのうの投稿')
    expect(text).toContain('おとといの投稿')
  })

  // 1本目は過去が無い。何も言わずに省くと、AIは渡し忘れなのか初回なのか区別できない。
  it('1本目はその旨を明示する', () => {
    expect(buildDailyUserMessage(base)).toContain('この繰り返しの1本目')
  })

  it('空白だけの過去投稿は渡さない', () => {
    const text = buildDailyUserMessage({ ...base, recentTexts: ['  ', ''] })
    expect(text).toContain('この繰り返しの1本目')
  })

  // 端末のタイムゾーン名がサーバー側で解決できないことがある。
  // ここで例外が出ると、その日の投稿そのものが作られない。
  it('解決できないタイムゾーンでも日付を出して止まらない', () => {
    const text = buildDailyUserMessage({ ...base, timeZone: 'Mars/Olympus' })
    expect(text).toContain('投稿する日:')
  })
})

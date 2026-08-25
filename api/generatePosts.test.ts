// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildSystemPrompt, buildUserMessage, readMessage } from './generatePosts.js'

// 画面の入力欄が「AIに伝えたいこと」1つになったので、サーバー側もそれを
// 「お題（何について書くか）」ではなく「伝えたい中身そのもの」として扱う。
describe('generatePosts のプロンプト', () => {
  it('伝えたいことを、その見出しでAIへ渡す', () => {
    const text = buildUserMessage({ message: '3か月作ったアプリを出した' }, 3)
    expect(text).toContain('伝えたいこと:\n3か月作ったアプリを出した')
    expect(text).toContain('作る案の数: 3')
    expect(text).not.toContain('お題')
  })

  it('書きかけの本文があれば、指示語の参照先として添える', () => {
    const text = buildUserMessage({ message: 'もっと短く', currentText: 'いまの本文' }, 1)
    expect(text).toContain('もっと短く')
    expect(text).toContain('いまの本文')
  })

  it('前後の空白だけの入力は、書かれていないものとして扱う', () => {
    expect(readMessage({ message: '  \n ' })).toBe('')
    expect(readMessage({})).toBe('')
    expect(readMessage({ message: '  伝えたいこと  ' })).toBe('伝えたいこと')
  })

  // 画面を先に配って関数が古いままの瞬間があっても、入力が無視されないようにする。
  it('旧名 topic で来ても受け取る', () => {
    expect(readMessage({ topic: '古い画面からの入力' })).toBe('古い画面からの入力')
    // 新旧そろっているときは新しい方を使う
    expect(readMessage({ message: '新', topic: '旧' })).toBe('新')
  })
})

describe('generatePosts のシステムプロンプト', () => {
  it('メモのまま渡される前提で、内容を落とさず、足さないよう指示する', () => {
    const prompt = buildSystemPrompt('single', 3)
    expect(prompt).toContain('伝えたいこと')
    expect(prompt).toContain('書かれている要素は落とさない')
    expect(prompt).toContain('書かれていないことを足さない')
  })

  // 1つの欄に書く以上、「淡々と」のような文体の希望が中身に混ざって届く。
  // それを投稿本文に書いてしまうと、指定した本人がいちばん驚く。
  it('文体の希望は指示として扱い、本文に混ぜないよう指示する', () => {
    expect(buildSystemPrompt('single', 3)).toContain('その言葉自体を投稿本文に入れない')
  })

  it('形式によってsegmentsの作り方を切り替える', () => {
    expect(buildSystemPrompt('single', 3)).toContain('segments は必ず1要素だけにする')
    expect(buildSystemPrompt('thread', 5)).toContain('5 個前後の segments')
  })
})

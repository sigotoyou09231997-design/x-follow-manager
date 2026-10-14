// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// 見た目の上塗り（theme-teal.css）の色が、文字の読みやすさの目安（WCAG の 4.5:1）を割らないこと。
// 実例: 一段明るい青緑 #0f7f79 は、ページの地(#f3f6f6)の上で 4.46:1 と、わずかに届かなかった。
// 色を直したときに、黙って読みにくくならないように、CSS の値をそのまま読んで確かめる。

const css = readFileSync(new URL('./theme-teal.css', import.meta.url), 'utf8')

function parseVars(block: string): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const m of block.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) vars[m[1]] = m[2].trim()
  return vars
}

function resolve(vars: Record<string, string>, name: string): string {
  let value = vars[name]
  for (let i = 0; i < 5 && value?.startsWith('var('); i++) value = vars[value.slice(4, -1).trim()]
  return value
}

const light = parseVars(css.match(/^:root \{([\s\S]*?)\n\}/m)![1])
const darkMedia = parseVars(
  css.match(/@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme='light'\]\) \{([\s\S]*?)\n  \}\n\}/)![1]
)
const darkAttr = parseVars(css.match(/:root\[data-theme='dark'\] \{([\s\S]*?)\n\}/)![1])

function rgb(color: string): [number, number, number] {
  const hex = color.match(/^#([0-9a-f]{6})$/i)
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)) as [number, number, number]
  throw new Error(`色が読めません: ${color}`)
}

function luminance([r, g, b]: [number, number, number]): number {
  const f = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** rgba(r,g,b,a) を、下の色の上に重ねた色。 */
function over(rgba: string, under: [number, number, number]): [number, number, number] {
  const m = rgba.match(/^rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/)!
  const a = Number(m[4])
  return [1, 2, 3].map((i) => Math.round(Number(m[i]) * a + under[i - 1] * (1 - a))) as [number, number, number]
}

const WHITE: [number, number, number] = [255, 255, 255]

describe('theme-teal: ライト', () => {
  const c = (name: string) => rgb(resolve(light, name))

  it('アクセント(文字・リンク)は、白・ページの地・薄い青緑の面の上で 4.5:1 以上', () => {
    expect(contrast(c('--accent'), WHITE)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(c('--accent'), c('--bg'))).toBeGreaterThanOrEqual(4.5)
    // 選んでいるナビ・チップの面（アクセントの薄い色を白に重ねたもの）の上の、アクセントの文字
    expect(contrast(c('--accent'), over(light['--accent-bg'], WHITE))).toBeGreaterThanOrEqual(4.5)
  })

  it('主ボタン（塗りは accent / hover の上に白文字）は 4.5:1 以上', () => {
    expect(contrast(c('--on-accent'), c('--accent'))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(c('--on-accent'), c('--accent-hover'))).toBeGreaterThanOrEqual(4.5)
  })

  it('補足の文字・本文は、白・ページの地・灰色の面の上で 4.5:1 以上', () => {
    for (const under of ['--surface', '--bg', '--neutral-bg']) {
      expect(contrast(c('--text-muted'), c(under))).toBeGreaterThanOrEqual(4.5)
      expect(contrast(c('--text'), c(under))).toBeGreaterThanOrEqual(7)
    }
  })

  it('成功の色（青緑に寄せた）も、文字としても、白文字を載せる塗りとしても 4.5:1 以上', () => {
    expect(contrast(c('--success'), WHITE)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(WHITE, c('--success-strong'))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(WHITE, c('--success-hover'))).toBeGreaterThanOrEqual(4.5)
  })

  it('選んでいる黒いチップの文字は 7:1 以上', () => {
    expect(contrast(c('--chip-on-text'), c('--chip-on-bg'))).toBeGreaterThanOrEqual(7)
    expect(contrast(c('--fab-text'), c('--fab-bg'))).toBeGreaterThanOrEqual(7)
  })
})

describe('theme-teal: ダーク', () => {
  const c = (name: string) => rgb(resolve({ ...light, ...darkAttr }, name))

  it('@media の定義と data-theme の定義は、同じ内容（片方だけ直して食い違わない）', () => {
    expect(darkMedia).toEqual(darkAttr)
  })

  it('アクセント(文字・リンク)は、黒地・面の上で 4.5:1 以上。その上の文字（on-accent）も', () => {
    for (const under of ['--bg', '--surface', '--surface-2']) {
      expect(contrast(c('--accent'), c(under))).toBeGreaterThanOrEqual(4.5)
    }
    expect(contrast(c('--on-accent'), c('--accent'))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(c('--on-accent'), c('--accent-hover'))).toBeGreaterThanOrEqual(4.5)
  })

  it('補足の文字・本文は、黒地・面・灰色の面の上で 4.5:1 以上', () => {
    for (const under of ['--bg', '--surface', '--neutral-bg']) {
      expect(contrast(c('--text-muted'), c(under))).toBeGreaterThanOrEqual(4.5)
      expect(contrast(c('--text'), c(under))).toBeGreaterThanOrEqual(7)
    }
  })

  it('成功の色は、文字としても、白文字を載せる塗りとしても 4.5:1 以上', () => {
    expect(contrast(c('--success'), c('--surface'))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(WHITE, c('--success-strong'))).toBeGreaterThanOrEqual(4.5)
  })

  it('反転した白いチップ・＋の文字は 7:1 以上', () => {
    expect(contrast(c('--chip-on-text'), c('--chip-on-bg'))).toBeGreaterThanOrEqual(7)
    expect(contrast(c('--fab-text'), c('--fab-bg'))).toBeGreaterThanOrEqual(4.5)
  })
})

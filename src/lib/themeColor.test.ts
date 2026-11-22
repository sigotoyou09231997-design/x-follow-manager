import { afterEach, describe, expect, it } from 'vitest'
import { syncThemeColor } from './themeColor'

afterEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
})

function setup(background: string) {
  document.head.innerHTML =
    '<meta name="theme-color" content="#f3f6f6" media="(prefers-color-scheme: light)">' +
    '<meta name="theme-color" content="#0b0e0f" media="(prefers-color-scheme: dark)">'
  document.body.innerHTML = `<div class="app-shell" style="background: ${background}"></div>`
}

const contents = () => [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.getAttribute('content'))

describe('syncThemeColor（上の帯の色を画面の地にそろえる）', () => {
  it('画面の地の色を、theme-color に入れる', () => {
    setup('rgb(255, 255, 255)')
    expect(syncThemeColor()).toBe('rgb(255, 255, 255)')
    expect(contents()).toEqual(['rgb(255, 255, 255)', 'rgb(255, 255, 255)'])
  })

  it('外枠が透明なら、その奥（body）の色を使う', () => {
    setup('transparent')
    document.body.style.background = 'rgb(243, 246, 246)'
    expect(syncThemeColor()).toBe('rgb(243, 246, 246)')
    document.body.style.background = ''
  })

  it('地の色が読めない（どこも透明）ときは、既定の色のまま触らない', () => {
    setup('transparent')
    expect(syncThemeColor()).toBeNull()
    expect(contents()).toEqual(['#f3f6f6', '#0b0e0f'])
  })
})

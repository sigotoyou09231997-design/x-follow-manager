// ログイン後のトップ（自動投稿の1画面）を、お手本データで撮るスクリプト。
//
//   npm run build && npm run preview -- --port 4173 --strictPort   # 別ターミナル
//   node scripts/top-shots.mjs [--out .design-shots/top] [--url http://localhost:4173]
//
// トップはログインが要り、preview には /api も Supabase も無いので、design-shots.mjs ではいつも
// 「接続情報が取れない」案内しか写らなかった（見た目を変えても確かめられなかった）。
// ここでは /api/* と Supabase への通信を Playwright で差し替え、ログイン済みのセッションを先に置いてから撮る。
// 本物のサーバーには1回も通信しない（差し替えなかった通信は止める）。

import { chromium } from '@playwright/test'
import path from 'node:path'
import { mkdir } from 'node:fs/promises'

const ROOT = path.resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const BASE_URL = arg('--url', 'http://localhost:4173')
const OUT_DIR = path.resolve(ROOT, arg('--out', '.design-shots/top'))

const SUPABASE = 'https://demo.supabase.co'
const WITH_PAGES = args.includes('--pages')
const ONLY = arg('--only', '') // 例: running-mobile-light
// 設定から開く画面。feature が無いものは設定の画面そのもの。
const PAGES = [
  { name: 'settings' },
  { name: 'detail-discord', feature: /^自動投稿の文と設定/, tab: 'ディスコード' },
  { name: 'detail-x', feature: /^自動投稿の文と設定/, tab: 'X' },
  { name: 'schedule', feature: /^予約投稿/ },
  { name: 'tidy', feature: /^フォロー整理/ },
]
const now = Date.now()
const iso = (msFromNow) => new Date(now + msFromNow).toISOString()
const MIN = 60_000
const HOUR = 60 * MIN

const settings = {
  postsPerDay: 3,
  windowStart: '08:00',
  windowEnd: '23:00',
  timeZone: 'Asia/Tokyo',
  horizonDays: 2,
  monthlyBudgetYen: 3000,
  quality: 'standard',
  requireApproval: true,
  deletePrevious: false,
  deletePreviousFrom: null,
}

const xState = (enabled) => ({
  enabled,
  settings,
  xAccount: { username: 'sample' },
  history: { total: 1200, fetchedAt: iso(-HOUR), newestAt: iso(-2 * HOUR), oldestAt: iso(-200 * 24 * HOUR) },
  profileReady: true,
  profile: null,
  recentStyle: null,
  profileBuiltAt: iso(-HOUR),
  usage: { month: new Date(now).toISOString().slice(0, 7), yen: 412, posts: 30, generations: 41 },
  lastError: null,
})

const channel = (name, patch = {}) => ({
  channel: name,
  messages: ['お手本の文です'],
  hours: [null],
  schedule: { hour: 12, activeIndexes: [0], idle: false, nextHour: null },
  archive: [],
  version: 3,
  savedAt: iso(-24 * HOUR),
  status: { lastPost: { t: iso(-4 * MIN), text: 'お手本の文です' }, today: 128, at: iso(-30 * 1000) },
  paused: false,
  pausedAt: null,
  pauseReady: true,
  limits: { maxLength: 1000, maxMessages: 10 },
  ...patch,
})

const post = (id, status, msFromNow, text) => ({
  id,
  user_id: 'demo-user',
  status,
  scheduled_at: iso(msFromNow),
  segments: [{ text, media: [] }],
  repeat_rule: null,
  repeat_parent_id: null,
  posted_tweet_ids: null,
  error_message: null,
  attempt_count: 0,
  ai_prompt: `autopilot:${id}`,
  created_at: iso(-HOUR),
  updated_at: iso(-HOUR),
})

// 撮る場面: ふだん（全部動いている）と、全部止めたあと。open があれば、そのボタンを押して開いた状態も撮る。
const SCENES = [
  {
    name: 'running',
    open: ['ディスコードの文を見る・直す', 'Xの文を見る・直す'],
    x: xState(true),
    channels: {
      discord: channel('discord', { archive: ['前に使っていた募集の文です', '週末だけ見てます。気軽にどうぞ'] }),
      yay: channel('yay', { status: { lastPost: { t: iso(-2 * MIN), text: 'x' }, today: 96, at: iso(-20 * 1000) } }),
    },
    posts: [
      { ...post('p1', 'posted', -3 * HOUR, '雨の音を聞きながら昼寝した。'), ai_prompt: null },
      { ...post('p2', 'posted', -27 * HOUR, '駅前のパン屋、今日も行列だった。') },
      post('a', 'scheduled', 3 * HOUR, '昼ごはんは近所の定食屋。焼き魚がうまかった。'),
      post('b', 'scheduled', 7 * HOUR, '今日は早めに帰れそう。'),
      post('c', 'draft', 26 * HOUR, '朝の電車がいつもより空いていた。'),
    ],
  },
  {
    name: 'stopped',
    x: xState(false),
    channels: {
      discord: channel('discord', { paused: true, pausedAt: iso(-20 * MIN), status: { lastPost: null, today: 40, at: iso(-30 * 1000), paused: true } }),
      yay: channel('yay', { paused: true, pausedAt: iso(-20 * MIN), status: { lastPost: null, today: 30, at: iso(-30 * 1000), paused: true } }),
    },
    posts: [],
  },
]

const VIEWPORTS = [
  { name: 'pc', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 },
]

const session = {
  access_token: 'demo-access-token',
  refresh_token: 'demo-refresh-token',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(now / 1000) + 3600,
  user: { id: 'demo-user', aud: 'authenticated', role: 'authenticated', email: 'demo@example.com', app_metadata: {}, user_metadata: {} },
}

async function shoot(browser, scene, viewport, theme) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor ?? 1,
    isMobile: viewport.isMobile ?? false,
    colorScheme: theme,
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
  })
  await context.addInitScript((value) => {
    localStorage.setItem('sb-demo-auth-token', value)
  }, JSON.stringify(session))

  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    if (url.origin === new URL(BASE_URL).origin) {
      if (url.pathname === '/api/config') return json({ supabaseUrl: SUPABASE, supabaseAnonKey: 'demo-anon-key', configured: {} })
      if (url.pathname === '/api/autopost') {
        if (url.searchParams.get('part') === 'restart') return json({ restart: { ready: true, requestedAt: null, handledAt: null, result: null } })
        return json({ channels: scene.channels })
      }
      if (url.pathname === '/api/xAutopilot') return json({ state: scene.x })
      if (url.pathname.startsWith('/api/')) return json({})
      return route.continue()
    }
    if (url.origin === SUPABASE) {
      if (url.pathname.startsWith('/rest/v1/scheduled_posts')) return json(scene.posts)
      if (url.pathname.startsWith('/auth/v1/user')) return json(session.user)
      if (url.pathname.startsWith('/rest/v1/rpc/my_x_account')) return json([{ x_user_id: '1', username: 'sample', connected_at: iso(-30 * 24 * HOUR) }])
      if (url.pathname.startsWith('/rest/v1/')) return json([])
      return json({})
    }
    // Google Fonts など、見た目に要る外のものだけ通す。それ以外の外への通信は止める。
    if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) return route.continue()
    return route.abort()
  })

  const page = await context.newPage()
  await page.goto(BASE_URL)
  await page.getByRole('region', { name: '稼働スイッチ' }).waitFor({ timeout: 15_000 })
  await page.waitForTimeout(800) // 出てくる動きが終わるのを待つ
  const file = path.join(OUT_DIR, `${scene.name}-${viewport.name}-${theme}.png`)
  await page.screenshot({ path: file, fullPage: true })
  const files = [file]
  // トップ以外の画面（設定・機能の画面）。--pages を付けたときだけ撮る。
  if (WITH_PAGES && scene.name === 'running') {
    for (const target of PAGES) {
      await page.goto(BASE_URL)
      await page.getByRole('region', { name: '稼働スイッチ' }).waitFor({ timeout: 15_000 })
      await page.getByRole('button', { name: '設定を開く' }).click()
      if (target.feature) {
        await page.getByRole('region', { name: '機能' }).getByRole('button', { name: target.feature }).click()
      }
      if (target.tab) await page.getByRole('tab', { name: target.tab }).click()
      await page.waitForTimeout(900)
      const shot = path.join(OUT_DIR, `page-${target.name}-${viewport.name}-${theme}.png`)
      await page.screenshot({ path: shot, fullPage: true })
      files.push(shot)
    }
    await page.goto(BASE_URL)
    await page.getByRole('region', { name: '稼働スイッチ' }).waitFor({ timeout: 15_000 })
  }
  for (const label of scene.open ?? []) {
    await page.getByRole('button', { name: label }).click()
    await page.getByRole('dialog').waitFor()
    await page.waitForTimeout(400)
    const opened = path.join(OUT_DIR, `${scene.name}-${viewport.name}-${theme}-${label.slice(0, label.indexOf('の'))}.png`)
    await page.screenshot({ path: opened })
    files.push(opened)
    await page.getByRole('button', { name: '閉じる' }).click()
  }
  await context.close()
  return files.join('\n')
}

await mkdir(OUT_DIR, { recursive: true })
const browser = await chromium.launch()
try {
  for (const scene of SCENES) {
    for (const viewport of VIEWPORTS) {
      for (const theme of ['light', 'dark']) {
        if (ONLY && `${scene.name}-${viewport.name}-${theme}` !== ONLY) continue
        console.log(await shoot(browser, scene, viewport, theme))
      }
    }
  }
} finally {
  await browser.close()
}

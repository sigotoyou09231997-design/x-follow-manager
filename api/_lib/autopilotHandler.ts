import Anthropic from '@anthropic-ai/sdk'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { AutopilotState } from '../../src/lib/xAutopilot/types.js'
import { requireUserId, UnauthorizedError } from './auth.js'
import {
  buildProfile,
  disable,
  enable,
  EngineError,
  previewPost,
  readHistory,
  saveSettings,
  usageFor,
  type EngineDeps,
} from './autopilotEngine.js'
import { AutopilotNotReadyError, supabaseAutopilotStore, type AutopilotRow } from './autopilotStore.js'
import { writeAutopilotPost, writeProfile } from './autopilotWriter.js'
import { anthropicApiKey, apiKeyShape, RefusedError } from './postWriter.js'
import { getAccessToken } from './xToken.js'
import { fetchOwnPosts, XApiError } from './xClient.js'

// X の自動運転の画面向けの受け口（POST /api/xAutopilot）。Supabase のログインが要る。
//   { action: 'get' }                            … いまの状態
//   { action: 'saveSettings', settings }          … 設定の保存
//   { action: 'readHistory', limit?, full? }      … 自分の過去の投稿を X から読む（読んだ件数ぶん課金）
//   { action: 'buildProfile' }                    … 履歴から文体をまとめる（AI）
//   { action: 'preview' }                         … 保存せずに1本書いてみる（AI）
//   { action: 'enable' } / { action: 'disable' }  … 自動運転の ON / OFF
// 中身は autopilotEngine.ts。ここは「誰が・何を頼んだか」の確認と、失敗の日本語化だけを持つ。

export interface HandlerDeps {
  engine: EngineDeps
  authenticate: (authorization: string | undefined) => Promise<string>
}

/** AIを1回呼ぶときの時間の上限。関数全体の実行時間（60秒）に収める。 */
const AI_TIMEOUT_MS = 50_000
/** 受け付けてからこれを過ぎたら、書き直しなどの新しいAI呼び出しは始めない（60秒を超えて切られないため）。 */
const AI_START_BUDGET_MS = 25_000

function defaultDeps(startedAt = Date.now()): HandlerDeps {
  return {
    engine: {
      store: supabaseAutopilotStore(),
      now: () => new Date(),
      apiKey: anthropicApiKey,
      getAccessToken: (userId) => getAccessToken(userId),
      fetchOwnPosts,
      writeProfile,
      writePost: writeAutopilotPost,
      aiTimeoutMs: AI_TIMEOUT_MS,
      canStartAi: () => Date.now() - startedAt < AI_START_BUDGET_MS,
    },
    authenticate: requireUserId,
  }
}

export const SETUP_MESSAGE =
  '自動運転の保存先がまだ用意されていません。Supabase の SQL Editor で supabase/sql/007_x_autopilot.sql を実行すると使えるようになります'

export function toState(row: AutopilotRow, account: { username: string } | null, now: Date): AutopilotState {
  const dates = row.history.map((p) => p.at).sort()
  return {
    enabled: row.enabled,
    settings: row.settings,
    xAccount: account ? { username: account.username } : null,
    history: {
      total: row.history.length,
      fetchedAt: row.historyFetchedAt,
      newestAt: dates.at(-1) ?? null,
      oldestAt: dates[0] ?? null,
    },
    profileReady: !!row.profile,
    profileBuiltAt: row.profileBuiltAt,
    usage: usageFor(row, now),
    lastError: row.lastError,
  }
}

function readBody(req: VercelRequest): Record<string, unknown> | null {
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function failure(res: VercelResponse, error: unknown) {
  if (error instanceof UnauthorizedError) return res.status(401).json({ error: error.message })
  if (error instanceof AutopilotNotReadyError) return res.status(503).json({ error: SETUP_MESSAGE, setup: true })
  if (error instanceof EngineError) return res.status(error.status).json({ error: error.message })
  // X の失敗は、読み取りで理由を日本語にしてある（クレジット不足・権限・制限）。そのまま見せる。
  if (error instanceof XApiError) return res.status(error.status === 429 ? 429 : 502).json({ error: error.message })
  if (error instanceof RefusedError) {
    return res.status(422).json({ error: 'AIがこの内容を書くのを断りました。もう一度お試しください' })
  }
  if (error instanceof Anthropic.RateLimitError) {
    return res.status(429).json({ error: 'AIの利用制限に達しました。しばらく待ってお試しください' })
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return res.status(500).json({
      error: `Anthropic APIキーが拒否されました（401）。設定値の形: ${apiKeyShape()}`,
    })
  }
  if (error instanceof Anthropic.APIError) {
    return res.status(502).json({ error: `AI呼び出しに失敗しました: ${error.message}` })
  }
  console.error(error)
  return res.status(500).json({ error: 'サーバーでエラーが起きました' })
}

const toLimit = (value: unknown): number | undefined => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.min(Math.max(Math.round(n), 20), 400) : undefined
}

export function createAutopilotHandler(deps?: HandlerDeps) {
  return async function xAutopilot(req: VercelRequest, res: VercelResponse) {
    res.setHeader('cache-control', 'no-store')
    if (req.method !== 'GET' && req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' })
    }
    const { engine, authenticate } = deps ?? defaultDeps() // 受け付けた時刻から数える（関数ごとに作り直す）

    let userId: string
    try {
      userId = await authenticate(req.headers.authorization)
    } catch (error) {
      return failure(res, error)
    }

    const body = req.method === 'POST' ? readBody(req) : {}
    if (!body) return res.status(400).json({ error: 'リクエストの形式が不正です' })
    const action = req.method === 'GET' ? 'get' : body.action

    const stateNow = async () =>
      toState(await engine.store.get(userId), await engine.store.xAccount(userId), engine.now())

    try {
      switch (action) {
        case 'get':
          return res.status(200).json({ state: await stateNow() })

        case 'saveSettings': {
          if (!body.settings || typeof body.settings !== 'object' || Array.isArray(body.settings)) {
            return res.status(400).json({ error: '設定の形が正しくありません' })
          }
          const saved = await saveSettings(engine, userId, body.settings as Record<string, unknown>)
          return res.status(200).json({ state: await stateNow(), rebuilt: saved.rebuilt })
        }

        case 'readHistory': {
          const result = await readHistory(engine, userId, { limit: toLimit(body.limit), full: body.full === true })
          return res.status(200).json({ state: await stateNow(), result })
        }

        case 'buildProfile': {
          await buildProfile(engine, userId)
          return res.status(200).json({ state: await stateNow() })
        }

        case 'preview': {
          const result = await previewPost(engine, userId)
          return res.status(200).json({
            state: await stateNow(),
            preview: { text: result.text ?? null, problems: result.problems },
          })
        }

        case 'enable': {
          const result = await enable(engine, userId)
          return res.status(200).json({ state: await stateNow(), result })
        }

        case 'disable': {
          const result = await disable(engine, userId)
          return res.status(200).json({ state: await stateNow(), result })
        }

        default:
          return res.status(400).json({ error: '不明な操作です' })
      }
    } catch (error) {
      return failure(res, error)
    }
  }
}

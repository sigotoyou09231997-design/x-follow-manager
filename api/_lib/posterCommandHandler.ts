import type { VercelRequest, VercelResponse } from '@vercel/node'
import { UnauthorizedError } from './auth.js'
import { defaultDeps, posterUserId, type Deps } from './autopostHandlers.js'

// Mac の見張り（poster/remote/）が、画面からの「再起動」の依頼を受け取る受け口。合鍵が要る（投稿役と同じもの）。
//   GET  = 未処理の依頼があれば { restart: { requestedAt, ageSeconds } }、無ければ { restart: null }
//   POST = 処理した結果を書き戻す { requestedAt, result }
// Mac が実行するのは「投稿役の入れ替え」だけで、ここから任意のコマンドは送れない（送る口が無い）。

const MAX_RESULT_LENGTH = 300

function readBody(req: VercelRequest): Record<string, unknown> | null {
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export function createPosterCommandHandler(deps?: Pick<Deps, 'store' | 'restart'>, now: () => Date = () => new Date()) {
  return async function posterCommand(req: VercelRequest, res: VercelResponse) {
    res.setHeader('cache-control', 'no-store')
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })
    try {
      const { store, restart } = deps ?? defaultDeps()
      const userId = await posterUserId(store, req.headers.authorization)
      if (!userId) return res.status(401).json({ error: 'unauthorized' })

      if (req.method === 'GET') {
        return res.status(200).json({ restart: (await restart?.pending(userId, now())) ?? null })
      }

      const body = readBody(req)
      const requestedAt = body?.requestedAt
      const result = body?.result
      if (typeof requestedAt !== 'string' || !requestedAt || typeof result !== 'string') {
        return res.status(400).json({ error: '形が違います' })
      }
      const acked = (await restart?.ack(userId, requestedAt, result.slice(0, MAX_RESULT_LENGTH), now())) ?? false
      return res.status(200).json({ ok: true, acked })
    } catch (error) {
      if (error instanceof UnauthorizedError) return res.status(401).json({ error: error.message })
      console.error(error)
      return res.status(500).json({ error: 'サーバーでエラーが起きました' })
    }
  }
}

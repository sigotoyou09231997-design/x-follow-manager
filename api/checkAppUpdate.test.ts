// @vitest-environment node
import http from 'node:http'
import https from 'node:https'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Vercel上でしか動かない関数なので、Supabase(PostgREST)と送信先を偽物に差し替えて
// 一連の流れを手元で通す。ここが黙って何もしなくても、本番では通知が来ないという形でしか
// 現れず、原因の切り分けができないため。
//
// 送信先だけHTTPSなのは、web-push が push の送信に必ず https を使うから
// （実在の送信先は全てHTTPSなので、ライブラリ側にHTTPの経路が無い）。
// そのため自己署名証明書を1枚その場で作る。opensslが無い環境では、送信を伴う
// 2件だけを飛ばす（判断ロジック自体は src/lib/appUpdate.test.ts でも見ている）。

interface FakeState {
  version?: string
  subscriptions: { id: string; endpoint: string; p256dh: string; auth_key: string }[]
  deployedVersion: string
  pushed: string[]
  deleted: string[]
}

let supabaseServer: http.Server
let pushServer: https.Server | undefined
let baseUrl: string
let pushBaseUrl: string
let state: FakeState = { subscriptions: [], deployedVersion: 'build-1', pushed: [], deleted: [] }

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => resolve(body))
  })
}

/** 自己署名証明書を作る。作れなければ undefined（送信を伴うテストは飛ばす）。 */
function createSelfSignedCert(): { key: string; cert: string } | undefined {
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'push-test-'))
    const keyPath = path.join(dir, 'key.pem')
    const certPath = path.join(dir, 'cert.pem')
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', keyPath, '-out', certPath, '-days', '1',
      '-subj', '/CN=127.0.0.1',
      '-addext', 'subjectAltName=IP:127.0.0.1',
    ], { stdio: 'ignore' })
    return { key: fs.readFileSync(keyPath, 'utf-8'), cert: fs.readFileSync(certPath, 'utf-8') }
  } catch {
    return undefined
  }
}

// 証明書はテストの収集時点で必要（it.skipIf はここで評価されるため、beforeAll では遅い）。
const tls = createSelfSignedCert()
const tlsAvailable = !!tls

beforeAll(async () => {
  // --- Supabase(PostgREST)と、公開中のビルドの版数を返す側 ---
  supabaseServer = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const send = (code: number, payload: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json' })
      res.end(JSON.stringify(payload))
    }

    if (url.pathname === '/version.json') return send(200, { version: state.deployedVersion })

    if (url.pathname === '/rest/v1/app_version_state') {
      if (req.method === 'GET') return send(200, state.version ? [{ version: state.version }] : [])
      const body = JSON.parse(await readBody(req)) as { version: string } | { version: string }[]
      state.version = (Array.isArray(body) ? body[0] : body).version
      return send(201, [])
    }

    if (url.pathname === '/rest/v1/push_subscriptions') {
      if (req.method === 'GET') return send(200, state.subscriptions)
      if (req.method === 'DELETE') {
        const id = url.searchParams.get('id')?.replace('eq.', '') ?? ''
        state.deleted.push(id)
        state.subscriptions = state.subscriptions.filter((s) => s.id !== id)
        return send(200, [])
      }
    }

    return send(404, {})
  })
  await new Promise<void>((resolve) => supabaseServer.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(supabaseServer.address() as AddressInfo).port}`

  // --- プッシュの送信先（本来はブラウザベンダーのサーバー） ---
  if (tls) {
    // 自己署名なので検証を切る。このテストプロセス限定。
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
    pushServer = https.createServer(tls, async (req, res) => {
      await readBody(req)
      const id = (req.url ?? '').replace('/push/', '')
      // 410 は「購読が切れている」。ブラウザ側で解除された端末を模す。
      res.writeHead(id === 'gone' ? 410 : 201)
      if (id !== 'gone') state.pushed.push(id)
      res.end()
    })
    await new Promise<void>((resolve) => pushServer!.listen(0, '127.0.0.1', resolve))
    pushBaseUrl = `https://127.0.0.1:${(pushServer!.address() as AddressInfo).port}`
  }

  const webpush = (await import('web-push')).default
  const keys = webpush.generateVAPIDKeys()
  process.env.CRON_SECRET = 'test-cron-secret'
  process.env.SUPABASE_URL = baseUrl
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role'
  process.env.VAPID_PUBLIC_KEY = keys.publicKey
  process.env.VAPID_PRIVATE_KEY = keys.privateKey
  process.env.VAPID_SUBJECT = 'mailto:test@example.com'
  process.env.SITE_URL = baseUrl
})

afterAll(() => {
  supabaseServer.close()
  pushServer?.close()
})

/** ブラウザが発行する購読情報と同じ形（公開鍵と認証秘密）を作る。 */
function fakeSubscription(id: string) {
  const ecdh = crypto.createECDH('prime256v1')
  ecdh.generateKeys()
  return {
    id,
    endpoint: `${pushBaseUrl}/push/${id}`,
    p256dh: ecdh.getPublicKey().toString('base64url'),
    auth_key: crypto.randomBytes(16).toString('base64url'),
  }
}

function fakeRes() {
  const result: { code?: number; body?: Record<string, unknown> } = {}
  const res = {
    status(code: number) {
      result.code = code
      return res
    },
    json(body: Record<string, unknown>) {
      result.body = body
      return res
    },
  }
  return { res: res as never, result }
}

async function run(secret = 'test-cron-secret') {
  const handler = (await import('./checkAppUpdate.js')).default
  const { res, result } = fakeRes()
  await handler({ headers: { 'x-cron-secret': secret } } as never, res)
  return result
}

describe('checkAppUpdate', () => {
  it('cronの合言葉が違えば何もしない', async () => {
    const result = await run('wrong')
    expect(result.code).toBe(401)
  })

  it('初回は記録するだけで通知しない（機能を入れた直後の誤通知を防ぐ）', async () => {
    state.subscriptions = tlsAvailable ? [fakeSubscription('device-a')] : []
    const result = await run()
    expect(result.code).toBe(200)
    expect(result.body).toMatchObject({ recorded: 'build-1', notified: 0 })
    expect(state.pushed).toEqual([])
    expect(state.version).toBe('build-1')
  })

  it('デプロイが変わっていなければ通知しない', async () => {
    const result = await run()
    expect(result.body).toMatchObject({ unchanged: true, notified: 0 })
    expect(state.pushed).toEqual([])
  })

  it.skipIf(!tlsAvailable)('新しいデプロイを見つけたら購読中の端末へ送る', async () => {
    state.deployedVersion = 'build-2'
    const result = await run()
    expect(result.body).toMatchObject({ from: 'build-1', to: 'build-2', notified: 1 })
    expect(state.pushed).toEqual(['device-a'])
    // 次回に同じ通知を繰り返さないよう、記録が進んでいる
    expect(state.version).toBe('build-2')
  })

  it.skipIf(!tlsAvailable)('購読が切れている端末（410）は登録から消す', async () => {
    state.subscriptions = [{ ...fakeSubscription('x'), id: 'gone', endpoint: `${pushBaseUrl}/push/gone` }]
    state.deployedVersion = 'build-3'
    const result = await run()
    expect(result.body).toMatchObject({ notified: 0, removed: 1 })
    expect(state.deleted).toEqual(['gone'])
  })
})

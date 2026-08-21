import type { VercelRequest, VercelResponse } from '@vercel/node'

// 一時的な切り分け用エンドポイント。原因が判明したら削除する。
// 何が落ちているのか本番のログを見ずに特定するため、
// import はすべて動的に行い、失敗してもこの関数自体は落ちないようにする。
export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const result: Record<string, unknown> = {}

  // 1. process.env がそもそも生きているか（Vercelのシステム変数で確認）
  result.env = {
    totalKeys: Object.keys(process.env).length,
    VERCEL: process.env.VERCEL ?? null,
    VERCEL_ENV: process.env.VERCEL_ENV ?? null,
    VERCEL_REGION: process.env.VERCEL_REGION ?? null,
    nodeVersion: process.version,
  }

  // 2. 自分で設定した変数が見えるか（値ではなく有無だけ）
  const names = [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'VITE_SUPABASE_URL',
    'VITE_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'ANTHROPIC_API_KEY',
    'X_CLIENT_ID',
    'X_CLIENT_SECRET',
    'CRON_SECRET',
  ]
  result.ours = Object.fromEntries(names.map((n) => [n, !!process.env[n]]))

  // 3. 自分の環境変数っぽいキーが実際に何個あるか（名前だけ、値は出さない）
  result.visibleCustomKeys = Object.keys(process.env)
    .filter((k) => /SUPABASE|ANTHROPIC|CRON|^X_/.test(k))
    .sort()

  // 4. npmパッケージのimportが通るか（FUNCTION_INVOCATION_FAILEDの原因切り分け）
  const imports: Record<string, string> = {}
  for (const [label, load] of [
    ['@supabase/supabase-js', () => import('@supabase/supabase-js')],
    ['@anthropic-ai/sdk', () => import('@anthropic-ai/sdk')],
    ['zod', () => import('zod')],
    ['api/_lib (underscore dir)', () => import('./_lib/xClient.js')],
    ['../src (api外のファイル)', () => import('../src/lib/schedule/repeat.js')],
  ] as [string, () => Promise<unknown>][]) {
    try {
      await load()
      imports[label] = 'OK'
    } catch (error) {
      imports[label] = `NG: ${(error as Error).message}`.slice(0, 300)
    }
  }
  result.imports = imports

  // 5. 実際にデプロイされているファイル構成（_lib が含まれているかの確認）
  try {
    const { readdirSync, existsSync } = await import('node:fs')
    const tree: Record<string, string[]> = {}
    for (const dir of ['/var/task', '/var/task/api', '/var/task/api/_lib', '/var/task/src']) {
      tree[dir] = existsSync(dir) ? readdirSync(dir).slice(0, 40) : ['(存在しない)']
    }
    result.files = tree
  } catch (error) {
    result.files = `NG: ${(error as Error).message}`
  }

  res.setHeader('cache-control', 'no-store')
  return res.status(200).json(result)
}

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Supabaseの接続情報は、ビルド時に埋め込むのではなく実行時に /api/config から取得する。
// ビルド時埋め込み(import.meta.env.VITE_*)は、Vercelの「Sensitive」設定や
// ビルドキャッシュの影響で黙って欠落することがあり、そうなると
// 「環境変数は正しいのに画面には未設定と出る」という切り分け不能な状態になるため。

interface RuntimeConfig {
  supabaseUrl?: string
  supabaseAnonKey?: string
  configured?: Record<string, boolean>
}

let clientPromise: Promise<SupabaseClient | null> | null = null
let lastConfig: RuntimeConfig | undefined

async function fetchRuntimeConfig(): Promise<RuntimeConfig> {
  try {
    const response = await fetch('/api/config')
    if (!response.ok) return {}
    return (await response.json()) as RuntimeConfig
  } catch {
    // /api が無い環境（vite dev単体、Artifact版）ではここに来る。
    // 予約投稿が使えないだけで、非相互フォローの整理は影響を受けない。
    return {}
  }
}

/** 設定が揃っていなければ null を返す。初回だけ取得し、以降は使い回す。 */
export function getSupabase(): Promise<SupabaseClient | null> {
  if (!clientPromise) {
    clientPromise = fetchRuntimeConfig().then((config) => {
      lastConfig = config
      if (!config.supabaseUrl || !config.supabaseAnonKey) return null
      return createClient(config.supabaseUrl, config.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      })
    })
  }
  return clientPromise
}

export async function requireSupabase(): Promise<SupabaseClient> {
  const client = await getSupabase()
  if (!client) {
    throw new Error(
      'Supabaseの接続情報を取得できませんでした。Vercelの環境変数 SUPABASE_URL と VITE_SUPABASE_ANON_KEY を確認してください。'
    )
  }
  return client
}

/** 画面に出す設定状況（どれが未設定かの切り分け用）。getSupabase()の後に参照する。 */
export function getConfigStatus(): Record<string, boolean> | undefined {
  return lastConfig?.configured
}

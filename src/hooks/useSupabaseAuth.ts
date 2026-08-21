import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { getConfigStatus, getSupabase } from '../lib/supabase'

export interface AuthState {
  session: Session | null
  loading: boolean
  /** Supabaseの接続情報を /api/config から取得できたか。 */
  configured: boolean
  /** どの環境変数が未設定かの切り分け用。 */
  configStatus?: Record<string, boolean>
}

/**
 * Supabaseのログイン状態。
 * 接続情報を実行時に取りに行くため、クライアントの生成自体が非同期になる。
 *
 * onAuthStateChange は購読した瞬間に現在のセッション(INITIAL_SESSION)も流してくるので、
 * getSession() を別途呼ぶと二重初期化になる。購読だけに任せる。
 */
export function useSupabaseAuth(): AuthState {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [configured, setConfigured] = useState(false)
  const [configStatus, setConfigStatus] = useState<Record<string, boolean>>()

  useEffect(() => {
    let cancelled = false
    let unsubscribe: (() => void) | undefined

    void (async () => {
      const client = await getSupabase()
      if (cancelled) return

      setConfigStatus(getConfigStatus())
      if (!client) {
        setConfigured(false)
        setLoading(false)
        return
      }
      setConfigured(true)

      const { data } = client.auth.onAuthStateChange((_event, nextSession) => {
        setSession(nextSession)
        setLoading(false)
      })
      unsubscribe = () => data.subscription.unsubscribe()
    })()

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [])

  return { session, loading, configured, configStatus }
}

export async function signInWithGoogle(): Promise<void> {
  const client = await getSupabase()
  if (!client) throw new Error('Supabaseが設定されていません')
  const { error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  })
  if (error) throw new Error(`ログインに失敗しました: ${error.message}`)
}

export async function signOut(): Promise<void> {
  const client = await getSupabase()
  await client?.auth.signOut()
}

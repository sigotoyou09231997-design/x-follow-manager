import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

export interface AuthState {
  session: Session | null
  loading: boolean
}

/**
 * Supabaseのログイン状態。
 * onAuthStateChange は購読した瞬間に現在のセッション(INITIAL_SESSION)も流してくるので、
 * getSession() を別途呼ぶと二重初期化になる。購読だけに任せる。
 */
export function useSupabaseAuth(): AuthState {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setLoading(false)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  return { session, loading }
}

export async function signInWithGoogle(): Promise<void> {
  if (!supabase) throw new Error('Supabaseが設定されていません')
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  })
  if (error) throw new Error(`ログインに失敗しました: ${error.message}`)
}

export async function signOut(): Promise<void> {
  if (!supabase) return
  await supabase.auth.signOut()
}

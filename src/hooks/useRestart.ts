import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchRestart, requestRestart, type RestartState } from '../lib/autopost/api'

interface State {
  restart?: RestartState
  /** 依頼を送っている最中。 */
  busy: boolean
  error?: string
  /** 投稿役の再起動を依頼する。 */
  request: () => Promise<void>
}

/** 依頼中は、Mac が受け取って結果を書き戻すのをすぐ知らせたいので短く、普段は長く。 */
const POLL_PENDING_MS = 5_000
const POLL_IDLE_MS = 30_000

/** 投稿役の再起動の依頼の状態。開いている間は定期的に取り直して、Mac が処理した結果を画面に出す。 */
export function useRestart(enabled: boolean): State {
  const [restart, setRestart] = useState<RestartState>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  // 古い返事が新しい返事を上書きしないように、最後に出した要求だけを採用する
  const latest = useRef(0)

  const reload = useCallback(async () => {
    if (!enabled) return
    const mine = ++latest.current
    try {
      const next = await fetchRestart()
      if (mine !== latest.current) return
      setRestart(next)
    } catch {
      // 状態を読めなかっただけ。依頼のボタンは前の状態のまま使えるようにして、次の取り直しを待つ
    }
  }, [enabled])

  useEffect(() => {
    void reload()
  }, [reload])

  const pending = !!restart?.ready && !!restart.requestedAt && !restart.handledAt
  useEffect(() => {
    if (!enabled) return
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void reload()
    }, pending ? POLL_PENDING_MS : POLL_IDLE_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void reload()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled, pending, reload])

  const request = useCallback(async () => {
    setBusy(true)
    setError(undefined)
    try {
      const next = await requestRestart()
      // 依頼の返事のほうが新しいので、飛んでいる読み込みの返事は捨てる
      latest.current++
      setRestart(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [])

  return { restart, busy, error, request }
}

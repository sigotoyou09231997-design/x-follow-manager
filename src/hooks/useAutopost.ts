import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchSnapshots, type ChannelSnapshot, type Snapshots } from '../lib/autopost/api'

interface State {
  snapshots?: Snapshots
  loading: boolean
  error?: string
  reload: () => Promise<void>
  /** 保存の返事（や取り合いで分かった最新）を、次の読み込みを待たずに取り込む。 */
  applySnapshot: (snapshot: ChannelSnapshot) => void
}

const POLL_MS = 15_000

/**
 * 掲示板・Yay の自動投稿の文と状態。開いている間は定期的に取り直して、
 * 別の端末での保存や、Mac の「動いています」の報告に画面を合わせる。
 */
export function useAutopost(enabled: boolean): State {
  const [snapshots, setSnapshots] = useState<Snapshots>()
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string>()
  // 古い返事が新しい返事を上書きしないように、最後に出した要求だけを採用する。
  const latest = useRef(0)

  const reload = useCallback(async () => {
    if (!enabled) return
    const mine = ++latest.current
    try {
      const next = await fetchSnapshots()
      if (mine !== latest.current) return
      setSnapshots(next)
      setError(undefined)
    } catch (err) {
      if (mine !== latest.current) return
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (mine === latest.current) setLoading(false)
    }
  }, [enabled])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    if (!enabled) return
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void reload()
    }, POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void reload()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled, reload])

  const applySnapshot = useCallback((snapshot: ChannelSnapshot) => {
    // 保存の返事のほうが新しいので、飛んでいる読み込みの返事は捨てる。
    latest.current++
    setSnapshots((prev) => (prev ? { ...prev, [snapshot.channel]: snapshot } : prev))
  }, [])

  return { snapshots, loading, error, reload, applySnapshot }
}

import { useCallback, useEffect, useState } from 'react'
import { fetchScheduledPosts, fetchXAccountStatus, summarize } from '../lib/schedule/postsStore'
import type { ScheduledPost, ScheduleSummary, XAccountStatus } from '../lib/schedule/types'

interface State {
  posts: ScheduledPost[]
  summary: ScheduleSummary
  xAccount?: XAccountStatus
  loading: boolean
  error?: string
  reload: () => Promise<void>
}

const EMPTY_SUMMARY: ScheduleSummary = {
  draft: 0,
  scheduled: 0,
  posted: 0,
  failed: 0,
  repeating: 0,
  dueToday: 0,
}

export function useScheduledPosts(enabled: boolean): State {
  const [posts, setPosts] = useState<ScheduledPost[]>([])
  const [xAccount, setXAccount] = useState<XAccountStatus>()
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string>()

  const reload = useCallback(async () => {
    if (!enabled) return
    setLoading(true)
    setError(undefined)
    try {
      const [nextPosts, account] = await Promise.all([fetchScheduledPosts(), fetchXAccountStatus()])
      setPosts(nextPosts)
      setXAccount(account)
    } catch (err) {
      // 握りつぶすと「なぜか予約が出てこない」だけの無言の失敗になるので必ず表に出す。
      console.error('useScheduledPosts reload failed:', err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [enabled])

  useEffect(() => {
    void reload()
  }, [reload])

  // 投稿予定時刻を過ぎた予約はサーバー側で処理されるため、開いている間は
  // 定期的に取り直して「投稿済み」への変化を反映する。
  useEffect(() => {
    if (!enabled) return
    const timer = setInterval(() => void reload(), 60_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void reload()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled, reload])

  return {
    posts,
    summary: enabled ? summarize(posts) : EMPTY_SUMMARY,
    xAccount,
    loading,
    error,
    reload,
  }
}

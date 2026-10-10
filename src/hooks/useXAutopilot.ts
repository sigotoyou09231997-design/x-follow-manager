import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchAutopilot, XAutopilotError, type ActionReply } from '../lib/xAutopilot/api'
import type { AutopilotState } from '../lib/xAutopilot/types'

interface State {
  state?: AutopilotState
  loading: boolean
  error?: string
  /** 保存先の表（SQL 007）がまだ無い。 */
  setupNeeded: boolean
  /** いま実行中の操作の名前。同時に複数は走らせない（費用が出る操作が多いため）。 */
  busy: string | null
  reload: () => Promise<void>
  /** 操作を1つ実行し、返ってきた状態を取り込む。失敗は例外のまま呼び出し側へ。 */
  run: (label: string, action: () => Promise<ActionReply>) => Promise<ActionReply>
}

const POLL_MS = 30_000

/**
 * X の自動運転の状態。開いている間は定期的に取り直して、毎分の補充による予約の増加や、
 * 補充を止めた理由（lastError）・今月の使用額の変化に画面を合わせる。
 */
export function useXAutopilot(enabled: boolean): State {
  const [state, setState] = useState<AutopilotState>()
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string>()
  const [setupNeeded, setSetupNeeded] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  // 操作の返事が、飛んでいる読み込みの古い返事に上書きされないようにする。
  const latest = useRef(0)
  const busyRef = useRef<string | null>(null)

  const reload = useCallback(async () => {
    if (!enabled) return
    const mine = ++latest.current
    try {
      const reply = await fetchAutopilot()
      if (mine !== latest.current) return
      setState(reply.state)
      setError(undefined)
      setSetupNeeded(false)
    } catch (err) {
      if (mine !== latest.current) return
      if (err instanceof XAutopilotError && err.setup) setSetupNeeded(true)
      else setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (mine === latest.current) setLoading(false)
    }
  }, [enabled])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    if (!enabled) return
    const tick = () => {
      // 操作の最中に取り直すと、操作前の状態で画面が一瞬戻る。
      if (document.visibilityState === 'visible' && !busyRef.current) void reload()
    }
    const timer = setInterval(tick, POLL_MS)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [enabled, reload])

  const run = useCallback(async (label: string, action: () => Promise<ActionReply>) => {
    if (busyRef.current) throw new XAutopilotError('ほかの操作を実行中です。終わるまでお待ちください', 409)
    busyRef.current = label
    setBusy(label)
    try {
      const reply = await action()
      // 返事のほうが新しいので、飛んでいる読み込みの返事は捨てる。
      latest.current++
      setState(reply.state)
      setError(undefined)
      return reply
    } catch (err) {
      if (err instanceof XAutopilotError && err.setup) setSetupNeeded(true)
      throw err
    } finally {
      busyRef.current = null
      setBusy(null)
    }
  }, [])

  return { state, loading, error, setupNeeded, busy, reload, run }
}

import { useEffect, useState } from 'react'

/** 今の時刻。「◯分前」の表示を、開いたままでも古くしないための時計。 */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

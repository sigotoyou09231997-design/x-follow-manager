import { useCallback, useEffect, useState } from 'react'

// トップの「すべて止める／すべて再開」が、X・ディスコード・Yay のどれを動かすか。設定で1つずつ切り替える。
// この端末のブラウザに覚える（アカウントや Mac の投稿役には関係しない、押したときの対象を決めるだけの設定のため）。

export type BulkTarget = 'x' | 'discord' | 'yay'

export const BULK_TARGETS: BulkTarget[] = ['x', 'discord', 'yay']

export const BULK_TARGET_LABELS: Record<BulkTarget, string> = { x: 'X', discord: 'ディスコード', yay: 'Yay' }

export type BulkTargetSettings = Record<BulkTarget, boolean>

const STORAGE_KEY = 'sns-all-pause-targets'
const CHANGED = 'sns-all-pause-targets-changed'

/** 何も決めていなければ、3つとも対象（「すべて」止める、の名前どおり）。 */
export const DEFAULT_BULK_TARGETS: BulkTargetSettings = { x: true, discord: true, yay: true }

export function readBulkTargets(): BulkTargetSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Record<BulkTarget, unknown>> | null
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_BULK_TARGETS }
    // 書かれていない・壊れた値は「対象」のままにする（押しても何も動かない、を黙って作らない）。
    return {
      x: raw.x !== false,
      discord: raw.discord !== false,
      yay: raw.yay !== false,
    }
  } catch {
    return { ...DEFAULT_BULK_TARGETS }
  }
}

export function writeBulkTargets(next: BulkTargetSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // 覚えられなくても、この画面の間は切り替えが効く
  }
  window.dispatchEvent(new Event(CHANGED))
}

/** 対象の設定と、1つを切り替える関数。ほかの画面・タブで変えても追いかける。 */
export function useBulkTargets(): [BulkTargetSettings, (target: BulkTarget, on: boolean) => void] {
  const [targets, setTargets] = useState<BulkTargetSettings>(readBulkTargets)

  useEffect(() => {
    const sync = () => setTargets(readBulkTargets())
    window.addEventListener(CHANGED, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(CHANGED, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const set = useCallback((target: BulkTarget, on: boolean) => {
    writeBulkTargets({ ...readBulkTargets(), [target]: on })
  }, [])

  return [targets, set]
}

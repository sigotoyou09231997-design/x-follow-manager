import { useCallback, useEffect, useState } from 'react'

// 投稿先（X・ディスコード・Yay）ごとのオンオフの設定。設定の画面で1つずつ切り替える。2つある:
//   - 「まとめて止める・再開の対象」… トップの「すべて止める／すべて再開」が、どれを動かすか
//   - 「トップに出す投稿先」       … トップに出すか（使っていない投稿先を隠す。隠したものは、まとめて止める・再開でも動かさない）
// どちらもこの端末のブラウザに覚える（アカウントや Mac の投稿役には関係しない、画面の出し方と押したときの対象を決めるだけの設定のため）。

export type BulkTarget = 'x' | 'discord' | 'yay'

export const BULK_TARGETS: BulkTarget[] = ['x', 'discord', 'yay']

export const BULK_TARGET_LABELS: Record<BulkTarget, string> = { x: 'X', discord: 'ディスコード', yay: 'Yay' }

export type BulkTargetSettings = Record<BulkTarget, boolean>

/** 何も決めていなければ、3つともオン（「すべて」止める・ふだんどおり全部出す）。 */
export const DEFAULT_BULK_TARGETS: BulkTargetSettings = { x: true, discord: true, yay: true }

function targetSetting(storageKey: string) {
  const changed = `${storageKey}-changed`

  function read(): BulkTargetSettings {
    try {
      const raw = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as Partial<Record<BulkTarget, unknown>> | null
      if (!raw || typeof raw !== 'object') return { ...DEFAULT_BULK_TARGETS }
      // 書かれていない・壊れた値はオンのままにする（押しても何も動かない・何も出ない、を黙って作らない）。
      return { x: raw.x !== false, discord: raw.discord !== false, yay: raw.yay !== false }
    } catch {
      return { ...DEFAULT_BULK_TARGETS }
    }
  }

  function write(next: BulkTargetSettings) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(next))
    } catch {
      // 覚えられなくても、この画面の間は切り替えが効く
    }
    window.dispatchEvent(new Event(changed))
  }

  /** 設定と、1つを切り替える関数。ほかの画面・タブで変えても追いかける。 */
  function useSetting(): [BulkTargetSettings, (target: BulkTarget, on: boolean) => void] {
    const [value, setValue] = useState<BulkTargetSettings>(read)
    useEffect(() => {
      const sync = () => setValue(read())
      window.addEventListener(changed, sync)
      window.addEventListener('storage', sync)
      return () => {
        window.removeEventListener(changed, sync)
        window.removeEventListener('storage', sync)
      }
    }, [])
    const set = useCallback((target: BulkTarget, on: boolean) => write({ ...read(), [target]: on }), [])
    return [value, set]
  }

  return { read, write, useSetting }
}

const bulk = targetSetting('sns-all-pause-targets')
export const readBulkTargets = bulk.read
export const writeBulkTargets = bulk.write
/** 「すべて止める／すべて再開」の対象。 */
export const useBulkTargets = bulk.useSetting

const shown = targetSetting('sns-top-shown')
export const readTopShown = shown.read
/** トップに出す投稿先。オフにしたものはトップに出さず、まとめて止める・再開でも動かさない。 */
export const useTopShown = shown.useSetting

// Service Workerの登録はReactの外（main.tsx）で行うため、その結果を画面へ伝えるための
// 小さな受け渡し役。ここ自体はブラウザAPIに触らないので、Artifact版に混ざっても害はない
// （更新が来たと伝える者がいないので、バナーは一生出ない）。

type Listener = () => void

let updateAvailable = false
let applyFn: ((reloadPage?: boolean) => Promise<void>) | null = null
const listeners = new Set<Listener>()

/** main.tsx が registerSW() の戻り値を1度だけ渡す。 */
export function setUpdateApplier(fn: (reloadPage?: boolean) => Promise<void>): void {
  applyFn = fn
}

/** main.tsx の onNeedRefresh から呼ぶ。新しいService Workerが待機に入った合図。 */
export function markUpdateAvailable(): void {
  if (updateAvailable) return
  updateAvailable = true
  listeners.forEach((listener) => listener())
}

/** 購読時点ですでに更新が来ていれば、その場で1回だけ発火する。 */
export function subscribeUpdateAvailable(listener: Listener): () => void {
  listeners.add(listener)
  if (updateAvailable) listener()
  return () => {
    listeners.delete(listener)
  }
}

/**
 * 待機中のService Workerに交代を指示し、切り替わったらページを読み込み直す。
 * 読み込み直し自体は更新検知時に仕掛けた controllerchange 由来で起きるが、
 * 短時間に複数回デプロイされた場合など、必ず発火するとは限らない。
 * バナーが出たまま固まらないよう、少し遅れて自前でもリロードする
 * （本来のリロードが先に走っていれば、こちらは何もしないまま終わる）。
 */
export async function applyUpdate(): Promise<void> {
  if (applyFn) await applyFn(true)
  if (typeof window === 'undefined') return
  window.setTimeout(() => {
    try {
      window.location.reload()
    } catch {
      // テスト環境などリロードが実装されていない場合は何もしない
    }
  }, 2000)
}

/** テスト用。モジュールスコープの状態を初期化する。 */
export function resetUpdateStateForTest(): void {
  updateAvailable = false
  applyFn = null
  listeners.clear()
}

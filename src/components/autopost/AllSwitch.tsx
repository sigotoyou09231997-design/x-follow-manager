import { useState } from 'react'
import { optimisticPause } from '../../lib/autopost/draft'
import { useBulkTargets, useTopShown } from '../../lib/autopost/bulkTargets'
import { Icon } from '../Icon'
import { CHANNEL_LABELS, CHANNEL_NAMES, presentChannels, setPaused, type ChannelName, type ChannelSnapshot, type Snapshots } from '../../lib/autopost/api'

// トップの「すべての投稿を止める／再開する」。X の自動運転・ディスコード・Yay を、1回の操作でまとめて止める・戻す。
// 個々の行のスイッチと同じ操作（X は止める／始める、ディスコード・Yay は setPaused）を並べて呼ぶだけで、新しいサーバー処理は無い。

type Target = 'x' | ChannelName

const TARGET_LABELS: Record<Target, string> = { x: 'X', ...CHANNEL_LABELS }

/** 「すべて止める」で実際に止めたものを覚えておく。再開で、もともと止めてあったものまで動かさないため。 */
const STORAGE_KEY = 'sns-all-pause-stopped'

function readStopped(): Target[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(raw)
      ? raw.filter((t): t is Target => t === 'x' || t === 'discord' || t === 'yay' || t === 'xrepeat')
      : []
  } catch {
    return []
  }
}

function writeStopped(targets: Target[]) {
  try {
    if (targets.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(targets))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // 記憶できなくても、止める・再開するは動く（再開は、止まっている投稿先だけを戻す形になる）
  }
}

export interface XControls {
  enabled: boolean
  /** Xとの連携と文体のまとめが済んでいて、自動運転を始められる。 */
  ready: boolean
  /** 失敗したら理由の文字列を返す。 */
  stop: () => Promise<string | undefined>
  start: () => Promise<string | undefined>
}

interface Props {
  x: XControls
  /** ディスコード・Yay の状態。読み込めていないときは null（その2つは対象にしない）。 */
  snapshots: Snapshots | null
  onChanged: (snapshot: ChannelSnapshot) => void
}

type Notice = { kind: 'ok' | 'err'; text: string }

const errorOf = (err: unknown) => (err instanceof Error ? err.message : String(err))

export function AllSwitch({ x, snapshots, onChanged }: Props) {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>()
  // 設定で外した投稿先には、止めるも再開も触らない。
  // トップに出していない投稿先（設定の「トップに出す投稿先」で外したもの）も、使っていないものとして触らない。
  const [bulk] = useBulkTargets()
  const [shown] = useTopShown()
  const included = {
    x: bulk.x && shown.x,
    discord: bulk.discord && shown.discord,
    yay: bulk.yay && shown.yay,
    xrepeat: bulk.xrepeat && shown.xrepeat,
  }

  // 返事に無い投稿先（xrepeat より前のサーバー）は、無いものとして扱う
  const channels = snapshots ? presentChannels(snapshots).filter((name) => snapshots[name]!.pauseReady) : []
  const targetChannels = channels.filter((name) => included[name])
  const runningChannels = targetChannels.filter((name) => !snapshots![name]!.paused)
  const pausedChannels = targetChannels.filter((name) => snapshots![name]!.paused)

  const running: Target[] = [...(x.enabled && included.x ? (['x'] as const) : []), ...runningChannels]
  const mode: 'stop' | 'resume' = running.length > 0 ? 'stop' : 'resume'

  // 再開するもの: 「すべて止める」で止めたもののうち、いま止まっているもの。覚えが無ければ、止まっている投稿先だけ
  // （X は始めると予約が作り直されて AI の費用がかかるので、止めたのが「すべて止める」だと分からないときは勝手に始めない）。
  const remembered = readStopped()
  const resumeTargets: Target[] =
    remembered.length > 0
      ? remembered.filter((t) => (t === 'x' ? included.x && !x.enabled : pausedChannels.includes(t)))
      : pausedChannels
  // 返事に無い投稿先（xrepeat より前のサーバー）は、選ばれていても動かせないので数えない
  const noneSelected = !included.x && (snapshots ? presentChannels(snapshots) : CHANNEL_NAMES).every((name) => !included[name])
  const nothingToDo = mode === 'resume' && resumeTargets.length === 0
  // 止められるものが何も読めていない（Xは読み込み済みで止まり、投稿先の保存先も無い）ときは、何も出さない。
  if (nothingToDo && channels.length === 0) return null

  async function perform(targets: Target[], pause: boolean): Promise<{ done: Target[]; failed: string[] }> {
    const results = await Promise.all(
      targets.map(async (target): Promise<{ target: Target; error?: string }> => {
        try {
          if (target === 'x') {
            if (!pause && !x.ready) return { target, error: 'Xとの連携と文体のまとめがまだです' }
            const error = await (pause ? x.stop() : x.start())
            return error ? { target, error } : { target }
          }
          // ディスコード・Yay は、返事を待たずに切り替えて見せる。失敗したら押す前に戻す。
          const before = snapshots?.[target]
          if (before) onChanged(optimisticPause(before, pause, new Date()))
          try {
            onChanged(await setPaused(target, pause))
          } catch (err) {
            if (before) onChanged(before)
            throw err
          }
          return { target }
        } catch (err) {
          return { target, error: errorOf(err) }
        }
      })
    )
    return {
      done: results.filter((r) => !r.error).map((r) => r.target),
      failed: results.filter((r) => r.error).map((r) => `${TARGET_LABELS[r.target]}: ${r.error}`),
    }
  }

  async function change() {
    if (busy || nothingToDo) return
    setBusy(true)
    setNotice(undefined)
    try {
      const pause = mode === 'stop'
      const { done, failed } = await perform(pause ? running : resumeTargets, pause)
      if (pause) writeStopped(done)
      else writeStopped(remembered.filter((t) => !done.includes(t) && resumeTargets.includes(t)))
      const names = done.map((t) => TARGET_LABELS[t]).join('・')
      if (failed.length > 0) {
        setNotice({
          kind: 'err',
          text: `${done.length > 0 ? `${names} は${pause ? '止めました' : '再開しました'}。` : ''}できなかったもの → ${failed.join(' / ')}`,
        })
      } else {
        setNotice({ kind: 'ok', text: `${names} を${pause ? '止めました' : '再開しました'}` })
      }
    } finally {
      setBusy(false)
    }
  }

  const xNote =
    mode === 'stop' && running.includes('x')
      ? 'X のまだ出ていない予約は取り消されます（再開で作り直し）'
      : mode === 'resume' && resumeTargets.includes('x')
        ? 'X は予約を作り直すので、並ぶまで数分かかります'
        : null

  // 見出しは、いまの状態をひとことで。対象が全部動いていれば「すべて動いています」、一部なら名前を並べる。
  const targetCount = (included.x ? 1 : 0) + targetChannels.length
  const headline =
    mode === 'stop'
      ? running.length === targetCount
        ? 'すべて動いています'
        : `${running.map((t) => TARGET_LABELS[t]).join('・')} が動いています`
      : noneSelected
        ? '対象が選ばれていません'
        : nothingToDo
          ? '再開できるものはありません'
          : 'すべて止まっています'

  return (
    <section className={`all-switch all-switch--${mode}`} aria-label="すべての自動投稿">
      <div className="all-switch__text">
        <span className="all-switch__eyebrow">
          <span className="all-switch__pulse" aria-hidden="true" />
          すべての自動投稿
        </span>
        <strong className="all-switch__headline">{headline}</strong>
        {noneSelected && <span className="all-switch__note">設定の「まとめて止める・再開の対象」で選べます</span>}
        {xNote && <span className="all-switch__note">{xNote}</span>}
        {notice && (
          <span className={`all-switch__result all-switch__result--${notice.kind}`} role={notice.kind === 'err' ? 'alert' : 'status'}>
            {notice.text}
          </span>
        )}
      </div>
      <button
        type="button"
        className="all-switch__button"
        onClick={() => void change()}
        disabled={busy || nothingToDo}
        aria-label={mode === 'stop' ? 'すべての自動投稿を止める' : 'すべての自動投稿を再開する'}
      >
        <Icon name={mode === 'stop' ? 'pause' : 'play'} size={18} />
        {busy ? '送信中…' : mode === 'stop' ? 'すべて止める' : 'すべて再開'}
      </button>
    </section>
  )
}

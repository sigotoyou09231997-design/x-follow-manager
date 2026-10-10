import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import './autopost.css'
import { signInWithGoogle, signOut, useSupabaseAuth } from '../../hooks/useSupabaseAuth'
import { useAutopost } from '../../hooks/useAutopost'
import { registerEditingGuard } from '../../lib/editingGuard'
import {
  CHANNEL_NAMES,
  SaveConflictError,
  saveMessages,
  setPaused,
  type ChannelName,
  type ChannelSnapshot,
} from '../../lib/autopost/api'
import {
  agoLabel,
  flat,
  isDirty,
  isValid,
  livenessOf,
  normalize,
  notYetPosted,
  pauseStateOf,
  withArchived,
} from '../../lib/autopost/draft'
import { readAutopostTab, rememberAutopostTab, type AutopostTab } from '../../lib/autopost/tab'
import { Icon } from '../Icon'
import { XAutopilotPanel } from './XAutopilotPanel'

const CHANNEL_LABELS: Record<ChannelName, string> = { discord: 'ディスコード', yay: 'Yay' }

const CHANNEL_INFO: Record<ChannelName, string> = {
  discord: 'discord-ch.site の募集掲示板に、約10分おきに投稿される文です。',
  yay: 'Yay のタイムラインと、参加中のサークル全部に、5分ごとに投稿される文です（前の投稿は消されます）。',
}

/** 書きかけ。見ていた版を覚えておき、サーバー側が進んで中身も同じになったら、書きかけを手放して追従する。 */
interface Edit {
  list: string[]
  base: number
}

function without(edits: Partial<Record<ChannelName, Edit>>, channel: ChannelName) {
  const next = { ...edits }
  delete next[channel]
  return next
}

/** 今の時刻。「◯分前」の表示を、開いたままでも古くしないための時計。 */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

function AutoTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(132, el.scrollHeight + 2)}px`
  }, [props.value])
  return <textarea ref={ref} {...props} />
}

export function AutoPostView() {
  const { session, loading: authLoading, configured } = useSupabaseAuth()
  const loggedIn = !!session
  const { snapshots, loading, error, reload, applySnapshot } = useAutopost(loggedIn)
  const now = useNow(30_000)

  const [tab, setTab] = useState<AutopostTab>(readAutopostTab)
  // X のタブを開いているあいだも、ディスコード・Yay の書きかけや状態は持ち続ける。
  // その土台になる「ディスコード・Yay のうち、いま見ている投稿先」（X のときは直前の続きとして先頭を使う）。
  const current: ChannelName = tab === 'x' ? 'discord' : tab
  const [edits, setEdits] = useState<Partial<Record<ChannelName, Edit>>>({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ text: string; kind: 'ok' | 'err' }>()
  const [pauseBusy, setPauseBusy] = useState(false)
  const [pauseError, setPauseError] = useState<string>()

  // 書きかけ（＝その投稿先の文が、保存済みと違う状態）かどうかを、投稿先ごとに出す。
  const draftOf = (channel: ChannelName): string[] => {
    const snap = snapshots?.[channel]
    if (!snap) return []
    const edit = edits[channel]
    if (!edit) return snap.messages
    // サーバー側が進んでいて、書きかけも同じ中身に戻っているなら、書きかけは手放す。
    const follow = edit.base !== snap.version && !isDirty(edit.list, snap.messages)
    return follow ? snap.messages : edit.list
  }
  const dirtyOf = (channel: ChannelName): boolean => {
    const snap = snapshots?.[channel]
    return !!snap && isDirty(draftOf(channel), snap.messages)
  }
  const anyDirty = CHANNEL_NAMES.some(dirtyOf)

  // 更新バナーが、書きかけのまま画面を読み込み直さないよう申告しておく。
  const anyDirtyRef = useRef(anyDirty)
  anyDirtyRef.current = anyDirty
  useEffect(() => registerEditingGuard(() => anyDirtyRef.current), [])

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!anyDirtyRef.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  const snap = snapshots?.[current]
  const draft = draftOf(current)
  const dirty = dirtyOf(current)
  const valid = !!snap && isValid(draft, snap.limits.maxLength)

  function setDraft(list: string[]) {
    if (!snap) return
    setEdits((prev) => ({ ...prev, [current]: { list, base: snap.version } }))
  }

  function selectChannel(name: AutopostTab) {
    setTab(name)
    setMessage(undefined)
    setPauseError(undefined)
    rememberAutopostTab(name)
  }

  // 止める／再開する。押したあとの表示は、サーバーの返事（と、のちの Mac の報告）に合わせる。
  async function changePaused(next: boolean) {
    if (!snap || pauseBusy) return
    setPauseBusy(true)
    setPauseError(undefined)
    try {
      applySnapshot(await setPaused(current, next))
    } catch (err) {
      setPauseError(err instanceof Error ? err.message : String(err))
    } finally {
      setPauseBusy(false)
    }
  }

  async function save() {
    // X のタブを見ているときの Cmd+S で、見えていないディスコードの書きかけを保存してしまわない。
    if (tab === 'x') return
    if (!snap || !dirty || !valid || saving) return
    const channel = current
    const sent = JSON.stringify(normalize(draft))
    setSaving(true)
    setMessage(undefined)
    try {
      const next = await saveMessages(channel, draft, snap.version)
      applySnapshot(next)
      // 返事を待つあいだに打ち足されていたら、その入力は消さない。
      setEdits((prev) => {
        const live = prev[channel]
        if (live && JSON.stringify(normalize(live.list)) !== sent) return prev
        return without(prev, channel)
      })
      setMessage({ text: '保存しました（次の投稿から反映されます）', kind: 'ok' })
    } catch (err) {
      if (err instanceof SaveConflictError) applySnapshot(err.snapshot) // 書いた内容は消さず、最新だけ取り込む
      setMessage({ text: err instanceof Error ? err.message : String(err), kind: 'err' })
    } finally {
      setSaving(false)
    }
  }

  // 保存の入れ物を最新に保って、キーボードのショートカットから呼べるようにする。
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 's') {
        event.preventDefault()
        void saveRef.current()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (message?.kind !== 'ok') return
    const timer = setTimeout(() => setMessage(undefined), 6000)
    return () => clearTimeout(timer)
  }, [message])

  const archive = useMemo(() => snap?.archive ?? [], [snap])

  // 見出しとタブは、ディスコード・Yay・X のどれを見ているときも同じ。
  const head = (
    <header className="autopost__head">
      <div>
        <p className="overline">AUTO POST</p>
        <h1 className="autopost__title">{tab === 'x' ? 'Xの自動運転' : '投稿する文'}</h1>
      </div>
      <button type="button" className="btn btn--ghost btn--small" onClick={() => void signOut()} aria-label="ログアウト">
        <Icon name="logout" size={16} />
      </button>
    </header>
  )
  const tabs = (
    <div className="autopost__tabs" role="tablist" aria-label="投稿先">
      {CHANNEL_NAMES.map((name) => (
        <button
          key={name}
          type="button"
          role="tab"
          aria-selected={tab === name}
          className={`autopost__tab${tab === name ? ' active' : ''}`}
          onClick={() => selectChannel(name)}
        >
          {CHANNEL_LABELS[name]}
          {snapshots?.[name]?.paused && <span className="autopost__tab-flag">停止中</span>}
          {dirtyOf(name) && <span className="autopost__dirty" aria-label="未保存の変更あり">●</span>}
        </button>
      ))}
      <button
        type="button"
        role="tab"
        aria-selected={tab === 'x'}
        className={`autopost__tab${tab === 'x' ? ' active' : ''}`}
        onClick={() => selectChannel('x')}
      >
        X
      </button>
    </div>
  )

  if (authLoading) return <p className="loading-indicator">読み込み中…</p>

  if (!configured) {
    return (
      <div className="autopost autopost--notice">
        <p>接続情報を取得できませんでした。予約投稿と同じく、サーバーの環境変数 <code>SUPABASE_URL</code> を確認してください。</p>
      </div>
    )
  }

  if (!loggedIn) {
    return (
      <div className="autopost autopost--notice">
        <p>自動投稿の文を変えるにはログインしてください。</p>
        <button type="button" className="btn btn--primary" onClick={() => void signInWithGoogle()}>
          Googleでログイン
        </button>
      </div>
    )
  }

  // X の自動運転は、ディスコード・Yay の保存先（SQL 005）とは別。そちらが読めなくても使えるよう、先に分ける。
  if (tab === 'x') {
    return (
      <div className="autopost">
        {head}
        {tabs}
        <XAutopilotPanel />
      </div>
    )
  }

  if (error && !snapshots) {
    // 保存先の表（SQL 005）をまだ作っていないと、読み込みはここで必ず失敗する。
    const needsSetup = error.includes('autopost_')
    return (
      // タブは出しておく（X の自動運転は、ここで読めなかった保存先とは別なので、そちらへは行ける）。
      <div className="autopost">
        {head}
        {tabs}
        <div className="surface-card autopost--notice">
          <p>{needsSetup ? '自動投稿の保存先がまだ用意されていません。' : '自動投稿の読み込みに失敗しました。'}</p>
          <p className="autopost__hint">
            {needsSetup
              ? 'Supabase の SQL Editor で supabase/sql/005_autopost.sql を実行すると使えるようになります。'
              : error}
          </p>
          <button type="button" className="btn btn--ghost" onClick={() => void reload()}>
            <Icon name="refresh" size={16} />
            もう一度ためす
          </button>
        </div>
      </div>
    )
  }

  if (loading || !snap) return <p className="loading-indicator">読み込み中…</p>

  return (
    <div className="autopost">
      {head}
      {tabs}

      <p className="autopost__info">{CHANNEL_INFO[current]}</p>
      <PosterStatusLine snapshot={snap} now={now} />
      <PauseControl
        snapshot={snap}
        now={now}
        busy={pauseBusy}
        error={pauseError}
        onChange={(next) => void changePaused(next)}
      />

      <section className="surface-card autopost__card">
        {draft.length === 0 ? (
          // 保存済みの文が1つも無い投稿先。空の欄をひとつ出しておく。
          <Box
            index={0}
            total={1}
            value=""
            maxLength={snap.limits.maxLength}
            onChange={(v) => setDraft([v])}
            onRemove={() => undefined}
          />
        ) : (
          draft.map((text, i) => (
            <Box
              key={i}
              index={i}
              total={draft.length}
              value={text}
              maxLength={snap.limits.maxLength}
              onChange={(v) => setDraft(draft.map((t, j) => (j === i ? v : t)))}
              onRemove={() => setDraft(draft.filter((_, j) => j !== i))}
            />
          ))
        )}

        <div className="autopost__actions">
          <button type="button" className="btn btn--primary" onClick={() => void save()} disabled={!dirty || !valid || saving}>
            {saving ? '保存しています…' : '保存する'}
          </button>
          {dirty && (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                setEdits((prev) => without(prev, current))
                setMessage(undefined)
              }}
            >
              変更を取り消す
            </button>
          )}
          {snap.limits.maxMessages > 1 && draft.length < snap.limits.maxMessages && (
            <button type="button" className="btn btn--ghost" onClick={() => setDraft([...(draft.length ? draft : ['']), ''])}>
              <Icon name="plus" size={16} />
              順番に回す文を追加
            </button>
          )}
        </div>

        <p className="autopost__note">
          {snap.paused ? (
            dirty ? (
              <>保存すると、<strong>再開したあとの投稿から</strong>この文になります（いまは停止中です）。</>
            ) : (
              <>いまは停止中です。再開すると、保存済みの文が<strong>次の投稿から</strong>使われます。</>
            )
          ) : dirty ? (
            <>保存すると、<strong>次の投稿から</strong>この文になります。</>
          ) : notYetPosted(snap) ? (
            <>保存済みの文は、<strong>次の投稿から</strong>使われます（まだ投稿されていません）。</>
          ) : (
            'いま投稿されている文です。直して保存すると、次の投稿から切り替わります。'
          )}
        </p>
        {message && (
          <p className={`autopost__msg autopost__msg--${message.kind}`} role={message.kind === 'err' ? 'alert' : 'status'}>
            {message.text}
          </p>
        )}
      </section>

      <h2 className="autopost__sub">これまでの文</h2>
      {archive.length === 0 ? (
        <p className="autopost__empty">まだありません。文を変えて保存すると、前の文がここに残ります。</p>
      ) : (
        <ul className="autopost__history">
          {archive.map((text) => (
            <li key={text}>
              <span className="autopost__history-text">{flat(text)}</span>
              <button
                type="button"
                className="btn btn--ghost btn--small"
                onClick={() => {
                  setDraft(withArchived(draft, text, snap.limits.maxMessages))
                  setMessage({ text: '書き換えました。まだ保存はしていません。', kind: 'ok' })
                  window.scrollTo({ top: 0, behavior: 'smooth' })
                }}
              >
                この文にする
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

interface BoxProps {
  index: number
  total: number
  value: string
  maxLength: number
  onChange: (value: string) => void
  onRemove: () => void
}

function Box({ index, total, value, maxLength, onChange, onRemove }: BoxProps) {
  const length = value.trim().length
  return (
    <div className="autopost__box">
      {total > 1 && (
        <div className="autopost__box-head">
          <span>{index + 1}つ目</span>
          <button type="button" className="btn btn--ghost btn--small" onClick={onRemove}>
            この文を外す
          </button>
        </div>
      )}
      <AutoTextarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={total > 1 ? `${index + 1}つ目の文` : '投稿する文'}
        placeholder="ここに投稿する文を書きます"
      />
      <div className={`autopost__count${length > maxLength ? ' over' : ''}`}>{length}文字</div>
    </div>
  )
}

function PosterStatusLine({ snapshot, now }: { snapshot: ChannelSnapshot; now: number }) {
  const { status } = snapshot
  const liveness = livenessOf(status, now)
  if (!status) {
    return <p className="autopost__status">投稿側(Mac)からの報告はまだありません</p>
  }
  const last = status.lastPost
  return (
    <p className="autopost__status">
      <span className="autopost__live">
        <span className={`autopost__dot autopost__dot--${liveness === 'alive' ? 'on' : 'off'}`} aria-hidden="true" />
        {liveness === 'alive'
          ? `Macは動いています（${agoLabel(status.at, now)}に確認）`
          : `Macから応答がありません（最後は${agoLabel(status.at, now)}）`}
      </span>
      {last && (
        <span>
          最後の投稿 {new Date(last.t).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}（
          {agoLabel(last.t, now)}）・今日{status.today}件
        </span>
      )}
    </p>
  )
}

const PAUSE_DETAIL: Record<ChannelName, string> = {
  discord: '止めても Mac の投稿役は動いたままで、投稿だけを見合わせます。',
  yay: '止めても Mac の投稿役は動いたままで、投稿だけを見合わせます。いま出ている投稿は消えずに残ります。',
}

interface PauseControlProps {
  snapshot: ChannelSnapshot
  now: number
  busy: boolean
  error?: string
  onChange: (paused: boolean) => void
}

/**
 * 投稿を止める／再開するスイッチ。押しただけでは Mac はまだ知らないので、
 * 投稿役が「止まっています」と報告するまでは「停止を依頼しました」と出し、本当に止まったかを見分けられるようにする。
 */
function PauseControl({ snapshot, now, busy, error, onChange }: PauseControlProps) {
  if (!snapshot.pauseReady) {
    return (
      <section className="surface-card autopost__pause" aria-label="投稿の停止">
        <div className="autopost__pause-text">
          <strong>止める機能は準備中です</strong>
          <span>Supabase の SQL Editor で supabase/sql/006_autopost_pause.sql を実行すると使えます。</span>
        </div>
      </section>
    )
  }

  const state = pauseStateOf(snapshot)
  const macSilent = livenessOf(snapshot.status, now) !== 'alive'
  const since = snapshot.pausedAt
    ? new Date(snapshot.pausedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null

  const text: Record<typeof state, { title: string; detail: string }> = {
    running: { title: '自動で投稿しています', detail: PAUSE_DETAIL[snapshot.channel] },
    pausing: {
      title: '停止を依頼しました',
      detail: macSilent
        ? 'Macから応答がありません。投稿役が止まっているか、止める機能に対応していない古い版かもしれません。'
        : 'Macが受け取るまで、投稿が続くことがあります（数十秒ほど）。',
    },
    paused: {
      title: since ? `停止中（${since}から）` : '停止中',
      detail:
        snapshot.channel === 'yay'
          ? '新しい投稿は見合わせています。いま出ている投稿は、そのまま残っています。'
          : '新しい投稿は見合わせています。',
    },
    resuming: { title: '再開を依頼しました', detail: 'Macが受け取ると、投稿が再開されます。' },
  }

  const stopping = state === 'running' || state === 'resuming'
  const label = state === 'pausing' ? '停止を取り消す' : state === 'paused' ? '投稿を再開する' : '投稿を止める'

  return (
    <section className={`surface-card autopost__pause autopost__pause--${state}`} aria-label="投稿の停止">
      <div className="autopost__pause-text">
        <strong>{text[state].title}</strong>
        <span>{text[state].detail}</span>
        {error && (
          <span className="autopost__pause-error" role="alert">
            {error}
          </span>
        )}
      </div>
      <button
        type="button"
        className={`btn ${stopping ? 'autopost__pause-stop' : state === 'paused' ? 'btn--primary' : 'btn--secondary'}`}
        onClick={() => onChange(stopping)}
        disabled={busy}
      >
        {busy ? '送っています…' : label}
      </button>
    </section>
  )
}

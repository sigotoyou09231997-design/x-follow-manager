import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useScheduledPosts } from '../../hooks/useScheduledPosts'
import { useXAutopilot } from '../../hooks/useXAutopilot'
import {
  buildAutopilotProfile,
  previewAutopilotPost,
  readAutopilotHistory,
  refillAutopilot,
  saveAutopilotSettings,
  startAutopilot,
  stopAutopilot,
  type ActionReply,
} from '../../lib/xAutopilot/api'
import { aiCostYen, formatYen, monthlyYen, QUALITY_MODELS, setupYen, TYPICAL_TOKENS } from '../../lib/xAutopilot/cost'
import {
  isAutopilotPost,
  LIMITS,
  type AutopilotSettings,
  type AutopilotState,
  type Quality,
} from '../../lib/xAutopilot/types'
import { settingsProblems } from '../../lib/xAutopilot/slots'
import { soonestApprovalTime } from '../../lib/xAutopilot/approve'
import { whenParts } from '../../lib/xAutopilot/whenLabel'
import { updateScheduledPost } from '../../lib/schedule/postsStore'
import { Icon } from '../Icon'
import { SwitchRow } from './ChannelControls'
import { UpcomingEditor } from './UpcomingEditor'
import { UsageMeter } from './UsageMeter'

// 「自動投稿」タブの X。過去の投稿を読んで文体をまとめ、AIが新しい投稿を前もって予約に並べる。
// 費用が出る操作（読み込み・まとめ・試し書き）は、押す前にボタンの横へ金額の目安を出す。

const QUALITY_ORDER: Quality[] = ['standard', 'saver']

const dayLabel = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric' }) : '')

// 設定の時間帯は設定の地域の時刻。予約の時刻も同じ地域で見せないと、端末の時差しだいで
// 「8時〜23時にしたのに予約は別の時刻」に見える。
const whenLabel = (iso: string | undefined, timeZone: string) =>
  iso
    ? new Date(iso).toLocaleString('ja-JP', { timeZone, month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' })
    : '日時未設定'

/** 投稿時刻。「今日／明日／日付」と大きな時刻、あと何時間かを並べる（ひと目で、いつ出るかが分かるように）。 */
function WhenLabel({ iso, timeZone }: { iso: string | undefined; timeZone: string }) {
  const parts = whenParts(iso, timeZone, Date.now())
  if (!parts) return <span className="xap__when">日時未設定</span>
  return (
    <span className="xap__when">
      <span className="xap__day">{parts.day}</span>
      <span className="xap__time">{parts.time}</span>
      {parts.rel && <span className="xap__rel">{parts.rel}</span>}
    </span>
  )
}

const zoneName = (timeZone: string) => (timeZone === 'Asia/Tokyo' ? '日本時間' : timeZone)

/** 1本書く費用の目安（円）。 */
const previewYen = (quality: Quality) => aiCostYen(quality, TYPICAL_TOKENS.postInput, TYPICAL_TOKENS.postOutput)

interface Notice {
  text: string
  kind: 'ok' | 'err'
}

const errorOf = (err: unknown) => (err instanceof Error ? err.message : String(err))

interface PanelProps {
  /**
   * 'summary' はトップの1画面用。自動運転のスイッチと「これから投稿される予定」だけを出し、
   * 文体・試し書き・細かい設定は、設定から開く自動投稿の詳細（'full'）に任せる。
   */
  variant?: 'full' | 'summary'
  /** summary のとき、細かい設定へ行く導線（設定が済んでいないときの案内に使う）。 */
  onOpenDetail?: () => void
  /**
   * summary のとき、X のスイッチの下に差し込む部分（ディスコード・Yay のスイッチ）。
   * X の読み込みが終わっていなくても・失敗していても出す（どちらかが読めなくても、もう一方は使えるように）。
   */
  children?: ReactNode
}

export function XAutopilotPanel({ variant = 'full', onOpenDetail, children }: PanelProps = {}) {
  const { state, loading, error, setupNeeded, busy, reload, run } = useXAutopilot(true)
  const { posts, reload: reloadPosts } = useScheduledPosts(true)
  const [edits, setEdits] = useState<Partial<AutopilotSettings>>({})
  const [notice, setNotice] = useState<Notice>()
  const [preview, setPreview] = useState<{ text: string | null; problems: string[] }>()
  const [step, setStep] = useState<string>()
  // 「取り消す」のあとの作り直し。続けて何本も取り消しても、1つずつ順番に頼む（同じ枠を同時に作って費用が無駄にならないように）。
  const refillQueue = useRef<Promise<unknown>>(Promise.resolve())
  const [refilling, setRefilling] = useState(0)
  // 並んだ予約の本文・時刻を直している最中の1件。
  const [editing, setEditing] = useState<{ id: string; saving: boolean; error?: string }>()

  const upcoming = useMemo(
    () =>
      posts
        .filter((p) => isAutopilotPost(p.aiPrompt) && (p.status === 'scheduled' || p.status === 'draft'))
        // 投稿可能（scheduled）を上に、確認待ち（draft）を下に。それぞれの中は、投稿時刻の早い順。
        .sort(
          (a, b) =>
            Number(a.status === 'draft') - Number(b.status === 'draft') || (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? '')
        ),
    [posts]
  )

  // summary のときは、読み込み中・失敗・未準備でも、下に差し込む部分（ディスコード・Yay）は出す。
  const beforeReady = (node: ReactNode) =>
    variant === 'summary' ? (
      <div className="xap xap--summary">
        {node}
        {children && <section className="surface-card switch-list" aria-label="稼働スイッチ">{children}</section>}
      </div>
    ) : (
      node
    )

  if (setupNeeded) {
    return beforeReady(
      <div className="surface-card xap__card">
        <h2 className="xap__title">自動運転の保存先がまだ用意されていません</h2>
        <p className="xap__muted">
          Supabase の SQL Editor で <code>supabase/sql/007_x_autopilot.sql</code> を実行すると使えるようになります。
          他の自動投稿（ディスコード・Yay）や予約投稿には影響しません。
        </p>
        <button type="button" className="btn btn--ghost" onClick={() => void reload()}>
          <Icon name="refresh" size={16} />
          もう一度ためす
        </button>
      </div>
    )
  }
  if (error && !state) {
    return beforeReady(
      <div className="surface-card xap__card">
        <p>自動運転の読み込みに失敗しました。</p>
        <p className="xap__muted">{error}</p>
        <button type="button" className="btn btn--ghost" onClick={() => void reload()}>
          <Icon name="refresh" size={16} />
          もう一度ためす
        </button>
      </div>
    )
  }
  if (loading || !state) return beforeReady(<p className="loading-indicator">読み込み中…</p>)

  const form: AutopilotSettings = { ...state.settings, ...edits }
  const dirty = (Object.keys(edits) as (keyof AutopilotSettings)[]).some((k) => edits[k] !== state.settings[k])
  const working = busy !== null
  const hasProfile = state.profileReady
  const connected = !!state.xAccount
  const monthly = monthlyYen(form.quality, form.postsPerDay)
  // 入力の途中の値や押し間違いを、黙って別の設定に直さない。直す所を見せて、先へ進ませない。
  const problems = settingsProblems(form)
  const blocked = problems.length > 0

  async function act(label: string, action: () => Promise<ActionReply>, onDone?: (reply: ActionReply) => void) {
    setNotice(undefined)
    try {
      const reply = await run(label, action)
      onDone?.(reply)
    } catch (err) {
      setNotice({ text: errorOf(err), kind: 'err' })
      // 保存だけ済んで後ろの操作が失敗したとき、画面の状態が古いままにならないよう取り直す。
      void reload()
    } finally {
      setStep(undefined)
    }
  }

  /**
   * 押したボタンの金額や動作は、画面で選んでいる設定（form）で見せている。ところがサーバーは保存済みの設定で動くので、
   * 「保存する」を押さないまま「始める」「試し書き」を押すと、変えたはずの設定（1日2回など）が使われず、
   * 古い設定で予約が作られていた。先に保存してから動かす。
   */
  const saveThen = (action: () => Promise<ActionReply>) => async () => {
    if (dirty) {
      await saveAutopilotSettings(edits)
      setEdits({})
    }
    return action()
  }

  const doSetup = () =>
    act(
      'setup',
      saveThen(async () => {
        setStep('過去の投稿を読み込んでいます…')
        await readAutopilotHistory()
        setStep('文体をまとめています…（30秒ほどかかります）')
        return buildAutopilotProfile()
      }),
      () => setNotice({ text: '読み込んで、文体をまとめました', kind: 'ok' })
    )

  const doReadNew = () =>
    act('read', () => readAutopilotHistory(), (reply) => {
      const r = reply.result as { fetched: number; added: number } | undefined
      setNotice({ text: r ? `新しく ${r.added} 件を取り込みました（読み取り ${r.fetched} 件）` : '取り込みました', kind: 'ok' })
    })

  const doRebuild = () =>
    act('profile', saveThen(buildAutopilotProfile), () => setNotice({ text: '文体をまとめ直しました', kind: 'ok' }))

  const doPreview = () =>
    act('preview', saveThen(previewAutopilotPost), (reply) => setPreview(reply.preview))

  const doSave = () =>
    act('save', () => saveAutopilotSettings(edits), (reply) => {
      setEdits({})
      setNotice({
        text: reply.rebuilt ? '保存しました。まだ出ていない予約は、新しい設定で作り直します' : '保存しました',
        kind: 'ok',
      })
      void reloadPosts()
    })

  const doStart = () =>
    act('start', saveThen(startAutopilot), () => {
      setNotice({ text: '自動運転を始めました。予約はこのあと数分で並びます', kind: 'ok' })
      void reloadPosts()
    })

  const doStop = () =>
    act('stop', () => stopAutopilot(), (reply) => {
      const r = reply.result as { canceled: number } | undefined
      setNotice({ text: `自動運転を止めました（まだ出ていない予約 ${r?.canceled ?? 0} 件を取り消しました）`, kind: 'ok' })
      void reloadPosts()
    })

  async function saveEdit(id: string, text: string, scheduledAt: string, timeChanged: boolean) {
    const post = posts.find((p) => p.id === id)
    if (!post) return
    setEditing({ id, saving: true })
    try {
      // 本文は先頭の1件だけを差し替える（自動運転の予約は1件。画像などほかの中身は触らない）。
      // 枠の印（ai_prompt）は変えないので、時刻を動かしても、その枠は埋まったままで、別の文が重ねて作られることはない。
      // 時刻を本人が変えたときは、「時刻は本人が決めた」印（fixedTime）を付ける。付いた予約は、自動で前倒ししない。
      const segments = post.segments.map((segment, i) => (i === 0 ? { ...segment, text, ...(timeChanged ? { fixedTime: true } : {}) } : segment))
      await updateScheduledPost(id, { segments, scheduledAt })
      setEditing(undefined)
      setNotice({ text: '直しました。この内容で予定どおり投稿されます', kind: 'ok' })
      await reloadPosts()
    } catch (err) {
      setEditing({ id, saving: false, error: errorOf(err) })
    }
  }

  // 「投稿可能」: 確認待ち（draft）を予約中（scheduled）にする。時刻になると投稿される（時刻を過ぎていれば、1分以内に）。
  // 「確認待ちに戻す」はその逆。投稿可能にしたあとは、その予約より前の時刻に、まだ作っていない枠が残っていないかを
  // 調べて、あればいちばん近い枠から別の文を作る（取り消したあとの作り直しと同じ仕組み。空きが無ければ何も作らない）。
  async function setApproved(id: string, approved: boolean) {
    const post = posts.find((p) => p.id === id)
    if (!post) return
    setNotice(undefined)
    try {
      // 投稿可能な予約の中で、これがいちばん早いなら、待たせずに前倒しする（5分後）。前に投稿可能な予約があれば、時刻はそのまま。
      const toTimes = (p: (typeof posts)[number]) => ({ id: p.id, status: p.status, scheduledAt: p.scheduledAt, fixedTime: p.segments[0]?.fixedTime === true })
      const moved = approved ? soonestApprovalTime(toTimes(post), posts.filter((p) => isAutopilotPost(p.aiPrompt)).map(toTimes), Date.now()) : undefined
      await updateScheduledPost(id, { status: approved ? 'scheduled' : 'draft', ...(moved ? { scheduledAt: moved } : {}) })
      const late = !!post.scheduledAt && new Date(post.scheduledAt).getTime() <= Date.now()
      const text = approved
        ? moved
          ? `投稿可能にしました。いちばん早い投稿可能な予約なので、${whenLabel(moved, state?.settings.timeZone ?? 'Asia/Tokyo')}（5分後）に投稿されます`
          : late
            ? '投稿可能にしました。時刻を過ぎているので、1分以内に投稿されます'
            : '投稿可能にしました。時刻になると投稿されます'
        : '確認待ちに戻しました。投稿可能にするまで、投稿されません'
      setNotice({ text, kind: 'ok' })
      await reloadPosts()
      // 作り直しで空き枠に文を並べたときも、「投稿可能にした」知らせは消さずに、並べたことを足して伝える。
      if (approved) queueRefill(`${text}。前の時刻の空き枠にも、別の文を並べました`)
    } catch (err) {
      setNotice({ text: errorOf(err), kind: 'err' })
    }
  }

  async function cancelOne(id: string) {
    const post = posts.find((p) => p.id === id)
    if (!post) return
    setNotice(undefined)
    try {
      // 削除せず、「取り消した」印を付けて残す。消すと、AIに「これは要らない」が伝わらず、取り消しても
      // 似た話題・同じ型の文が出続けた。残した文は、次に書くとき「こういうのは出さない」の材料になる。
      // 取り消した枠は空きとして扱い、別の文で作り直す（下の queueRefill）。一覧には出ない。
      await updateScheduledPost(post.id, { status: 'canceled', rejected: true })
      // 確認してから投稿する設定では、外したものは外したまま（作り直さない。サーバーの毎分の補充も作り直さない）。
      const redo = !state?.settings.requireApproval
      setNotice({
        text: redo ? '取り消しました。いちばん近い時刻の枠から、別の文を作り直します' : '取り消しました。この枠は、そのまま空けておきます',
        kind: 'ok',
      })
      await reloadPosts()
      if (redo) queueRefill()
    } catch (err) {
      setNotice({ text: errorOf(err), kind: 'err' })
    }
  }

  // 取り消した枠（いちばん近い時刻から）を、いますぐ別の文で作り直す。毎分の補充も同じ空きを拾うので、
  // これが失敗しても、このあと数分で自動で作り直される。続けて取り消しても、順番に1つずつ頼む。
  function queueRefill(createdText = '取り消した枠に、別の文を並べました') {
    setRefilling((n) => n + 1)
    refillQueue.current = refillQueue.current.then(async () => {
      try {
        const reply = await refillAutopilot()
        const r = reply.result as { created: number; error?: string } | undefined
        if (r?.error) setNotice({ text: `${r.error}。このあと数分で、自動で作り直します`, kind: 'err' })
        else if (r && r.created > 0) setNotice({ text: createdText, kind: 'ok' })
      } catch (err) {
        setNotice({ text: `${errorOf(err)}。このあと数分で、自動で作り直します`, kind: 'err' })
      } finally {
        setRefilling((n) => n - 1)
        await reloadPosts()
        void reload()
      }
    })
  }

  // 予約の1件ずつのカード。投稿可能のエリアと、確認待ちのエリアで同じ形を使う。
  const renderPost = (post: (typeof upcoming)[number]) =>
    editing?.id === post.id ? (
      <li key={post.id} className="xap__editing">
        <UpcomingEditor
          text={post.segments[0]?.text ?? ''}
          at={post.scheduledAt ?? new Date().toISOString()}
          timeZone={state.settings.timeZone}
          saving={editing.saving}
          error={editing.error}
          onSave={(text, at, timeChanged) => void saveEdit(post.id, text, at, timeChanged)}
          onCancel={() => setEditing(undefined)}
        />
      </li>
    ) : (
      <li key={post.id}>
        <WhenLabel iso={post.scheduledAt} timeZone={state.settings.timeZone} />
        {/* エリアの見出しで状態は分かるので、札は「確認待ちなのに時刻を過ぎている」ときだけ出す。 */}
        {post.status === 'draft' && post.scheduledAt && new Date(post.scheduledAt).getTime() <= Date.now() && (
          <span className="xap__badge xap__badge--draft">確認待ち（時刻を過ぎています）</span>
        )}
        <span className="autopost__history-text xap__upcoming-text">{post.segments[0]?.text}</span>
        <div className="xap__card-actions">
          {post.status === 'draft' ? (
            <button type="button" className="btn btn--primary btn--small" onClick={() => void setApproved(post.id, true)} aria-label="この予約を投稿可能にする">
              <Icon name="check" size={14} />
              投稿可能にする
            </button>
          ) : (
            <button type="button" className="btn btn--ghost btn--small" onClick={() => void setApproved(post.id, false)} aria-label="この予約を確認待ちに戻す">
              確認待ちに戻す
            </button>
          )}
          <button type="button" className="btn btn--ghost btn--small" onClick={() => setEditing({ id: post.id, saving: false })} aria-label="この予約の本文と時刻を直す">
            <Icon name="edit" size={14} />
            編集
          </button>
          <button type="button" className="btn btn--ghost btn--small btn--danger" onClick={() => void cancelOne(post.id)}>
            <Icon name="trash" size={14} />
            取り消す
          </button>
        </div>
      </li>
    )

  // 投稿可能（時刻になると投稿される）と、確認待ち（押すまで投稿されない）を、別々の枠に分ける。
  const approvedPosts = upcoming.filter((p) => p.status === 'scheduled')
  const waitingPosts = upcoming.filter((p) => p.status === 'draft')

  const upcomingSection = (
    <section aria-label="これから投稿される予定">
      <h2 className="autopost__sub">{variant === 'summary' ? 'Xの、これから投稿される予定' : 'これから投稿される予定'}</h2>
      {upcoming.length === 0 ? (
        <p className="autopost__empty">まだありません。自動運転を始めると、ここに並びます。</p>
      ) : (
        <div className="xap__zones">
          <div className="xap__zone xap__zone--ok" role="group" aria-labelledby="xap-zone-ok">
            <header className="xap__zone-head">
              <h3 id="xap-zone-ok" className="xap__zone-title">投稿可能</h3>
              <span className="xap__zone-count">{approvedPosts.length}件</span>
              <p className="xap__zone-note">時刻になると投稿されます</p>
            </header>
            {approvedPosts.length === 0 ? (
              <p className="xap__zone-empty">まだありません。確認待ちの「投稿可能にする」を押すと、ここに入ります。</p>
            ) : (
              <ul className="autopost__history xap__upcoming">{approvedPosts.map(renderPost)}</ul>
            )}
          </div>

          {waitingPosts.length > 0 && (
            <div className="xap__zone xap__zone--draft" role="group" aria-labelledby="xap-zone-draft">
              <header className="xap__zone-head">
                <h3 id="xap-zone-draft" className="xap__zone-title">確認待ち</h3>
                <span className="xap__zone-count">{waitingPosts.length}件</span>
                <p className="xap__zone-note">「投稿可能にする」を押すまで、投稿されません</p>
              </header>
              <ul className="autopost__history xap__upcoming">{waitingPosts.map(renderPost)}</ul>
            </div>
          )}
        </div>
      )}
      {upcoming.length > 0 && (
        <p className="xap__muted">
          {variant === 'summary'
            ? state.settings.requireApproval
              ? '「編集」で本文と投稿時刻を直せます。取り消すと、その枠はそのまま空きます（作り直しません）。'
              : '「編集」で本文と投稿時刻を直せます。取り消すと、近い時刻の枠から別の文を作り直します（数十秒）。'
            : state.settings.requireApproval
              ? '「編集」で本文と投稿時刻を直せます。取り消すと、その枠はそのまま空きます（作り直しません）。取り消した文は覚えておき、似た話題・型は作らないようにします。'
              : '「編集」で本文と投稿時刻を直せます。取り消すと、いちばん近い時刻の枠から、別の文を作り直して並べます（数十秒）。取り消した文は覚えておき、似た話題・型は作らないようにします。'}
        </p>
      )}
    </section>
  )

  if (variant === 'summary') {
    const ready = hasProfile && connected
    const waitingCount = upcoming.filter((p) => p.status === 'draft').length
    const stopButton = (
      <button type="button" className="btn btn--small autopost__pause-stop" onClick={() => void doStop()} disabled={working} aria-label="自動運転を止める">
        {busy === 'stop' ? '止めています…' : '止める'}
      </button>
    )
    const startButton = (
      <button
        type="button"
        className="btn btn--small btn--primary"
        onClick={() => void doStart()}
        disabled={!ready || working || blocked}
        aria-label="自動運転を始める"
      >
        {busy === 'start' ? '始めています…' : '始める'}
      </button>
    )
    // 連携や文体がまだなら、押せない「始める」より、それを済ませる画面への入口を出す。
    const setupButton = (
      <button type="button" className="btn btn--ghost btn--small" onClick={onOpenDetail} aria-label="Xとの連携と文体を設定する">
        設定する
      </button>
    )
    return (
      <div className="xap xap--summary">
        {notice && (
          <p className={`autopost__msg autopost__msg--${notice.kind}`} role={notice.kind === 'err' ? 'alert' : 'status'}>
            {notice.text}
          </p>
        )}
        {refilling > 0 && (
          <p className="xap__muted" role="status">
            別の文を作り直しています…（数十秒かかります）
          </p>
        )}
        {/* 今月のAI料金。トップのいちばん上（稼働スイッチの上）に、上限に対する割合の棒つきで出す。 */}
        <UsageMeter usage={state.usage} budgetYen={state.settings.monthlyBudgetYen} />
        <section className="surface-card switch-list" aria-label="稼働スイッチ">
          <SwitchRow
            name="X"
            tone={state.enabled ? (state.lastError ? 'warn' : 'on') : 'off'}
            status={state.enabled ? (waitingCount > 0 ? `自動運転中・確認待ち${waitingCount}件` : '自動運転中') : ready ? '自動運転は止まっています' : '先に、Xとの連携と文体のまとめが必要です'}
            note={state.enabled && state.lastError ? `補充を止めています: ${state.lastError}` : undefined}
            action={state.enabled ? stopButton : !ready && onOpenDetail ? setupButton : startButton}
          />
          {children}
        </section>
        {upcomingSection}
      </div>
    )
  }

  return (
    <div className="xap">
      <p className="autopost__info">
        自分の過去の投稿から文体を学び、AIが新しい投稿を<strong>前もって</strong>予約に並べます。予約一覧で見て、直す・消すができ、
        何もしなければ予定どおり投稿されます。
      </p>

      {notice && (
        <p className={`autopost__msg autopost__msg--${notice.kind}`} role={notice.kind === 'err' ? 'alert' : 'status'}>
          {notice.text}
        </p>
      )}
      {refilling > 0 && (
        <p className="xap__muted" role="status">
          別の文を作り直しています…（数十秒かかります）
        </p>
      )}

      <StyleCard
        state={state}
        quality={form.quality}
        busy={busy}
        step={step}
        working={working}
        connected={connected}
        blocked={blocked}
        onSetup={() => void doSetup()}
        onReadNew={() => void doReadNew()}
        onRebuild={() => void doRebuild()}
      />

      <section className="surface-card xap__card" aria-label="試し書き">
        <h2 className="xap__title">試しに1本書いてみる</h2>
        <p className="xap__muted">いまの文体で、1本だけ書かせます。予約には入れません。気に入らなければ、設定を変えてもう一度。</p>
        <div className="autopost__actions">
          <button type="button" className="btn btn--secondary" onClick={() => void doPreview()} disabled={!hasProfile || working || blocked}>
            <Icon name="sparkles" size={16} />
            {busy === 'preview' ? '書いています…' : `試し書き（約${formatYen(previewYen(form.quality))}）`}
          </button>
        </div>
        {!hasProfile && <p className="xap__muted">先に「文体をまとめる」を済ませてください。</p>}
        {preview && (
          <div className="xap__preview" aria-live="polite">
            {preview.text ? <p className="xap__preview-text">{preview.text}</p> : <p className="xap__muted">AIが書けませんでした。もう一度お試しください。</p>}
            {preview.problems.length > 0 && (
              <p className="xap__warn">
                この案は、自動運転では使われません（{preview.problems.join('、')}）。
              </p>
            )}
          </div>
        )}
      </section>

      <section className="surface-card xap__card" aria-label="自動運転の設定">
        <h2 className="xap__title">自動運転</h2>

        <div className="xap__grid">
          <label className="xap__field">
            <span>1日の投稿数</span>
            <select
              value={form.postsPerDay}
              onChange={(e) => setEdits((p) => ({ ...p, postsPerDay: Number(e.target.value) }))}
            >
              {Array.from({ length: LIMITS.postsPerDay.max }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}回
                </option>
              ))}
            </select>
          </label>
          <label className="xap__field">
            <span>何日先まで予約に並べる</span>
            <select
              value={form.horizonDays}
              onChange={(e) => setEdits((p) => ({ ...p, horizonDays: Number(e.target.value) }))}
            >
              {[1, 2, 3].map((n) => (
                <option key={n} value={n}>
                  {n}日先まで
                </option>
              ))}
            </select>
          </label>
          <label className="xap__field">
            <span>投稿する時間帯（始め）</span>
            <input type="time" value={form.windowStart} onChange={(e) => setEdits((p) => ({ ...p, windowStart: e.target.value }))} />
          </label>
          <label className="xap__field">
            <span>投稿する時間帯（終わり）</span>
            <input type="time" value={form.windowEnd} onChange={(e) => setEdits((p) => ({ ...p, windowEnd: e.target.value }))} />
          </label>
        </div>
        <p className="xap__muted">
          時刻は{zoneName(form.timeZone)}です。投稿の時刻は、この時間帯を回数で等分した真ん中あたりを基準に、日ごとに少しずらして決まります
          （毎日同じ時刻だと機械的に見えるため）。
          {form.postsPerDay === 2 && ' 1日2回のときは、午前（始め〜12:00）に1回、午後（12:00〜18:00。終わりが早ければそこまで）に1回です。'}
          今日のぶんは、時刻が過ぎた枠も、今日の残りの時間帯に入れます。
        </p>
        {blocked && (
          <ul className="xap__warn xap__problems" role="alert">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}

        <fieldset className="xap__quality">
          <legend>文章の質（使うAI）</legend>
          {QUALITY_ORDER.map((q) => (
            <label key={q} className={`xap__option${form.quality === q ? ' xap__option--on' : ''}`}>
              <input
                type="radio"
                name="x-autopilot-quality"
                checked={form.quality === q}
                onChange={() => setEdits((p) => ({ ...p, quality: q }))}
              />
              <span className="xap__option-body">
                <strong>{QUALITY_MODELS[q].label}</strong>
                <span>月の目安 約{formatYen(monthlyYen(q, form.postsPerDay))}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <label className="xap__field xap__field--inline">
          <span>月の使用額の上限（円）</span>
          <input
            type="number"
            min={LIMITS.monthlyBudgetYen.min}
            max={LIMITS.monthlyBudgetYen.max}
            step={100}
            value={form.monthlyBudgetYen}
            onChange={(e) => setEdits((p) => ({ ...p, monthlyBudgetYen: Number(e.target.value) }))}
          />
        </label>

        <label className={`xap__option${form.requireApproval ? ' xap__option--on' : ''}`}>
          <input
            type="checkbox"
            checked={form.requireApproval}
            onChange={(e) => setEdits((p) => ({ ...p, requireApproval: e.target.checked }))}
          />
          <span className="xap__option-body">
            <strong>投稿する前に、自分で確認して「投稿可能」を押す</strong>
            <span>
              オンのあいだ、AIが並べる投稿は「確認待ち」で、押したものだけが時刻になると投稿されます。
              オフにすると、確認なしで、時刻になれば投稿されます（確認待ちだった分も、投稿可能になります）。
            </span>
          </span>
        </label>

        <label className={`xap__option${form.deletePrevious ? ' xap__option--on' : ''}`}>
          <input
            type="checkbox"
            checked={form.deletePrevious}
            onChange={(e) => setEdits((p) => ({ ...p, deletePrevious: e.target.checked }))}
          />
          <span className="xap__option-body">
            <strong>次の投稿が出たら、前の自動運転の投稿を X から消す</strong>
            <span>
              いつも最新の1本だけが X に残ります。<b>X で消した投稿は元に戻せません。</b>
              消すのは自動運転が出した投稿だけで、あなたが自分で書いたツイートは消えません。
              オンにする前に出た投稿も消えません。
              {state.settings.deletePrevious && state.settings.deletePreviousFrom && !dirty
                ? `（${dayLabel(state.settings.deletePreviousFrom)}にオンにしました。それ以降の投稿が対象です）`
                : ''}
            </span>
          </span>
        </label>

        {!blocked && (
          <p className="xap__muted">
            1日{form.postsPerDay}回 × {form.horizonDays}日先まで ＝ 予約は最大{form.postsPerDay * form.horizonDays}本が並びます
          </p>
        )}
        <p className="xap__estimate">
          この設定の<strong>月の目安: 約{formatYen(monthly)}</strong>
          <span className="xap__muted">
            （1本あたり約{formatYen(previewYen(form.quality) * 1.15 + 2.25)}・Xへの投稿 2.25円を含む）
          </span>
        </p>
        <p className="xap__usage">
          今月ここまで 約{formatYen(state.usage.yen)} / 上限 {formatYen(state.settings.monthlyBudgetYen)}
          <span className="xap__muted">（見積もり。上限に近づくと、新しい投稿を作らなくなります）</span>
        </p>

        {dirty && (
          <div className="autopost__actions">
            <button type="button" className="btn btn--primary" onClick={() => void doSave()} disabled={working || blocked}>
              {busy === 'save' ? '保存しています…' : '設定を保存する'}
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setEdits({})} disabled={working}>
              変更を取り消す
            </button>
          </div>
        )}
        {dirty && state.enabled && (
          <p className="xap__muted">投稿数・時間帯・日数を変えて保存すると、まだ出ていない予約は新しい設定で作り直されます。</p>
        )}

        <RunControl
          state={state}
          busy={busy}
          working={working}
          hasProfile={hasProfile}
          connected={connected}
          blocked={blocked}
          onStart={() => void doStart()}
          onStop={() => void doStop()}
        />
      </section>

      {upcomingSection}
    </div>
  )
}

// ------------------------------------------------------------------ 文体（履歴の読み込み＋まとめ）

interface StyleCardProps {
  state: AutopilotState
  quality: Quality
  busy: string | null
  step?: string
  working: boolean
  connected: boolean
  /** 設定に直す所がある（保存済みの設定とずれたまま動かさない）。 */
  blocked: boolean
  onSetup: () => void
  onReadNew: () => void
  onRebuild: () => void
}

// 文体のまとめの中身（要約・語尾・話題）は、ここには出さない。本人の希望で、裏（Supabase の x_autopilot.profile）でだけ見られる。
function StyleCard({ state, quality, busy, step, working, connected, blocked, onSetup, onReadNew, onRebuild }: StyleCardProps) {
  const { history } = state
  const first = !state.profileReady
  const rebuildYen = aiCostYen(quality, TYPICAL_TOKENS.profileInput, TYPICAL_TOKENS.profileOutput)

  return (
    <section className="surface-card xap__card" aria-label="あなたの文体">
      <h2 className="xap__title">あなたの文体</h2>

      <p className="xap__line">
        <span className={`autopost__dot autopost__dot--${connected ? 'on' : 'off'}`} aria-hidden="true" />
        {connected ? `Xと連携中（@${state.xAccount?.username}）` : 'Xと連携していません。「予約投稿」タブで「Xと連携」してください'}
      </p>
      <p className="xap__line xap__muted">
        {history.total > 0
          ? `読み込み済み ${history.total}件（${dayLabel(history.oldestAt)}〜${dayLabel(history.newestAt)}）`
          : 'まだ過去の投稿を読み込んでいません'}
      </p>

      <p className="xap__line xap__muted">
        {state.profileReady ? `文体のまとめ済み（${dayLabel(state.profileBuiltAt)}）` : 'まだ文体をまとめていません'}
      </p>

      <div className="autopost__actions">
        {first ? (
          <button type="button" className="btn btn--primary" onClick={onSetup} disabled={!connected || working || blocked}>
            {busy === 'setup' ? (step ?? '実行しています…') : `過去の投稿を読んで、文体をまとめる（約${formatYen(setupYen(quality))}）`}
          </button>
        ) : (
          <>
            <button type="button" className="btn btn--secondary" onClick={onReadNew} disabled={!connected || working}>
              {busy === 'read' ? '読み込んでいます…' : '新しい投稿だけ取り込む（ほぼ無料）'}
            </button>
            <button type="button" className="btn btn--ghost" onClick={onRebuild} disabled={working || blocked}>
              {busy === 'profile' ? 'まとめています…' : `文体をまとめ直す（約${formatYen(rebuildYen)}）`}
            </button>
          </>
        )}
      </div>
      {busy === 'setup' && step && <p className="xap__muted">{step}</p>}
      {first && <p className="xap__muted">Xの自分の投稿（返信とリポストを除く最大200件）を読みます。読み取りは1件約0.15円です。</p>}
    </section>
  )
}

// ------------------------------------------------------------------ 自動運転の ON / OFF

interface RunControlProps {
  state: AutopilotState
  busy: string | null
  working: boolean
  hasProfile: boolean
  connected: boolean
  blocked: boolean
  onStart: () => void
  onStop: () => void
}

function RunControl({ state, busy, working, hasProfile, connected, blocked, onStart, onStop }: RunControlProps) {
  const ready = hasProfile && connected
  return (
    <div className={`xap__run xap__run--${state.enabled ? 'on' : 'off'}`}>
      <div className="xap__run-text">
        <strong>{state.enabled ? '自動運転中' : '自動運転は止まっています'}</strong>
        <span>
          {state.enabled
            ? '設定どおり、AIが前もって予約に並べています。止めると、まだ出ていない予約は取り消されます。'
            : ready
              ? '始めると、AIが投稿を予約に並べはじめます。始めるまで、費用はかかりません。'
              : '先に、Xとの連携と「文体をまとめる」を済ませてください。'}
        </span>
        {state.lastError && state.enabled && (
          <span className="xap__warn" role="status">
            補充を止めています: {state.lastError}
          </span>
        )}
      </div>
      {state.enabled ? (
        <button type="button" className="btn autopost__pause-stop" onClick={onStop} disabled={working}>
          {busy === 'stop' ? '止めています…' : '自動運転を止める'}
        </button>
      ) : (
        <button type="button" className="btn btn--primary" onClick={onStart} disabled={!ready || working || blocked}>
          {busy === 'start' ? '始めています…' : '自動運転を始める'}
        </button>
      )}
    </div>
  )
}

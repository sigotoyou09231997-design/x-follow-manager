import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useScheduledPosts } from '../../hooks/useScheduledPosts'
import { useXAutopilot } from '../../hooks/useXAutopilot'
import {
  buildAutopilotProfile,
  previewAutopilotPost,
  readAutopilotHistory,
  refillAutopilot,
  reviseAutopilotPost,
  composeAutopilotPost,
  saveAutopilotSettings,
  startAutopilot,
  stopAutopilot,
  type ActionReply,
} from '../../lib/xAutopilot/api'
import { aiCostYen, formatYen, monthlyYen, QUALITY_MODELS, setupYen, TYPICAL_TOKENS } from '../../lib/xAutopilot/cost'
import {
  AUTOPILOT_PREFIX,
  isAutopilotPost,
  LIMITS,
  REJECTED_MARK,
  type AutopilotSettings,
  type AutopilotState,
  type Quality,
} from '../../lib/xAutopilot/types'
import { settingsProblems } from '../../lib/xAutopilot/slots'
import { nextApprovalWindow, pickApprovalTime, postsOnDay, REFILL_MIN_LEAD_MS, type ApprovalWindow } from '../../lib/xAutopilot/approve'
import { whenParts } from '../../lib/xAutopilot/whenLabel'
import { createScheduledPost, updateScheduledPost } from '../../lib/schedule/postsStore'
import { Icon } from '../Icon'
import type { ChannelSnapshot, Snapshots } from '../../lib/autopost/api'
import { AllSwitch } from './AllSwitch'
import { SwitchRow, TextButton, Toggle } from './ChannelControls'
import { Sheet } from './Sheet'
import { AutoTextarea } from './TextBox'
import { RejectedInsights } from './RejectedInsights'
import { StyleInsights } from './StyleInsights'
import { ComposeCard } from './ComposeCard'
import { UpcomingEditor } from './UpcomingEditor'
import { UsageMeter } from './UsageMeter'

// 「自動投稿」タブの X。過去の投稿を読んで文体をまとめ、AIが新しい投稿を前もって予約に並べる。
// 費用が出る操作（読み込み・まとめ・試し書き）は、押す前にボタンの横へ金額の目安を出す。

const QUALITY_ORDER: Quality[] = ['standard', 'saver', 'cheapest']

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
  /** summary のとき、「すべて止める／再開」でまとめて動かすディスコード・Yay の状態と、変わったときの受け取り口。 */
  channels?: { snapshots: Snapshots | null; onChanged: (snapshot: ChannelSnapshot) => void }
}

export function XAutopilotPanel({ variant = 'full', onOpenDetail, children, channels }: PanelProps = {}) {
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
  // トップの X の行の「文」から開くポップアップ。過去に投稿した文を呼び出して直し、予約に加える欄の中身。
  const [textOpen, setTextOpen] = useState(false)
  const [reuse, setReuse] = useState('')
  const [reuseMsg, setReuseMsg] = useState<Notice>()
  const [reusing, setReusing] = useState(false)

  // これまでに X へ出した文（新しい順）。「文」のポップアップで、呼び出して直し、もう一度予約に加えられるようにする。
  const postedTexts = useMemo(
    () =>
      posts
        .filter((p) => p.status === 'posted')
        .sort((a, b) => (b.scheduledAt ?? b.updatedAt).localeCompare(a.scheduledAt ?? a.updatedAt))
        .map((p) => ({ id: p.id, at: p.scheduledAt ?? p.updatedAt, text: p.segments.map((s) => s.text).join('\n') }))
        .filter((p) => p.text.trim())
        .slice(0, 30),
    [posts]
  )

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

  // 取り消した文（「取り消す」で外した自動運転の文）と、取り消されなかった文。取り消した文の分析に使う。
  const rejectedTexts = useMemo(
    () =>
      posts
        .filter((p) => isAutopilotPost(p.aiPrompt) && p.status === 'canceled' && p.errorMessage === REJECTED_MARK)
        .map((p) => p.segments.map((s) => s.text).join('\n'))
        .filter((t) => t.trim()),
    [posts]
  )
  const keptTexts = useMemo(
    () =>
      posts
        .filter((p) => isAutopilotPost(p.aiPrompt) && p.status !== 'canceled' && p.status !== 'failed')
        .map((p) => p.segments.map((s) => s.text).join('\n'))
        .filter((t) => t.trim()),
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

  // 最新の投稿を取り込んで、そのまま文体に反映する（取り込むだけでは、文体のまとめは変わらないため、1つの操作にした）。
  // 取り込みで何件増えたかは、まとめ直しが終わったあとの知らせに出す。
  const doRefreshStyle = () => {
    let added: { fetched: number; added: number } | undefined
    let newest: string | null = null
    return act(
      'refresh',
      saveThen(async () => {
        setStep('最新の投稿を取り込んでいます…')
        const read = await readAutopilotHistory()
        added = read.result as { fetched: number; added: number } | undefined
        newest = read.state.history.newestAt
        // 新しい投稿が無ければ、まとめ直さない（同じ材料でAIを呼んでも文体は変わらず、費用だけがかかる）。
        if (added && added.added === 0) return read
        setStep('文体をまとめています…（30秒ほどかかります）')
        return buildAutopilotProfile()
      }),
      () =>
        setNotice({
          text:
            added && added.added === 0
              ? `新しい投稿はありませんでした（取り込み済みの最新は ${dayLabel(newest)} の投稿）。文体はそのままです`
              : added
                ? `新しく ${added.added} 件を取り込み（読み取り ${added.fetched} 件）、文体に反映しました`
                : '取り込んで、文体に反映しました',
          kind: 'ok',
        })
    )
  }

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

  // 「すべて止める／再開」から呼ぶ。個々の行のボタンと違い、結果の知らせは呼び出し側が出すので、失敗は理由の文字列で返す。
  const runForAll = async (label: string, action: () => Promise<ActionReply>) => {
    try {
      await run(label, action)
      void reloadPosts()
      return undefined
    } catch (err) {
      void reload()
      return errorOf(err)
    }
  }

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

  // 投稿可能にしたとき、その予約を入れる半日（午前か午後）。決まりは lib/xAutopilot/approve.ts。
  // 本人が時刻を決めた予約（fixedTime）は動かさない。押す前にボタンへ「押すと◯日の午前に」と出すのにも同じ計算を使う。
  function approvalWindow(post: (typeof posts)[number]): ApprovalWindow | undefined {
    if (post.segments[0]?.fixedTime === true || !state) return undefined
    const toTimes = (p: (typeof posts)[number]) => ({ id: p.id, status: p.status, scheduledAt: p.scheduledAt, fixedTime: p.segments[0]?.fixedTime === true })
    return nextApprovalWindow(toTimes(post), posts.filter((p) => isAutopilotPost(p.aiPrompt)).map(toTimes), Date.now(), {
      windowStart: state.settings.windowStart,
      windowEnd: state.settings.windowEnd,
      timeZone: state.settings.timeZone,
      postsPerDay: state.settings.postsPerDay,
    })
  }

  const partLabel = (w: ApprovalWindow) => {
    const day = whenParts(new Date(w.from).toISOString(), state?.settings.timeZone ?? 'Asia/Tokyo', Date.now())?.day ?? ''
    return `${day}の${w.part === 'morning' ? '午前' : '午後'}`
  }

  // 押すと、いつごろ投稿されるか（ボタンの下に出す）。確認待ちには時刻を出さない（押したとき午前・午後の中でランダムに決まる）。
  function approveHint(post: (typeof posts)[number]): string {
    if (post.segments[0]?.fixedTime === true) {
      const parts = whenParts(post.scheduledAt, state?.settings.timeZone ?? 'Asia/Tokyo', Date.now())
      return parts ? `押すと、${parts.day} ${parts.time} に投稿されます` : ''
    }
    const w = approvalWindow(post)
    return w ? `押すと、${partLabel(w)}のどこかで投稿されます` : '押すと、空いた枠に投稿されます'
  }

  /**
   * 「言葉から書く」で出た文を、自動投稿の予約に加える。日付・時刻は押した時点で自動で決める
   * （午前・午後の空いた半日のランダムな時刻。ほかの自動運転の予約との間隔・1日の上限は、投稿可能にするときと同じ決まり）。
   * 確認してから投稿する設定なら確認待ち、そうでなければ投稿可能（時刻になれば投稿）で入る。
   */
  async function addComposed(text: string): Promise<string> {
    if (!state) throw new Error('状態を読み込み中です')
    const autopilot = posts.filter((p) => isAutopilotPost(p.aiPrompt))
    const toTimes = (p: (typeof posts)[number]) => ({ id: p.id, status: p.status, scheduledAt: p.scheduledAt, fixedTime: p.segments[0]?.fixedTime === true })
    const now = Date.now()
    const window = nextApprovalWindow({ id: 'new', status: 'draft' }, autopilot.map(toTimes), now, {
      windowStart: state.settings.windowStart,
      windowEnd: state.settings.windowEnd,
      timeZone: state.settings.timeZone,
      postsPerDay: state.settings.postsPerDay,
    })
    if (!window) throw new Error('空いている枠が見つかりません（2週間先まで埋まっています）')
    const at = pickApprovalTime(window)
    const draft = state.settings.requireApproval
    await createScheduledPost({
      segments: [{ text, media: [] }],
      scheduledAt: at,
      status: draft ? 'draft' : 'scheduled',
      // 枠の印は「日付#…」の形にする（日付で枠を数える処理に合わせる）。manual は自動の枠と重ならない名前
      aiPrompt: `${AUTOPILOT_PREFIX}${at.slice(0, 10)}#manual-${crypto.randomUUID().slice(0, 8)}`,
    })
    await reloadPosts()
    return draft
      ? '確認待ちに追加しました。「投稿可能にする」を押すと、午前か午後のどこかで投稿されます'
      : `追加しました。${whenLabel(at, state.settings.timeZone)}に投稿されます`
  }

  // 「投稿可能」: 確認待ち（draft）を予約中（scheduled）にする。時刻になると投稿される（時刻を過ぎていれば、1分以内に）。
  // 「確認待ちに戻す」はその逆。投稿可能にしたあとは、その予約より前の時刻に、まだ作っていない枠が残っていないかを
  // 調べて、あればいちばん近い枠から別の文を作る（取り消したあとの作り直しと同じ仕組み。空きが無ければ何も作らない）。
  async function setApproved(id: string, approved: boolean) {
    const post = posts.find((p) => p.id === id)
    if (!post) return
    setNotice(undefined)
    try {
      // 投稿可能にするときだけ、時刻を決める。午前か午後の空いた半日（押す前にボタンに出している半日と同じ）の中から、ランダムに1つ。
      const window = approved ? approvalWindow(post) : undefined
      const moved = window ? pickApprovalTime(window) : undefined
      await updateScheduledPost(id, { status: approved ? 'scheduled' : 'draft', ...(moved ? { scheduledAt: moved } : {}) })
      const late = !!post.scheduledAt && new Date(post.scheduledAt).getTime() <= Date.now()
      const text = approved
        ? moved
          ? `投稿可能にしました。${whenLabel(moved, state?.settings.timeZone ?? 'Asia/Tokyo')}に投稿されます`
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
      // 確認してから投稿する設定では、近い枠（いまから2時間以内・過ぎた枠）は、外したまま空けておく（消したのに、また同じ時間帯に
      // 出てくるのを避ける）。遠い枠は作り直す（候補が減る一方にならないように）。サーバーの毎分の補充も同じ決まり。
      const far = !!post.scheduledAt && new Date(post.scheduledAt).getTime() >= Date.now() + REFILL_MIN_LEAD_MS
      const redo = !state?.settings.requireApproval || far
      setNotice({
        text: !redo
          ? '取り消しました。この枠は、近い時刻なので、そのまま空けておきます'
          : state?.settings.requireApproval
            ? '取り消しました。別の文を作り直します'
            : '取り消しました。いちばん近い時刻の枠から、別の文を作り直します',
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
          onRevise={async (text, instruction) => {
            // 費用が出る操作なので、ほかのAI操作と重ならないよう run を通す（状態も取り直される）
            const reply = await run('revise', () => reviseAutopilotPost(text, instruction))
            return reply.revised ?? { text: null, problems: ['AIが直した案を返しませんでした'] }
          }}
          onCancel={() => setEditing(undefined)}
        />
      </li>
    ) : (
      <li key={post.id}>
        {/* 確認待ちの時刻は、押したときに午前・午後の中でランダムに決まるので出さない（本人が時刻を決めた予約は出す）。 */}
        {(post.status !== 'draft' || post.segments[0]?.fixedTime === true) && <WhenLabel iso={post.scheduledAt} timeZone={state.settings.timeZone} />}
        <span className="autopost__history-text xap__upcoming-text">{post.segments[0]?.text}</span>
        <div className="xap__card-actions">
          {post.status === 'draft' ? (
            <button type="button" className="btn btn--primary btn--small xap__approve" onClick={() => void setApproved(post.id, true)} aria-label="この予約を投稿可能にする">
              <span className="xap__approve-main">
                <Icon name="check" size={14} />
                投稿可能にする
              </span>
              <span className="xap__approve-when">{approveHint(post)}</span>
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

  // 確認してから投稿する設定で自動運転が動いているあいだは、確認待ちの枠を、0件でも出しておく。
  // 取り消す・投稿可能にすると確認待ちが0件になり、枠ごと消えて2列が1列に切り替わっていた。枠を残して「自動生成中」と出し、
  // できたらその枠に入るようにする（PCでも2列のまま）。
  const showWaitingZone = state.settings.requireApproval && state.enabled
  const upcomingSection = (
    <section aria-label="これから投稿される予定">
      <h2 className="autopost__sub">{variant === 'summary' ? 'Xの予定' : 'これから投稿される予定'}</h2>
      {upcoming.length === 0 && !showWaitingZone ? (
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

          {(waitingPosts.length > 0 || showWaitingZone) && (
            <div className="xap__zone xap__zone--draft" role="group" aria-labelledby="xap-zone-draft">
              <header className="xap__zone-head">
                <h3 id="xap-zone-draft" className="xap__zone-title">確認待ち</h3>
                {waitingPosts.length > 0 && <span className="xap__zone-count">{waitingPosts.length}件</span>}
                <p className="xap__zone-note">「投稿可能にする」を押すまで、投稿されません</p>
              </header>
              {waitingPosts.length > 0 ? (
                <ul className="autopost__history xap__upcoming">{waitingPosts.map(renderPost)}</ul>
              ) : state.lastError && refilling === 0 ? (
                <p className="xap__zone-empty">いまは作れていません。しばらくすると、自動でもう一度作ります。</p>
              ) : (
                <p className="xap__zone-empty xap__zone-generating" role="status">
                  自動生成中です…（数十秒かかります）。できると、ここに出ます。
                </p>
              )}
            </div>
          )}
        </div>
      )}
      {/* 使い方の説明は詳細の画面だけ。トップは見出しと予定だけにする（シンプルにしたい、という本人の希望）。 */}
      {upcoming.length > 0 && variant !== 'summary' && (
        <p className="xap__muted">
          {state.settings.requireApproval
              ? '「編集」で本文と投稿時刻を直せます。取り消すと、近い時刻（2時間以内）の枠は空いたまま、遠い枠は別の文を作り直します。取り消した文は覚えておき、似た話題・型は作らないようにします。'
              : '「編集」で本文と投稿時刻を直せます。取り消すと、いちばん近い時刻の枠から、別の文を作り直して並べます（数十秒）。取り消した文は覚えておき、似た話題・型は作らないようにします。'}
        </p>
      )}
    </section>
  )

  function closeText() {
    if (reuse.trim() && !window.confirm('予約に加えていない文があります。閉じると消えます。閉じますか？')) return
    setTextOpen(false)
    setReuse('')
    setReuseMsg(undefined)
  }

  async function addReuse() {
    if (!reuse.trim() || reusing) return
    setReusing(true)
    setReuseMsg(undefined)
    try {
      const text = await addComposed(reuse.trim())
      setReuse('')
      setReuseMsg({ text, kind: 'ok' })
    } catch (err) {
      setReuseMsg({ text: errorOf(err), kind: 'err' })
    } finally {
      setReusing(false)
    }
  }

  if (variant === 'summary') {
    const ready = hasProfile && connected
    const waitingCount = upcoming.filter((p) => p.status === 'draft').length
    // 今日の投稿数（出した・出している・投稿可能）と、1日の上限。上限を超えて今日に入らないよう、画面で見えるようにする。
    const todayCount = postsOnDay(
      posts.filter((p) => isAutopilotPost(p.aiPrompt)).map((p) => ({ id: p.id, status: p.status, scheduledAt: p.scheduledAt })),
      Date.now(),
      { postsPerDay: state.settings.postsPerDay, timeZone: state.settings.timeZone }
    )
    // 自動運転のオンオフ。ディスコード・Yay の行と同じスイッチにそろえる。
    // 押している間（止める・始めるの返事待ち）は、押した先の向きで見せる（返事を待つと、スイッチが動くまで止まって見えた）。
    // 失敗したときは act が状態を取り直すので、元の向きに戻る。
    const toggleOn = busy === 'stop' ? false : busy === 'start' ? true : state.enabled
    const toggle = (
      <Toggle
        on={toggleOn}
        pending={busy === 'stop' || busy === 'start'}
        disabled={working || (!state.enabled && (!ready || blocked))}
        label="Xの自動運転"
        onClick={() => void (state.enabled ? doStop() : doStart())}
      />
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
        {/* すべてまとめて止める・再開する。トップのいちばん上の、主役のカード。 */}
        {channels && (
          <AllSwitch
            x={{
              enabled: state.enabled,
              ready,
              stop: () => runForAll('stop', () => stopAutopilot()),
              start: () => runForAll('start', saveThen(startAutopilot)),
            }}
            snapshots={channels.snapshots}
            onChanged={channels.onChanged}
          />
        )}
        {/* 予定は左の列（xap__main）、スイッチは右の列。 */}
        <div className="xap__main">
          {upcomingSection}
        </div>
        <section className="surface-card switch-list" aria-label="稼働スイッチ">
          <SwitchRow
            name="X"
            icon="x-logo"
            tone={state.enabled ? (state.lastError ? 'warn' : 'on') : 'off'}
            status={state.enabled ? `今日 ${todayCount}/${state.settings.postsPerDay}本${waitingCount > 0 ? ` ・ 確認待ち${waitingCount}件` : ''}` : ready ? '止まっています' : '先に、Xとの連携と文体のまとめが必要です'}
            note={state.enabled && state.lastError ? `補充を止めています: ${state.lastError}` : undefined}
            action={
              <>
                <TextButton name="X" onClick={() => setTextOpen(true)} />
                {!state.enabled && !ready && onOpenDetail ? setupButton : toggle}
              </>
            }
          />
          {children}
        </section>
        {textOpen && (
          <Sheet title="Xの文" onClose={closeText}>
            <section className="text-sheet__section" aria-label="いま出ている投稿">
              <h3 className="text-sheet__sub">いま出ている投稿</h3>
              {postedTexts[0] ? (
                <div className="text-sheet__current">
                  <span className="text-sheet__when">{whenLabel(postedTexts[0].at, state.settings.timeZone)}に投稿</span>
                  <p className="text-sheet__current-text">{postedTexts[0].text}</p>
                </div>
              ) : (
                <p className="autopost__empty">まだ投稿していません。</p>
              )}
            </section>

            <section className="text-sheet__section" aria-label="これから投稿される文">
              <h3 className="text-sheet__sub">これから投稿される文</h3>
              {upcoming.length === 0 ? (
                <p className="autopost__empty">まだありません。自動運転を始めると、ここに並びます。</p>
              ) : (
                // トップの予定と同じカード（編集・取り消す・投稿可能にする が同じように使える）
                <ul className="autopost__history xap__upcoming">{upcoming.map(renderPost)}</ul>
              )}
            </section>

            <section className="text-sheet__section" aria-label="文を予約に加える">
              <h3 className="text-sheet__sub">文を予約に加える</h3>
              <AutoTextarea
                value={reuse}
                onChange={(e) => setReuse(e.target.value)}
                aria-label="予約に加える文"
                placeholder="ここに書くか、下の「これまでに投稿した文」から「使う」で呼び出して直します"
              />
              {reuseMsg && (
                <p className={`autopost__msg autopost__msg--${reuseMsg.kind}`} role={reuseMsg.kind === 'err' ? 'alert' : 'status'}>
                  {reuseMsg.text}
                </p>
              )}
              <div className="text-sheet__actions">
                <button type="button" className="btn btn--primary" onClick={() => void addReuse()} disabled={!reuse.trim() || reusing}>
                  {reusing ? '加えています…' : '予約に加える'}
                </button>
              </div>
            </section>

            <section className="text-sheet__archive" aria-label="これまでに投稿した文">
              <h3 className="text-sheet__sub">これまでに投稿した文</h3>
              {postedTexts.length === 0 ? (
                <p className="autopost__empty">まだありません。</p>
              ) : (
                <ul className="text-sheet__history">
                  {postedTexts.map((p) => (
                    <li key={p.id}>
                      <span className="text-sheet__history-text">
                        <span className="text-sheet__when">{whenLabel(p.at, state.settings.timeZone)}</span>
                        {p.text}
                      </span>
                      <button
                        type="button"
                        className="btn btn--ghost btn--small"
                        aria-label={`「${p.text.slice(0, 20)}」を使う`}
                        onClick={() => {
                          setReuse(p.text)
                          setReuseMsg({ text: '「文を予約に加える」の欄に入れました。直してから「予約に加える」を押します。', kind: 'ok' })
                        }}
                      >
                        使う
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </Sheet>
        )}
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

      {/* 今月のAI料金。トップをシンプルにするため、2026-11-22 にトップからここへ移した。 */}
      <UsageMeter usage={state.usage} budgetYen={state.settings.monthlyBudgetYen} />

      <StyleInsights profile={state.profile} recentStyle={state.recentStyle} />
      <RejectedInsights rejected={rejectedTexts} kept={keptTexts} />

      <StyleCard
        state={state}
        quality={form.quality}
        busy={busy}
        step={step}
        working={working}
        connected={connected}
        blocked={blocked}
        onSetup={() => void doSetup()}
        onRefresh={() => void doRefreshStyle()}
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
            {form.requireApproval
              ? '確認待ちは1件ずつ作ります（投稿可能にする・取り消すと、次の1件を作ります）'
              : `1日${form.postsPerDay}回 × ${form.horizonDays}日先まで ＝ 予約は最大${form.postsPerDay * form.horizonDays}本が並びます`}
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

      <ComposeCard
        disabled={!hasProfile || blocked}
        onCompose={async (material, previous) => {
          const reply = await run('compose', () => composeAutopilotPost(material, previous))
          return reply.composed ?? { text: null, problems: ['AIが案を返しませんでした'] }
        }}
        onAdd={addComposed}
      />
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
  /** 最新の投稿を取り込み、そのまま文体に反映する。 */
  onRefresh: () => void
}

// 文体のまとめの中身（要約・語尾・話題）は、ここには出さない。本人の希望で、裏（Supabase の x_autopilot.profile）でだけ見られる。
function StyleCard({ state, quality, busy, step, working, connected, blocked, onSetup, onRefresh }: StyleCardProps) {
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
          <button type="button" className="btn btn--secondary" onClick={onRefresh} disabled={!connected || working || blocked}>
            {busy === 'refresh' ? (step ?? '実行しています…') : `最新の投稿を取り込んで、文体に反映する（約${formatYen(rebuildYen)}）`}
          </button>
        )}
      </div>
      {(busy === 'setup' || busy === 'refresh') && step && <p className="xap__muted">{step}</p>}
      {first && <p className="xap__muted">Xの自分の投稿（返信とリポストを除く最大200件）を読みます。読み取りは1件約0.15円です。</p>}
      {!first && <p className="xap__muted">前回より新しい投稿（返信・リポストを除く、1回で最大200件）を読んで、文体をまとめ直します。読み取りは1件約0.15円です。</p>}
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

import { useMemo, useState } from 'react'
import { useScheduledPosts } from '../../hooks/useScheduledPosts'
import { useXAutopilot } from '../../hooks/useXAutopilot'
import {
  buildAutopilotProfile,
  previewAutopilotPost,
  readAutopilotHistory,
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
import { deleteScheduledPost } from '../../lib/schedule/postsStore'
import { Icon } from '../Icon'

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

const zoneName = (timeZone: string) => (timeZone === 'Asia/Tokyo' ? '日本時間' : timeZone)

/** 1本書く費用の目安（円）。 */
const previewYen = (quality: Quality) => aiCostYen(quality, TYPICAL_TOKENS.postInput, TYPICAL_TOKENS.postOutput)

interface Notice {
  text: string
  kind: 'ok' | 'err'
}

const errorOf = (err: unknown) => (err instanceof Error ? err.message : String(err))

export function XAutopilotPanel() {
  const { state, loading, error, setupNeeded, busy, reload, run } = useXAutopilot(true)
  const { posts, reload: reloadPosts } = useScheduledPosts(true)
  const [edits, setEdits] = useState<Partial<AutopilotSettings>>({})
  const [notice, setNotice] = useState<Notice>()
  const [preview, setPreview] = useState<{ text: string | null; problems: string[] }>()
  const [step, setStep] = useState<string>()

  const upcoming = useMemo(
    () =>
      posts
        .filter((p) => isAutopilotPost(p.aiPrompt) && p.status === 'scheduled')
        .sort((a, b) => (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? '')),
    [posts]
  )

  if (setupNeeded) {
    return (
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
    return (
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
  if (loading || !state) return <p className="loading-indicator">読み込み中…</p>

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

  async function cancelOne(id: string) {
    const post = posts.find((p) => p.id === id)
    if (!post) return
    setNotice(undefined)
    try {
      await deleteScheduledPost(post)
      await reloadPosts()
    } catch (err) {
      setNotice({ text: errorOf(err), kind: 'err' })
    }
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

      <section aria-label="これから投稿される予定">
        <h2 className="autopost__sub">これから投稿される予定</h2>
        {upcoming.length === 0 ? (
          <p className="autopost__empty">まだありません。自動運転を始めると、ここに並びます。</p>
        ) : (
          <ul className="autopost__history xap__upcoming">
            {upcoming.map((post) => (
              <li key={post.id}>
                <span className="xap__when">{whenLabel(post.scheduledAt, state.settings.timeZone)}</span>
                <span className="autopost__history-text xap__upcoming-text">{post.segments[0]?.text}</span>
                <button type="button" className="btn btn--ghost btn--small btn--danger" onClick={() => void cancelOne(post.id)}>
                  <Icon name="trash" size={14} />
                  取り消す
                </button>
              </li>
            ))}
          </ul>
        )}
        {upcoming.length > 0 && (
          <p className="xap__muted">文を直したいときは、「予約投稿」タブでこの予約を開いてください。取り消した枠は作り直されません。</p>
        )}
      </section>
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

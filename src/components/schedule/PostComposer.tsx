import { useEffect, useRef, useState } from 'react'
import {
  createScheduledPost,
  deletePostMedia,
  signMediaUrl,
  updateScheduledPost,
  uploadPostMedia,
} from '../../lib/schedule/postsStore'
import { containsUrl, isOverLimit, MAX_WEIGHTED_LENGTH, weightedLength } from '../../lib/schedule/textLength'
import { registerEditingGuard } from '../../lib/editingGuard'
import type { PostSegment, RepeatRule, ScheduledPost } from '../../lib/schedule/types'
import { AI_EDIT_PRESETS, type AiEditRequest } from '../../lib/schedule/aiEdit'
import { AiAssistPanel } from './AiAssistPanel'
import { RepeatRuleEditor } from './RepeatRuleEditor'
import { Icon } from '../Icon'

const MAX_MEDIA_PER_SEGMENT = 4

interface Props {
  /** 編集対象。未指定なら新規作成。 */
  editing?: ScheduledPost
  onSaved: () => void
  onCancel: () => void
  /** AIがまとめて作った案を下書き保存したとき、一覧を取り直させる。 */
  onDraftsAdded?: () => void
  /**
   * 'inline' … 予約投稿タブの一覧の上に開く、これまでの形。
   * 'sheet'  … ＋から前面にかぶせて出す形（ComposerSheet が使う）。
   *            見出しと保存ボタンを上下に貼り付けて、長い本文でも操作を見失わないようにする。
   */
  variant?: 'inline' | 'sheet'
}

function emptySegment(): PostSegment {
  return { text: '', media: [] }
}

function toLocalInputValue(iso?: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 「8月28日（木）20:30 に投稿」のように読める形にする。 */
function describeScheduledAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const day = date.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' })
  const time = date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
  return `${day} ${time} に投稿します`
}

function fromLocalInputValue(value: string): string | undefined {
  if (!value) return undefined
  const ts = new Date(value).getTime()
  return Number.isNaN(ts) ? undefined : new Date(ts).toISOString()
}

export function PostComposer({
  editing,
  onSaved,
  onCancel,
  onDraftsAdded,
  variant = 'inline',
}: Props) {
  const [segments, setSegments] = useState<PostSegment[]>(
    () => editing?.segments ?? [emptySegment()]
  )
  const [scheduledAt, setScheduledAt] = useState(() => toLocalInputValue(editing?.scheduledAt))
  const [repeatRule, setRepeatRule] = useState<RepeatRule | undefined>(editing?.repeatRule)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string>()
  const fileInputRef = useRef<HTMLInputElement>(null)
  // 本文欄の下のボタンから、上のAIパネルへ渡す注文。
  const [aiEditRequest, setAiEditRequest] = useState<AiEditRequest>()
  const aiEditNonceRef = useRef(0)
  const uploadTargetRef = useRef(0)
  // この画面で新しく上げた画像のパス。保存せずに外した場合だけStorageから消す。
  // 保存済みの投稿から外した画像を即座に消してしまうと、「編集したが保存せずに閉じた」
  // ときに元の投稿から画像だけが失われてしまう。
  const freshlyUploadedRef = useRef<Set<string>>(new Set())

  // どの投稿を開いているか。予約投稿タブでは一覧の上にコンポーザーを出したまま
  // 別の投稿の「編集」を押せるので、editing だけが差し替わって再マウントされない。
  // useState の初期値はそのとき読み直されないため、本文が前の対象のまま残り、
  // そのまま保存すると開いたはずの投稿を空の本文で上書きしてしまう。
  // props が変わったら描画中にそろえる（Reactが推奨する、派生stateの作り直し方）。
  const [openedId, setOpenedId] = useState(editing?.id)
  if (openedId !== editing?.id) {
    setOpenedId(editing?.id)
    setSegments(editing?.segments ?? [emptySegment()])
    setScheduledAt(toLocalInputValue(editing?.scheduledAt))
    setRepeatRule(editing?.repeatRule)
    setError(undefined)
  }

  // 保存済みの画像はパスしか持っていないので、表示用の署名付きURLを取り直す。
  useEffect(() => {
    let cancelled = false
    const missing = segments.some((s) => s.media.some((m) => !m.previewUrl))
    if (!missing) return

    void (async () => {
      const next = await Promise.all(
        segments.map(async (segment) => ({
          ...segment,
          media: await Promise.all(
            segment.media.map(async (media) =>
              media.previewUrl ? media : { ...media, previewUrl: await signMediaUrl(media.path) }
            )
          ),
        }))
      )
      if (!cancelled) setSegments(next)
    })()
    return () => {
      cancelled = true
    }
    // segments全体を依存に入れると署名のたびに再実行されるため、件数の変化だけを見る。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments.length, segments.map((s) => s.media.length).join(',')])

  // 保存せずに閉じた（あるいは別の投稿へ移った）ときの後始末。
  // 画像はStorageへ先に上げてしまうので、そのまま閉じると本文から参照されない
  // ファイルだけが残り続ける（本人が消す手段も画面上にない）。
  // 保存できた時点で freshlyUploadedRef は空にしてあるので、ここで消えるのは
  // 「上げたが保存しなかった」ぶんだけ。
  useEffect(() => {
    const pending = freshlyUploadedRef.current
    return () => {
      for (const path of pending) void deletePostMedia(path)
      pending.clear()
    }
  }, [openedId])

  // 書きかけの本文があるあいだは、更新バナーの自動リロードを待たせる。
  // ここで書いた文章はサーバーにも端末にも残らないので、読み込み直すと消えてしまう。
  const draftRef = useRef(false)
  draftRef.current = segments.some((s) => s.text.trim() || s.media.length > 0)
  useEffect(() => registerEditingGuard(() => draftRef.current), [])

  function updateSegment(index: number, patch: Partial<PostSegment>) {
    setSegments((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)))
  }

  function addSegment() {
    setSegments((prev) => [...prev, emptySegment()])
  }

  function discardMediaIfUnsaved(path: string) {
    if (!freshlyUploadedRef.current.has(path)) return
    freshlyUploadedRef.current.delete(path)
    void deletePostMedia(path)
  }

  function removeSegment(index: number) {
    for (const media of segments[index].media) discardMediaIfUnsaved(media.path)
    setSegments((prev) => (prev.length === 1 ? [emptySegment()] : prev.filter((_, i) => i !== index)))
  }

  /**
   * AIが作った案を本文欄へ流し込む。
   * 添付済みの画像は本文とは別に選んだものなので、位置が対応する分はそのまま残す。
   * 案が短くなって行き場を失った画像のうち、この画面で上げただけのものは消す
   * （保存済みの投稿から来た画像は、保存せず閉じたときに失われないよう残す）。
   */
  function applyGenerated(generated: PostSegment[]) {
    for (let i = generated.length; i < segments.length; i += 1) {
      for (const media of segments[i].media) discardMediaIfUnsaved(media.path)
    }
    setSegments(
      generated.map((segment, index) => ({ text: segment.text, media: segments[index]?.media ?? [] }))
    )
  }

  /**
   * 本文欄の下から、AIへの手直しを頼む。
   * 頼みたくなるのは本文を書き終えた瞬間なので、そこから上のパネルまで戻って
   * 指示を打ち込ませない。押した内容をそのまま指示にして生成まで進める。
   */
  function requestAiEdit(message: string) {
    aiEditNonceRef.current += 1
    setAiEditRequest({ message, nonce: aiEditNonceRef.current })
  }

  function openFilePicker(segmentIndex: number) {
    uploadTargetRef.current = segmentIndex
    fileInputRef.current?.click()
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const index = uploadTargetRef.current
    const room = MAX_MEDIA_PER_SEGMENT - segments[index].media.length
    if (room <= 0) {
      setError(`1つの投稿に添付できる画像は${MAX_MEDIA_PER_SEGMENT}枚までです`)
      return
    }

    setUploading(true)
    setError(undefined)
    try {
      const picked = Array.from(files).slice(0, room)
      const uploaded = await Promise.all(
        picked.map(async (file) => {
          const { path, mime } = await uploadPostMedia(file)
          freshlyUploadedRef.current.add(path)
          return { path, mime, previewUrl: await signMediaUrl(path) }
        })
      )
      setSegments((prev) =>
        prev.map((s, i) => (i === index ? { ...s, media: [...s.media, ...uploaded] } : s))
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function removeMedia(segmentIndex: number, path: string) {
    discardMediaIfUnsaved(path)
    setSegments((prev) =>
      prev.map((s, i) =>
        i === segmentIndex ? { ...s, media: s.media.filter((m) => m.path !== path) } : s
      )
    )
  }

  // AIおまかせの繰り返しでは、本文はサーバー側で毎回書かれる。
  // ここに本文欄やAI下書きを残しておくと、書いても投稿には一切使われないものを
  // 書かせることになるので、まとめて隠す。
  const aiWrites = !!repeatRule?.autoGenerate
  const hasText = segments.some((s) => s.text.trim())
  const filled = segments.filter((s) => s.text.trim() || s.media.length > 0)
  const overLimit = !aiWrites && segments.some((s) => isOverLimit(s.text))
  const hasUrl = !aiWrites && segments.some((s) => containsUrl(s.text))

  async function save(mode: 'draft' | 'schedule') {
    setError(undefined)
    if (aiWrites) {
      if (!repeatRule?.aiTopic?.trim()) {
        setError('AIに何について書いてもらうかを入力してください')
        return
      }
    } else {
      if (filled.length === 0) {
        setError('本文を入力してください')
        return
      }
      if (overLimit) {
        setError('文字数の上限を超えている投稿があります')
        return
      }
    }

    const iso = fromLocalInputValue(scheduledAt)
    if (mode === 'schedule') {
      if (!repeatRule && !iso) {
        setError('投稿する日時を指定してください')
        return
      }
      if (!repeatRule && iso && new Date(iso).getTime() <= Date.now()) {
        setError('現在より後の日時を指定してください')
        return
      }
    }

    setSaving(true)
    try {
      // 繰り返し予約はテンプレート行として保存し、実体は各回サーバー側で作られる。
      const payload = {
        segments: filled,
        scheduledAt: repeatRule ? undefined : iso,
        repeatRule,
      }
      if (editing) {
        await updateScheduledPost(editing.id, {
          ...payload,
          scheduledAt: payload.scheduledAt ?? null,
          repeatRule: repeatRule ?? null,
          status: mode === 'draft' ? 'draft' : 'scheduled',
          clearError: true,
        })
      } else {
        await createScheduledPost({ ...payload, status: mode === 'draft' ? 'draft' : 'scheduled' })
      }
      // 保存できた時点で、これらの画像は投稿から参照される正式なものになる。
      freshlyUploadedRef.current.clear()
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={variant === 'sheet' ? 'composer composer--sheet' : 'composer'}>
      {/* かぶせて出すシートでは、見出しと×は写真のカバー側（ComposerSheet）にある。
          ここにも出すと同じものが2つ並ぶ。 */}
      {variant !== 'sheet' && (
        <div className="composer__header">
          <h3>{editing ? '予約を編集' : '新しい投稿'}</h3>
          <button type="button" className="btn btn--icon" onClick={onCancel} aria-label="閉じる">
            <Icon name="close" />
          </button>
        </div>
      )}

      {!aiWrites && (
        <AiAssistPanel
          currentText={segments.map((s) => s.text).join('\n\n')}
          editRequest={aiEditRequest}
          onUse={applyGenerated}
          onSavedDrafts={() => onDraftsAdded?.()}
        />
      )}

      {aiWrites && (
        <p className="composer__ai-writes">
          <Icon name="sparkles" size={16} />
          本文は投稿のたびにAIが書きます。下の「何について書くか」だけ決めてください。
        </p>
      )}

      {!aiWrites && segments.map((segment, index) => {
        const used = weightedLength(segment.text)
        const remaining = MAX_WEIGHTED_LENGTH - used
        const ratio = Math.min(used / MAX_WEIGHTED_LENGTH, 1)
        // 数字を読む前に「まだ余裕があるか」が分かるようにバーで示す。
        const meterTone =
          remaining < 0 ? ' composer__meter-fill--over' : remaining <= 20 ? ' composer__meter-fill--warn' : ''
        return (
          <div key={index} className="composer__segment">
            {segments.length > 1 && (
              <div className="composer__segment-head">
                <span className="composer__segment-index">{index + 1}件目</span>
                <button
                  type="button"
                  className="btn btn--ghost btn--small"
                  onClick={() => removeSegment(index)}
                >
                  削除
                </button>
              </div>
            )}
            <textarea
              className="composer__textarea"
              value={segment.text}
              onChange={(e) => updateSegment(index, { text: e.target.value })}
              placeholder={index === 0 ? 'いまどうしてる？' : '続きを書く…'}
              rows={4}
            />
            <div className="composer__meter">
              <div
                className={`composer__meter-fill${meterTone}`}
                style={{ width: `${ratio * 100}%` }}
              />
            </div>
            <div className="composer__segment-foot">
              <button
                type="button"
                className="btn btn--ghost btn--small"
                onClick={() => openFilePicker(index)}
                disabled={uploading || segment.media.length >= MAX_MEDIA_PER_SEGMENT}
              >
                <Icon name="image" size={16} />
                画像を追加
              </button>
              {/* 「あと何文字」より「いま何文字」の方が、Xの投稿欄と同じ読み方になる。 */}
              <span className={remaining < 0 ? 'composer__count composer__count--over' : 'composer__count'}>
                {used} / {MAX_WEIGHTED_LENGTH}
              </span>
            </div>
            {segment.media.length > 0 && (
              <div className="composer__media">
                {segment.media.map((media) => (
                  <div key={media.path} className="composer__media-item">
                    {media.previewUrl ? (
                      <img src={media.previewUrl} alt="" />
                    ) : (
                      <div className="composer__media-placeholder">読み込み中…</div>
                    )}
                    <button
                      type="button"
                      className="composer__media-remove"
                      onClick={() => removeMedia(index, media.path)}
                      aria-label="画像を削除"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {/* 追加枠。1枚も無いうちは上の「画像を追加」だけを出す
                    （アイコンだけの入口を唯一の手段にしないため）。 */}
                {segment.media.length < MAX_MEDIA_PER_SEGMENT && (
                  <button
                    type="button"
                    className="composer__media-add"
                    onClick={() => openFilePicker(index)}
                    disabled={uploading}
                    aria-label="画像を追加"
                  >
                    <Icon name="plus" size={20} />
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}

      {/* 本文が空のうちは出さない。手直しは書いたあとの操作で、
          何もない状態で並んでいても押しようがない。 */}
      {!aiWrites && hasText && (
        <div className="composer__ai-edit">
          <span className="composer__ai-edit-label">
            <Icon name="sparkles" size={14} />
            書いた文をAIに手直ししてもらう
          </span>
          <div className="composer__ai-edit-chips">
            {AI_EDIT_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className="composer__ai-edit-chip"
                onClick={() => requestAiEdit(preset.message)}
              >
                {preset.label}
              </button>
            ))}
            <button
              type="button"
              className="composer__ai-edit-chip composer__ai-edit-chip--own"
              onClick={() => requestAiEdit('')}
            >
              自分で伝える
            </button>
          </div>
        </div>
      )}

      {!aiWrites && (
        <button type="button" className="btn btn--ghost btn--small composer__add-segment" onClick={addSegment}>
          <Icon name="thread" size={16} />
          スレッドに追加（連投）
        </button>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        hidden
        onChange={(e) => void handleFiles(e.target.files)}
      />

      <div className="composer__schedule">
        <label className="composer__field">
          <span>投稿日時</span>
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            disabled={!!repeatRule}
          />
        </label>
        {/* datetime-local の表示はブラウザの言語設定に従うので、環境によっては
            mm/dd/yyyy のまま。指定した日時が伝わるよう、日本語の形を1行添える。
            保存する値は入力欄のもの（既存のデータ形式）をそのまま使う。 */}
        {!repeatRule && scheduledAt && (
          <p className="composer__schedule-readable">{describeScheduledAt(scheduledAt)}</p>
        )}
        <RepeatRuleEditor value={repeatRule} onChange={setRepeatRule} />
      </div>

      {hasUrl && (
        <p className="composer__warning">
          本文にURLが含まれています。X APIではURL入りの投稿は1件$0.20（通常の投稿は$0.015）になります。
        </p>
      )}
      {error && <p className="composer__error">{error}</p>}

      <div className="composer__actions">
        <button type="button" className="btn btn--ghost" onClick={() => void save('draft')} disabled={saving}>
          下書き保存
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => void save('schedule')}
          disabled={saving || overLimit}
        >
          <Icon name={repeatRule ? 'repeat' : 'send'} size={16} />
          {saving ? '保存中…' : aiWrites ? 'AIにまかせて予約する' : repeatRule ? '繰り返し予約する' : '予約する'}
        </button>
      </div>
    </div>
  )
}

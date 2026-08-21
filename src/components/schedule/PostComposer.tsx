import { useEffect, useRef, useState } from 'react'
import {
  createScheduledPost,
  deletePostMedia,
  signMediaUrl,
  updateScheduledPost,
  uploadPostMedia,
} from '../../lib/schedule/postsStore'
import { containsUrl, isOverLimit, MAX_WEIGHTED_LENGTH, weightedLength } from '../../lib/schedule/textLength'
import type { PostSegment, RepeatRule, ScheduledPost } from '../../lib/schedule/types'
import { RepeatRuleEditor } from './RepeatRuleEditor'

const MAX_MEDIA_PER_SEGMENT = 4

interface Props {
  /** 編集対象。未指定なら新規作成。 */
  editing?: ScheduledPost
  /** AI生成から流し込まれた初期本文。 */
  initialSegments?: PostSegment[]
  onSaved: () => void
  onCancel: () => void
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

function fromLocalInputValue(value: string): string | undefined {
  if (!value) return undefined
  const ts = new Date(value).getTime()
  return Number.isNaN(ts) ? undefined : new Date(ts).toISOString()
}

export function PostComposer({ editing, initialSegments, onSaved, onCancel }: Props) {
  const [segments, setSegments] = useState<PostSegment[]>(
    () => editing?.segments ?? initialSegments ?? [emptySegment()]
  )
  const [scheduledAt, setScheduledAt] = useState(() => toLocalInputValue(editing?.scheduledAt))
  const [repeatRule, setRepeatRule] = useState<RepeatRule | undefined>(editing?.repeatRule)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string>()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadTargetRef = useRef(0)
  // この画面で新しく上げた画像のパス。保存せずに外した場合だけStorageから消す。
  // 保存済みの投稿から外した画像を即座に消してしまうと、「編集したが保存せずに閉じた」
  // ときに元の投稿から画像だけが失われてしまう。
  const freshlyUploadedRef = useRef<Set<string>>(new Set())

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

  const filled = segments.filter((s) => s.text.trim() || s.media.length > 0)
  const overLimit = segments.some((s) => isOverLimit(s.text))
  const hasUrl = segments.some((s) => containsUrl(s.text))

  async function save(mode: 'draft' | 'schedule') {
    setError(undefined)
    if (filled.length === 0) {
      setError('本文を入力してください')
      return
    }
    if (overLimit) {
      setError('文字数の上限を超えている投稿があります')
      return
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
    <div className="composer">
      <div className="composer__header">
        <h3>{editing ? '予約を編集' : '新しい投稿'}</h3>
        <button type="button" className="btn btn--ghost" onClick={onCancel}>
          閉じる
        </button>
      </div>

      {segments.map((segment, index) => {
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
                画像を追加
              </button>
              <span className={remaining < 0 ? 'composer__count composer__count--over' : 'composer__count'}>
                {remaining}
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
              </div>
            )}
          </div>
        )
      })}

      <button type="button" className="btn btn--ghost btn--small composer__add-segment" onClick={addSegment}>
        ＋ スレッドに追加（連投）
      </button>

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
          {saving ? '保存中…' : repeatRule ? '繰り返し予約する' : '予約する'}
        </button>
      </div>
    </div>
  )
}

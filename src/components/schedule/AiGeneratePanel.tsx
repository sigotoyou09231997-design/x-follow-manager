import { useState } from 'react'
import { generatePosts, type GeneratedPost } from '../../lib/schedule/api'
import { createScheduledPosts } from '../../lib/schedule/postsStore'
import { weightedLength, MAX_WEIGHTED_LENGTH } from '../../lib/schedule/textLength'
import type { PostSegment } from '../../lib/schedule/types'

interface Props {
  onSaved: () => void
  /** 選んだ案を編集画面で開く。 */
  onEdit: (segments: PostSegment[]) => void
}

function toSegments(post: GeneratedPost): PostSegment[] {
  return post.segments.map((text) => ({ text, media: [] }))
}

/** AIに投稿案をまとめて作らせるパネル。生成結果から選んで下書きに落とす。 */
export function AiGeneratePanel({ onSaved, onEdit }: Props) {
  const [topic, setTopic] = useState('')
  const [tone, setTone] = useState('')
  const [count, setCount] = useState(3)
  const [mode, setMode] = useState<'single' | 'thread'>('single')
  const [threadLength, setThreadLength] = useState(3)
  const [results, setResults] = useState<GeneratedPost[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()

  async function handleGenerate() {
    if (!topic.trim()) {
      setError('何について投稿するかを入力してください')
      return
    }
    setGenerating(true)
    setError(undefined)
    setResults([])
    setSelected(new Set())
    try {
      const posts = await generatePosts({
        topic,
        count,
        mode,
        threadLength,
        tone: tone.trim() || undefined,
      })
      setResults(posts)
      // 生成直後は全部選択済みにしておく。いらないものだけ外す方が早い。
      setSelected(new Set(posts.map((_, i) => i)))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setGenerating(false)
    }
  }

  function toggle(index: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  async function saveSelected() {
    const picked = results.filter((_, i) => selected.has(i))
    if (picked.length === 0) {
      setError('保存する案を選んでください')
      return
    }
    setSaving(true)
    setError(undefined)
    try {
      await createScheduledPosts(
        picked.map((post) => ({
          segments: toSegments(post),
          status: 'draft' as const,
          aiPrompt: topic,
        }))
      )
      setResults([])
      setSelected(new Set())
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="ai-panel">
      <h3 className="ai-panel__title">AIに投稿案を作ってもらう</h3>

      <label className="ai-panel__field">
        <span>何について投稿する？</span>
        <textarea
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          rows={3}
          placeholder="例: 個人開発でWebアプリを作った話。技術より、続けるための工夫を中心に。"
        />
      </label>

      <label className="ai-panel__field">
        <span>文体の指定（任意）</span>
        <input
          type="text"
          value={tone}
          onChange={(e) => setTone(e.target.value)}
          placeholder="例: 敬語すぎず、淡々と。絵文字なし。"
        />
      </label>

      <div className="ai-panel__options">
        <label className="ai-panel__field ai-panel__field--inline">
          <span>形式</span>
          <select value={mode} onChange={(e) => setMode(e.target.value as 'single' | 'thread')}>
            <option value="single">単発の投稿</option>
            <option value="thread">スレッド（連投）</option>
          </select>
        </label>
        <label className="ai-panel__field ai-panel__field--inline">
          <span>案の数</span>
          <input
            type="number"
            min={1}
            max={10}
            value={count}
            onChange={(e) => setCount(Math.min(10, Math.max(1, Number(e.target.value) || 1)))}
          />
        </label>
        {mode === 'thread' && (
          <label className="ai-panel__field ai-panel__field--inline">
            <span>1本の投稿数</span>
            <input
              type="number"
              min={2}
              max={10}
              value={threadLength}
              onChange={(e) => setThreadLength(Math.min(10, Math.max(2, Number(e.target.value) || 2)))}
            />
          </label>
        )}
      </div>

      <button
        type="button"
        className="btn btn--primary"
        onClick={() => void handleGenerate()}
        disabled={generating}
      >
        {generating ? '作成中…' : '投稿案を作る'}
      </button>

      {error && <p className="ai-panel__error">{error}</p>}

      {results.length > 0 && (
        <div className="ai-panel__results">
          <p className="ai-panel__results-head">
            {results.length}件の案ができました。使うものを選んで下書きに保存できます。
          </p>
          {results.map((post, index) => (
            <div
              key={index}
              className={selected.has(index) ? 'ai-result ai-result--on' : 'ai-result'}
            >
              <label className="ai-result__check">
                <input type="checkbox" checked={selected.has(index)} onChange={() => toggle(index)} />
                <span className="ai-result__note">{post.note}</span>
              </label>
              <div className="ai-result__body">
                {post.segments.map((text, segIndex) => {
                  const over = weightedLength(text) > MAX_WEIGHTED_LENGTH
                  return (
                    <div key={segIndex} className="ai-result__segment">
                      {post.segments.length > 1 && (
                        <span className="ai-result__segment-index">{segIndex + 1}</span>
                      )}
                      <p className={over ? 'ai-result__text ai-result__text--over' : 'ai-result__text'}>
                        {text}
                      </p>
                    </div>
                  )
                })}
              </div>
              <button
                type="button"
                className="btn btn--ghost btn--small"
                onClick={() => onEdit(toSegments(post))}
              >
                編集して予約
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => void saveSelected()}
            disabled={saving}
          >
            {saving ? '保存中…' : `選んだ${selected.size}件を下書きに保存`}
          </button>
        </div>
      )}
    </div>
  )
}

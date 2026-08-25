import { useState } from 'react'
import { generatePosts, type GeneratedPost } from '../../lib/schedule/api'
import { createScheduledPosts } from '../../lib/schedule/postsStore'
import { weightedLength, MAX_WEIGHTED_LENGTH } from '../../lib/schedule/textLength'
import type { PostSegment } from '../../lib/schedule/types'
import { Icon } from '../Icon'

interface Props {
  /**
   * いま本文欄にある文章。AIへ「現在の本文」として渡すので、
   * 追加の指示に「もっと短く」「後半だけ書き直して」のような指示語が使える。
   */
  currentText?: string
  /** 選んだ案を本文欄へ流し込む。 */
  onUse: (segments: PostSegment[]) => void
  /** 案をまとめて下書き保存したあと、一覧を取り直させる。 */
  onSavedDrafts: () => void
}

function toSegments(post: GeneratedPost): PostSegment[] {
  return post.segments.map((text) => ({ text, media: [] }))
}

/**
 * コンポーザーに内蔵するAI下書き支援。
 * 以前は「新しい投稿」とは別のパネルに分かれていたが、そうすると
 * 「AIで作る → 下書きに保存 → 一覧から開き直して日時を付ける」と往復が必要で、
 * さらに本文を書きかけてから助けを借りることもできなかった。
 * 本文欄と同じ画面に置くことで、生成→手直し→予約が1画面で完結する。
 *
 * 入力は「AIに伝えたいこと」1つだけにしている。以前は お題 / 文体 / 追加の指示 と
 * 3つに分かれていたが、書きたいことを頭の中で3つに仕分けてから書く必要があり、
 * 「言いたいことはあるのにどの欄に書けばいいか分からない」で止まりやすかった。
 * 思いついた順のメモをそのまま1か所に流し込めば、あとはAI側が仕分ける。
 */
export function AiAssistPanel({ currentText, onUse, onSavedDrafts }: Props) {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [count, setCount] = useState(3)
  const [mode, setMode] = useState<'single' | 'thread'>('single')
  const [threadLength, setThreadLength] = useState(3)
  const [results, setResults] = useState<GeneratedPost[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()

  const hasCurrentText = !!currentText?.trim()

  async function handleGenerate() {
    if (!message.trim()) {
      setError('AIに伝えたいことを入力してください')
      return
    }
    setGenerating(true)
    setError(undefined)
    setResults([])
    setSelected(new Set())
    try {
      const posts = await generatePosts({
        message,
        count,
        mode,
        threadLength,
        // 書きかけの本文があれば渡す。「これをもっと短く」の「これ」の参照先になる。
        currentText: currentText?.trim() || undefined,
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

  /** 案を本文欄へ流し込む。結果は残しておき、気に入らなければ別の案を試せるようにする。 */
  function use(post: GeneratedPost) {
    onUse(toSegments(post))
  }

  /** まとめて作った案を、日時を決めずに下書きとして貯めておく用。 */
  async function saveSelectedAsDrafts() {
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
          aiPrompt: message,
        }))
      )
      setResults([])
      setSelected(new Set())
      onSavedDrafts()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className={`ai-assist${open ? ' ai-assist--open' : ''}`}>
      <button
        type="button"
        className="ai-assist__toggle"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        <Icon name="sparkles" size={16} />
        <span className="ai-assist__toggle-label">
          {hasCurrentText ? 'AIに書き直してもらう' : 'AIに書いてもらう'}
        </span>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} />
      </button>

      {open && (
        <div className="ai-assist__body">
          <label className="ai-assist__field">
            <span>AIに伝えたいこと</span>
            <textarea
              className="ai-assist__message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={6}
              // 説明は下のヒントが担当し、ここは書き出しの見本だけにする。
              // 長くすると欄からはみ出して途中で切れ、かえって読めなくなる。
              placeholder={
                hasCurrentText
                  ? '例:\nもっと短く、結論から\n最後の一文はいらない\n淡々とした感じに'
                  : '例:\n3か月作ってたアプリをやっと出した\n一番手こずったのは通知まわり\n誰にも言わずに作ってたので反応が怖い\n淡々と、絵文字なしで'
              }
            />
          </label>

          <p className="ai-assist__hint">
            {hasCurrentText
              ? 'いま本文欄にある文章もAIへ渡すので、「これをもっと短く」のような書き方が使えます。文体の希望も同じ欄にどうぞ。'
              : '思いついた順のメモや箇条書きのままで大丈夫です。文体や長さの希望も同じ欄に書けます。書いていないことをAIが勝手に足すことはありません。'}
          </p>

          <div className="ai-assist__options">
            <label className="ai-assist__field ai-assist__field--inline">
              <span>形式</span>
              <select value={mode} onChange={(e) => setMode(e.target.value as 'single' | 'thread')}>
                <option value="single">単発の投稿</option>
                <option value="thread">スレッド（連投）</option>
              </select>
            </label>
            <label className="ai-assist__field ai-assist__field--inline">
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
              <label className="ai-assist__field ai-assist__field--inline">
                <span>1本の投稿数</span>
                <input
                  type="number"
                  min={2}
                  max={10}
                  value={threadLength}
                  onChange={(e) =>
                    setThreadLength(Math.min(10, Math.max(2, Number(e.target.value) || 2)))
                  }
                />
              </label>
            )}
          </div>

          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => void handleGenerate()}
            disabled={generating}
          >
            <Icon name="sparkles" size={16} />
            {generating ? '書いています…' : results.length > 0 ? '書き直してもらう' : 'この内容で書いてもらう'}
          </button>

          {error && <p className="ai-assist__error">{error}</p>}

          {results.length > 0 && (
            <div className="ai-assist__results">
              <p className="ai-assist__results-head">
                伝えたいことから{results.length}件の案を書きました。「本文に使う」で下の本文欄へ入り、そのまま日時を付けて予約できます。
              </p>
              {results.map((post, index) => (
                <div
                  key={index}
                  className={selected.has(index) ? 'ai-result ai-result--on' : 'ai-result'}
                >
                  <label className="ai-result__check">
                    <input
                      type="checkbox"
                      checked={selected.has(index)}
                      onChange={() => toggle(index)}
                    />
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
                          <p
                            className={
                              over ? 'ai-result__text ai-result__text--over' : 'ai-result__text'
                            }
                          >
                            {text}
                          </p>
                        </div>
                      )
                    })}
                  </div>
                  <button
                    type="button"
                    className="btn btn--primary btn--small"
                    onClick={() => use(post)}
                  >
                    <Icon name="arrow-down" size={16} />
                    本文に使う
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn btn--ghost btn--small"
                onClick={() => void saveSelectedAsDrafts()}
                disabled={saving}
              >
                {saving ? '保存中…' : `選んだ${selected.size}件を下書きに貯める`}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

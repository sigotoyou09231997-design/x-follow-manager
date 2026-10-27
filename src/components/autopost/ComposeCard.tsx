import { useState } from 'react'
import { MAX_WEIGHTED_LENGTH, weightedLength } from '../../lib/schedule/textLength'

interface Props {
  disabled: boolean
  /** 材料から1本書いてもらう（保存はしない）。previous は、同じ材料で書き直すときの前の案。 */
  /** この文を自動投稿の予約に加える。日付・時刻は自動で決まる。成功したら画面に出す案内文を返す。 */
  onAdd?: (text: string) => Promise<string>
  onCompose: (material: string, previous?: string) => Promise<{ text: string | null; problems: string[] }>
}

const MAX_MATERIAL = 400

/**
 * 入れた単語・文章を材料に、AIが本人の文体で1本書く欄。書いただけでは予約に入れず、「自動投稿に追加」を押したときだけ入れる
 * （押していない予約を自動で動かさない決まりのため）。
 */
export function ComposeCard({ disabled, onCompose, onAdd }: Props) {
  const [material, setMaterial] = useState('')
  const [result, setResult] = useState<{ text: string | null; problems: string[] }>()
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string>()
  const [copied, setCopied] = useState(false)
  const [added, setAdded] = useState<string>()

  const write = async (again: boolean) => {
    setWorking(true)
    setError(undefined)
    setCopied(false)
    setAdded(undefined)
    try {
      setResult(await onCompose(material, again ? (result?.text ?? undefined) : undefined))
    } catch (e) {
      setError(e instanceof Error ? e.message : '書けませんでした')
    } finally {
      setWorking(false)
    }
  }

  const add = async () => {
    if (!result?.text || !onAdd) return
    setWorking(true)
    setError(undefined)
    try {
      setAdded(await onAdd(result.text))
    } catch (e) {
      setError(e instanceof Error ? e.message : '追加できませんでした')
    } finally {
      setWorking(false)
    }
  }

  const copy = async () => {
    if (!result?.text) return
    try {
      await navigator.clipboard.writeText(result.text)
      setCopied(true)
    } catch {
      setError('コピーできませんでした。文を長押しして選んでください')
    }
  }

  return (
    <section className="surface-card xap__card xap__compose" aria-label="言葉から書く">
      <h2 className="xap__title">言葉から書く</h2>
      <label className="xap__field">
        <span>入れたい単語や文章</span>
        <textarea
          value={material}
          onChange={(e) => setMaterial(e.target.value)}
          rows={3}
          maxLength={MAX_MATERIAL}
          placeholder="例: 昼ごはん カレー 辛すぎた"
          aria-label="材料になる単語や文章"
        />
      </label>
      <div className="autopost__actions">
        <button type="button" className="btn btn--secondary" onClick={() => void write(false)} disabled={disabled || working || !material.trim()}>
          {working ? '書いています…' : '文章にする'}
        </button>
      </div>
      {error && (
        <p className="autopost__msg autopost__msg--err" role="alert">
          {error}
        </p>
      )}
      {result && (
        <div className="xap__preview" aria-live="polite">
          {result.text ? (
            <>
              <p className="xap__preview-text">{result.text}</p>
              <p className="xap__muted">
                {weightedLength(result.text)} / {MAX_WEIGHTED_LENGTH}
              </p>
              {added && <p className="autopost__msg autopost__msg--ok" role="status">{added}</p>}
              {result.problems.length > 0 && <p className="xap__warn">この案には問題があります（{result.problems.join('、')}）。</p>}
              <div className="autopost__actions">
                {onAdd && (
                  <button type="button" className="btn btn--small btn--primary" onClick={() => void add()} disabled={disabled || working || added !== undefined}>
                    {added !== undefined ? '追加しました' : '自動投稿に追加'}
                  </button>
                )}
                <button type="button" className="btn btn--small" onClick={() => void copy()}>
                  {copied ? 'コピーしました' : 'コピー'}
                </button>
                <button type="button" className="btn btn--small btn--ghost" onClick={() => void write(true)} disabled={disabled || working}>
                  別の書き方にする
                </button>
              </div>
            </>
          ) : (
            <p className="xap__muted">AIが書けませんでした。もう一度お試しください。</p>
          )}
        </div>
      )}
    </section>
  )
}

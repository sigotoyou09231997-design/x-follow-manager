import { useState } from 'react'
import { MAX_WEIGHTED_LENGTH, weightedLength } from '../../lib/schedule/textLength'

interface Props {
  disabled: boolean
  /** 材料から1本書いてもらう（保存はしない）。previous は、同じ材料で書き直すときの前の案。 */
  onCompose: (material: string, previous?: string) => Promise<{ text: string | null; problems: string[] }>
}

const MAX_MATERIAL = 400

/**
 * 入れた単語・文章を材料に、AIが本人の文体で1本書く欄。予約には入れない（案を見て、気に入ればコピーして使う）。
 * 予約に勝手に入れると、「押していない予約は動かさない」の決まりに反するため。
 */
export function ComposeCard({ disabled, onCompose }: Props) {
  const [material, setMaterial] = useState('')
  const [result, setResult] = useState<{ text: string | null; problems: string[] }>()
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string>()
  const [copied, setCopied] = useState(false)

  const write = async (again: boolean) => {
    setWorking(true)
    setError(undefined)
    setCopied(false)
    try {
      setResult(await onCompose(material, again ? (result?.text ?? undefined) : undefined))
    } catch (e) {
      setError(e instanceof Error ? e.message : '書けませんでした')
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
              {result.problems.length > 0 && <p className="xap__warn">この案には問題があります（{result.problems.join('、')}）。</p>}
              <div className="autopost__actions">
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

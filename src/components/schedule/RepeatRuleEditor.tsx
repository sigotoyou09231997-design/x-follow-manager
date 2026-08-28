import type { RepeatFreq, RepeatRule } from '../../lib/schedule/types'
import { AI_TOPIC_PRESETS } from '../../lib/schedule/aiTopics'
import { Icon } from '../Icon'

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

interface Props {
  value?: RepeatRule
  onChange: (rule: RepeatRule | undefined) => void
}

function defaultRule(): RepeatRule {
  return {
    // 繰り返しを使う目的のほとんどが「毎日出す」ことなので、開いた時点でその形にしておく。
    freq: 'daily',
    interval: 1,
    byWeekday: [new Date().getDay()],
    time: '09:00',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }
}

/**
 * 「毎日9時」のような繰り返し予約の設定。ONにすると単発の日時指定は無効になる。
 *
 * さらに「AIにおまかせ」をONにすると、毎回の本文をその都度AIが書く。
 * これが無いと繰り返しは毎回まったく同じ文面を投稿するので、毎日続けると
 * 同じ投稿が並ぶだけになる。
 */
export function RepeatRuleEditor({ value, onChange }: Props) {
  const rule = value

  function patch(next: Partial<RepeatRule>) {
    if (!rule) return
    onChange({ ...rule, ...next })
  }

  function toggleWeekday(day: number) {
    if (!rule) return
    const current = rule.byWeekday ?? []
    const next = current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort()
    // 全部外すと投稿されなくなるため、最低1つは残す。
    patch({ byWeekday: next.length > 0 ? next : current })
  }

  return (
    <div className="repeat-editor">
      <label className="repeat-editor__toggle">
        <input
          type="checkbox"
          checked={!!rule}
          onChange={(e) => onChange(e.target.checked ? defaultRule() : undefined)}
        />
        <span>繰り返し投稿にする</span>
      </label>

      {rule && (
        <div className="repeat-editor__body">
          <div className="repeat-editor__row">
            <select
              value={rule.freq}
              onChange={(e) => patch({ freq: e.target.value as RepeatFreq })}
              aria-label="繰り返しの頻度"
            >
              <option value="daily">毎日</option>
              <option value="weekly">毎週</option>
              <option value="monthly">毎月</option>
            </select>
            <label className="repeat-editor__interval">
              <input
                type="number"
                min={1}
                max={12}
                value={rule.interval}
                onChange={(e) => patch({ interval: Math.max(1, Number(e.target.value) || 1) })}
              />
              <span>
                {rule.freq === 'daily' ? '日ごと' : rule.freq === 'weekly' ? '週ごと' : 'か月ごと'}
              </span>
            </label>
            <input
              type="time"
              value={rule.time}
              onChange={(e) => patch({ time: e.target.value })}
              aria-label="投稿する時刻"
            />
          </div>

          {rule.freq === 'weekly' && (
            <div className="repeat-editor__weekdays">
              {WEEKDAYS.map((label, day) => (
                <button
                  key={day}
                  type="button"
                  className={
                    rule.byWeekday?.includes(day)
                      ? 'repeat-editor__weekday repeat-editor__weekday--on'
                      : 'repeat-editor__weekday'
                  }
                  onClick={() => toggleWeekday(day)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {rule.freq === 'monthly' && (
            <label className="repeat-editor__field">
              <span>毎月</span>
              <input
                type="number"
                min={1}
                max={31}
                value={rule.byMonthday ?? new Date().getDate()}
                onChange={(e) => patch({ byMonthday: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })}
              />
              <span>日</span>
            </label>
          )}

          <label className="repeat-editor__toggle repeat-editor__toggle--ai">
            <input
              type="checkbox"
              checked={!!rule.autoGenerate}
              onChange={(e) => patch({ autoGenerate: e.target.checked })}
            />
            <span>
              <Icon name="sparkles" size={14} />
              毎回ちがう本文をAIに書いてもらう
            </span>
          </label>

          {rule.autoGenerate && (
            <div className="repeat-editor__ai">
              <label className="repeat-editor__ai-field">
                <span>何について書くか</span>
                <textarea
                  value={rule.aiTopic ?? ''}
                  onChange={(e) => patch({ aiTopic: e.target.value })}
                  placeholder="例: 個人開発で気づいたこと。宣伝っぽくならないように、その日考えたことを淡々と"
                  rows={3}
                />
              </label>

              {/* 書きかけがあるときは出さない。押すと入れ替わるので、
                  自分で書いた文章を消してしまう。 */}
              {!rule.aiTopic?.trim() && (
                <div className="repeat-editor__topic-presets">
                  <span className="repeat-editor__topic-presets-label">よく使うもの</span>
                  {AI_TOPIC_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      className="repeat-editor__topic-preset"
                      onClick={() => patch({ aiTopic: preset.topic })}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              )}
              <p className="repeat-editor__hint">
                投稿の前にこのお題から1本ずつ書きます。これまでこの繰り返しで投稿した文章も
                AIに渡すので、同じ話の繰り返しにはなりません。
                書かれた本文は投稿されるまで一覧に並ぶので、そこで手直しできます。
              </p>
            </div>
          )}

          <label className="repeat-editor__field repeat-editor__field--stack">
            <span>終了日（任意）</span>
            <input
              type="date"
              value={rule.until ?? ''}
              onChange={(e) => patch({ until: e.target.value || undefined })}
            />
          </label>
          <p className="repeat-editor__hint">
            次の1回分だけが予約として作られ、投稿されるたびに次回分が自動で追加されます。
          </p>
        </div>
      )}
    </div>
  )
}

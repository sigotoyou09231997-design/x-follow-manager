import { lazy, Suspense, useState } from 'react'
import { FileDropZone } from './FileDropZone'
import { Icon, type IconName } from './Icon'

// 通知の設定はSupabase（ログイン状態と購読情報の保存）を必要とする。
// 設定画面は起動時に読み込まれるので、ここで普通にimportすると
// 非相互フォローの整理しか使わない人にまでSupabaseを配ることになる。
// 予約投稿タブと同じく、開いたときに初めて読み込む。
const PushSettings = lazy(() =>
  import('#push-settings').then((module) => ({ default: module.PushSettings }))
)

/** 設定から開ける、ほかの機能の画面。トップの1画面（自動投稿）に載せていないものは、すべてここから行く。 */
export type FeatureTarget = 'autopost' | 'schedule' | 'tidy' | 'protected' | 'history'

interface Props {
  /** 機能の画面を開く。 */
  onOpenFeature: (target: FeatureTarget) => void
  /** フォロー整理の件数（アーカイブ読み込み前は undefined）。行の説明に出す。 */
  tidyCounts?: { pending: number; protected: number }
  onReimport: (file: File) => void
  onClearAll: () => Promise<void>
  lastImportedAt?: number
  importing: boolean
}

export function SettingsView({ onOpenFeature, tidyCounts, onReimport, onClearAll, lastImportedAt, importing }: Props) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleConfirmDelete() {
    setDeleting(true)
    try {
      await onClearAll()
    } finally {
      setDeleting(false)
      setConfirmingDelete(false)
    }
  }

  const features: { target: FeatureTarget; icon: IconName; label: string; desc: string }[] = [
    { target: 'autopost', icon: 'send', label: '自動投稿の文と設定', desc: 'ディスコード・Yay の文、X の文体・1日の投稿数・費用' },
    { target: 'schedule', icon: 'calendar', label: '予約投稿', desc: 'Xと連携すると、時間になったら自動で投稿されます' },
    {
      target: 'tidy',
      icon: 'tasks',
      label: 'フォロー整理',
      desc: tidyCounts ? `非相互フォローの確認（未確認 ${tidyCounts.pending.toLocaleString()}人）` : 'アーカイブを読み込むと、非相互フォローを整理できます',
    },
    {
      target: 'protected',
      icon: 'bookmark',
      label: '残すリスト',
      desc: tidyCounts ? `残すと決めた ${tidyCounts.protected.toLocaleString()}人` : 'フォロー整理で「残す」にした人',
    },
    { target: 'history', icon: 'history', label: '履歴', desc: 'フォローを解除した人の記録' },
  ]

  return (
    <div className="settings-view">
      <section className="home-section" aria-label="機能">
        <h2 className="home-section__title">機能</h2>
        <div className="surface-card link-list">
          {features.map((feature) => (
            <button key={feature.target} type="button" className="link-row" onClick={() => onOpenFeature(feature.target)}>
              <span className="link-row__icon">
                <Icon name={feature.icon} size={18} />
              </span>
              <span className="link-row__body">
                <span className="link-row__label">{feature.label}</span>
                <span className="link-row__desc">{feature.desc}</span>
              </span>
              <Icon name="chevron-right" size={18} className="link-row__chevron" />
            </button>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <h2>
          <span className="settings-section__icon">
            <Icon name="lock" size={16} />
          </span>
          プライバシー
        </h2>
        {/* 「外部へ送信されない」は削らない。ここを読みに来る人が
            一番確かめたい一文なので、折りたたみの中にも入れない。 */}
        <p className="settings-section__desc">
          Xアーカイブは外部サーバーへ送信されません。解析も保存もこのブラウザの中だけで行われます。
        </p>
        <details className="settings-details">
          <summary>くわしく</summary>
          <p className="settings-section__desc">
            ZIPの解析・一覧の作成・作業状態の保存は、すべてこのブラウザ内（IndexedDB）で完結します。
            フォロー整理の機能はネットワーク通信を行いません。予約投稿だけは、あなたが連携したXアカウントと
            サーバー経由で通信します。
          </p>
        </details>
      </section>

      <section className="settings-section">
        <h2>
          <span className="settings-section__icon">
            <Icon name="refresh" size={16} />
          </span>
          アーカイブの再読み込み
        </h2>
        <p className="settings-section__desc">
          最新のXアーカイブZIPを読み込むと、フォロー中・フォロワーを集計し直します。
        </p>
        <details className="settings-details">
          <summary>読み込み直すと何が変わる？</summary>
          <p className="settings-section__desc">
            解除済み・残すの状態は可能な限り引き継がれます。すでにフォロー解除済み、または相互になったアカウントは
            一覧から自動的に除外されます。
          </p>
        </details>
        {lastImportedAt && (
          <p className="settings-section__meta">前回の読み込み: {new Date(lastImportedAt).toLocaleString('ja-JP')}</p>
        )}
        <FileDropZone onFile={onReimport} disabled={importing} />
      </section>

      <Suspense fallback={null}>
        <PushSettings />
      </Suspense>

      <section className="settings-section settings-section--danger">
        <h2>
          <span className="settings-section__icon settings-section__icon--danger">
            <Icon name="trash" size={16} />
          </span>
          データの削除
        </h2>
        <p className="settings-section__desc">
          このブラウザに保存されたフォロー関係の判定結果・作業状態をすべて削除します。この操作は取り消せません。
        </p>
        {!confirmingDelete ? (
          <button type="button" className="btn btn--danger" onClick={() => setConfirmingDelete(true)}>
            ローカルデータをすべて削除
          </button>
        ) : (
          <div className="confirm-box">
            <p>本当にすべてのデータを削除しますか？この操作は取り消せません。</p>
            <div className="confirm-box__actions">
              <button type="button" className="btn btn--ghost" onClick={() => setConfirmingDelete(false)} disabled={deleting}>
                キャンセル
              </button>
              <button type="button" className="btn btn--danger" onClick={handleConfirmDelete} disabled={deleting}>
                {deleting ? '削除中…' : '削除を実行する'}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

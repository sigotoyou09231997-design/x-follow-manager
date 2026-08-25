import { lazy, Suspense, useState } from 'react'
import { FileDropZone } from './FileDropZone'
import { Icon } from './Icon'

// 通知の設定はSupabase（ログイン状態と購読情報の保存）を必要とする。
// 設定画面は起動時に読み込まれるので、ここで普通にimportすると
// 非相互フォローの整理しか使わない人にまでSupabaseを配ることになる。
// 予約投稿タブと同じく、開いたときに初めて読み込む。
const PushSettings = lazy(() =>
  import('#push-settings').then((module) => ({ default: module.PushSettings }))
)

interface Props {
  onReimport: (file: File) => void
  onClearAll: () => Promise<void>
  lastImportedAt?: number
  importing: boolean
}

export function SettingsView({ onReimport, onClearAll, lastImportedAt, importing }: Props) {
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

  return (
    <div className="settings-view">
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

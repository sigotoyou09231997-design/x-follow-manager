import { useState } from 'react'
import { FileDropZone } from './FileDropZone'

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
        <h2>プライバシー</h2>
        <p className="settings-section__desc">
          Xアーカイブは外部サーバーへ送信されません。ZIPの解析・一覧の作成・状態の保存はすべてこのブラウザ内（IndexedDB）で完結します。
          ネットワーク通信は行われません。
        </p>
      </section>

      <section className="settings-section">
        <h2>アーカイブの再読み込み</h2>
        <p className="settings-section__desc">
          最新のXアーカイブZIPを読み込むと、フォロー中・フォロワーを再集計します。
          解除済み・保護の状態は可能な限り引き継がれます。すでにフォロー解除済み、または相互になったアカウントは一覧から自動的に除外されます。
        </p>
        {lastImportedAt && (
          <p className="settings-section__meta">前回の読み込み: {new Date(lastImportedAt).toLocaleString('ja-JP')}</p>
        )}
        <FileDropZone onFile={onReimport} disabled={importing} />
      </section>

      <section className="settings-section settings-section--danger">
        <h2>データの削除</h2>
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

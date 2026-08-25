import { PHOTOS } from '../assets/photos'
import { FileDropZone } from './FileDropZone'
import { HistoryView } from './HistoryView'
import { Icon } from './Icon'
import { PhotoHero } from './PhotoHero'
import { SummaryBar } from './SummaryBar'
import type { Summary } from '../hooks/useAccounts'
import type { AccountRecord } from '../lib/types'

interface Props {
  summary: Summary
  accounts: AccountRecord[]
  /** 直近の作業バッチ。永続化されている currentBatchKeys から復元したもの。 */
  batchAccounts: AccountRecord[]
  batchSize: number
  /** アーカイブを読み込み済みか。未読込のホームは読み込み導線を主役にする。 */
  hasData: boolean
  importing: boolean
  /** 読み込みに失敗しているあいだ。Heroのボタンだけは押せる状態に保つ。 */
  importFailed?: boolean
  lastImportedAt?: number
  onFile: (file: File) => void
  onSearchFocus: () => void
  onGotoPending: () => void
  onGotoProtected: () => void
  onGotoSchedule: () => void
  onGotoSettings: () => void
  /** 投稿の作成を開く。予約投稿タブのコンポーザーへ直行する。 */
  onCompose: () => void
  /** 未確認の確認作業を始める / 途中のバッチを再開する。 */
  onReview: () => void
}

export function HomeView({
  summary,
  accounts,
  batchAccounts,
  batchSize,
  hasData,
  importing,
  importFailed,
  lastImportedAt,
  onFile,
  onSearchFocus,
  onGotoPending,
  onGotoProtected,
  onGotoSchedule,
  onGotoSettings,
  onCompose,
  onReview,
}: Props) {
  const doneInBatch = batchAccounts.filter((a) => a.status !== 'pending').length
  const remainingInBatch = batchAccounts.length - doneInBatch

  return (
    <div className="home-view">
      {/* Heroと直下のカードは重ねて置くので、gapを持つ .home-view から
          切り離して1つの箱にまとめる。 */}
      <div className="home-top">
        <PhotoHero
          photo={PHOTOS.homeHero}
          title="気になる人だけ、残そう。"
          subtitle="フォローを、もっと心地よく。"
        >
          {/* 未読込のあいだは読み込みが唯一の入口なので、Heroの主役にする。
              読み込み済みなら次の行動は「確認を進める」なので、そちらへ差し替える。
              読み込みに失敗したときは、原因の表示（App側のバナー）と一緒に
              もう一度選び直せるよう、読み込みボタンのまま残す。 */}
          {hasData && !importFailed ? (
            <button type="button" className="btn btn--on-photo" onClick={onReview}>
              <Icon name="plus" size={18} />
              {remainingInBatch > 0 ? `続きから（残り${remainingInBatch}人）` : `次の${batchSize}人を確認`}
            </button>
          ) : (
            <FileDropZone
              onFile={onFile}
              disabled={importing}
              variant="button"
              label={importing ? 'アーカイブを解析しています…' : 'アーカイブを読み込む'}
            />
          )}

          <p className="photo-hero__trust">
            <span className="trust-label">
              <Icon name="lock" size={13} />
              端末内で解析
            </span>
            <span className="trust-label">外部送信なし</span>
            <button type="button" className="photo-hero__trust-link" onClick={onGotoSettings}>
              くわしく
            </button>
          </p>
        </PhotoHero>

        {hasData ? (
          <section className="surface-card home-metrics">
            <header className="home-metrics__head">
              <h2 className="home-section__title">フォロー整理</h2>
              {lastImportedAt && (
                <span className="home-metrics__stamp">
                  {new Date(lastImportedAt).toLocaleDateString('ja-JP', {
                    month: 'numeric',
                    day: 'numeric',
                  })}
                  に読み込み
                </span>
              )}
            </header>
            <SummaryBar summary={summary} />
          </section>
        ) : (
          <section className="surface-card home-empty">
            <h2 className="home-section__title">まだアーカイブがありません</h2>
            <p className="home-empty__desc">
              Xの「設定とプライバシー → アカウント → データのアーカイブをダウンロード」で受け取ったZIPを、
              上のボタンから読み込むと非相互フォローの一覧ができます。
            </p>
            <p className="home-empty__desc">
              予約投稿はアーカイブが無くても使えます。
            </p>
          </section>
        )}
      </div>

      {hasData && (
        <button type="button" className="home-search" onClick={onSearchFocus}>
          <Icon name="search" size={18} />
          <span>アカウントを検索</span>
        </button>
      )}

      {hasData && (
        <section className="home-section">
          <div className="home-cards">
            <button type="button" className="entry-card" onClick={onGotoPending}>
              <span className="entry-card__value tnum">{summary.pending.toLocaleString()}</span>
              <span className="entry-card__label">未確認</span>
              <span className="entry-card__desc">非相互フォローを整理</span>
              <Icon name="chevron-right" size={18} className="entry-card__chevron" />
            </button>
            <button type="button" className="entry-card" onClick={onGotoProtected}>
              <span className="entry-card__value tnum">{summary.protected.toLocaleString()}</span>
              <span className="entry-card__label">残す</span>
              <span className="entry-card__desc">あとで見直す</span>
              <Icon name="chevron-right" size={18} className="entry-card__chevron" />
            </button>
          </div>
        </section>
      )}

      <section className="home-section">
        <h2 className="home-section__title">予約投稿</h2>
        <div className="surface-card link-list">
          <button type="button" className="link-row" onClick={onGotoSchedule}>
            <span className="link-row__icon">
              <Icon name="calendar" size={18} />
            </span>
            <span className="link-row__body">
              <span className="link-row__label">予約した投稿を見る</span>
              <span className="link-row__desc">Xと連携すると、時間になったら自動で投稿されます</span>
            </span>
            <Icon name="chevron-right" size={18} className="link-row__chevron" />
          </button>
          <button type="button" className="link-row" onClick={onCompose}>
            <span className="link-row__icon">
              <Icon name="sparkles" size={18} />
            </span>
            <span className="link-row__body">
              <span className="link-row__label">AIで下書きを作る</span>
              <span className="link-row__desc">投稿のアイデアや文章を提案します</span>
            </span>
            <Icon name="chevron-right" size={18} className="link-row__chevron" />
          </button>
        </div>
      </section>

      {hasData && (
        <section className="home-section">
          <h2 className="home-section__title">今日のタスク</h2>
          <ul className="task-list">
            <li className="task-item task-item--done">
              <span className="task-item__check" aria-hidden="true">
                <Icon name="check" size={14} />
              </span>
              <span className="task-item__body">
                <span className="task-item__label">アーカイブを読み込む</span>
                <span className="task-item__meta">端末内で解析済み</span>
              </span>
            </li>
            <li
              className={`task-item${batchAccounts.length > 0 && remainingInBatch === 0 ? ' task-item--done' : ''}`}
            >
              <span className="task-item__check" aria-hidden="true">
                {batchAccounts.length > 0 && remainingInBatch === 0 && <Icon name="check" size={14} />}
              </span>
              <span className="task-item__body">
                <span className="task-item__label">
                  {batchAccounts.length > 0
                    ? `${batchAccounts.length}人を確認する`
                    : `${batchSize}人を確認する`}
                </span>
                <span className="task-item__meta">
                  {batchAccounts.length > 0
                    ? remainingInBatch > 0
                      ? `残り${remainingInBatch}人`
                      : 'このバッチは完了しました'
                    : `未確認${summary.pending.toLocaleString()}人から次のバッチを始めましょう`}
                </span>
              </span>
              {/* 進行中でも押せるようにしておく。中央の＋が予約投稿になったぶん、
                  モバイルで「続きから再開する」入口はここが担う。 */}
              <button type="button" className="btn btn--primary btn--small" onClick={onReview}>
                {remainingInBatch > 0 ? '続きから' : '開始'}
              </button>
            </li>
          </ul>
        </section>
      )}

      {hasData && <HistoryView accounts={accounts} limit={5} heading="最近のうごき" overline="RECENT" />}
    </div>
  )
}

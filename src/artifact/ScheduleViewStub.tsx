// Claude Artifact版のスタブ。
// 予約投稿はサーバー(Vercel Functions)とSupabase、Xとの連携が前提で、
// Artifactの単一HTML環境では動かせない。タブは残るが、中身は案内だけにする。
export function ScheduleView() {
  return (
    <div className="schedule-view schedule-view--notice">
      <p>予約投稿はこのArtifact版では利用できません。</p>
      <p className="schedule-view__hint">
        予約投稿は、投稿時刻にブラウザが閉じていても動くようにサーバー側で実行される仕組みのため、
        デプロイ版のアプリでのみ使えます。
      </p>
    </div>
  )
}

// Claude Artifact版のスタブ。
// 掲示板・Yay の自動投稿は、Macで動く投稿役とサーバー(Vercel Functions)、Supabaseが前提で、
// Artifactの単一HTML環境では動かせない。タブは残るが、中身は案内だけにする。
export function AutoPostView() {
  return (
    <div className="schedule-view schedule-view--notice">
      <p>自動投稿はこのArtifact版では利用できません。</p>
      <p className="schedule-view__hint">
        自動投稿の文は、Macで動いている投稿役がサーバーから読み取る仕組みのため、
        デプロイ版のアプリでのみ使えます。
      </p>
    </div>
  )
}

// トップの1画面（自動投稿）も、同じ理由で案内だけにする。フォロー整理など、ほかの機能は設定から開ける。
export function AutoPostHome() {
  return (
    <div className="schedule-view schedule-view--notice">
      <p>自動投稿はこのArtifact版では利用できません。</p>
      <p className="schedule-view__hint">
        フォロー整理などは、右上の設定から開けます。自動投稿は、デプロイ版のアプリでのみ使えます。
      </p>
    </div>
  )
}

// アプリ更新通知の判断部分。api/checkAppUpdate.ts から使う。
// サーバー関数の中に埋めるとテストからは呼べないので、純粋な判断だけこちらに置く
// （api/publishDue.ts が src/lib/schedule/repeat.ts を使っているのと同じ形）。

export const VERSION_STATE_ID = 'singleton'

/**
 * 通知すべきか。
 *
 * previousVersion が null＝まだ一度も記録がない状態（この機能を入れた直後や、
 * app_version_state を消したあと）。ここで通知してしまうと、実際には何も更新して
 * いないのに「アップデートしました」が全端末へ飛ぶので、初回は記録だけして黙る。
 */
export function shouldNotifyUpdate(
  previousVersion: string | null,
  deployedVersion: string
): boolean {
  return previousVersion !== null && previousVersion !== deployedVersion
}

/** 通知の中身。public/push-sw.js の push ハンドラが受け取る形と対になる。 */
export function buildUpdateNotificationPayload(): string {
  return JSON.stringify({
    title: 'アプリがアップデートされました',
    body: 'タップすると最新版が開きます。',
    url: '/',
    tag: 'app-update',
  })
}

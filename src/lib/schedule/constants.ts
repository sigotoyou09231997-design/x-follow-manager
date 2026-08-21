// 予約投稿タブは遅延読み込み(lazy)にしているため、起動直後に必要な値だけを
// この軽いモジュールに置く。ここからScheduleViewやSupabaseを引き込まないこと。

/** XのOAuth認可後に戻ってくるパス。Xアプリ側のCallback URIと一致させる。 */
export const X_CALLBACK_PATH = '/x-callback'

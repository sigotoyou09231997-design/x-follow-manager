import { createAutopilotHandler } from './_lib/autopilotHandler.js'

// X の自動運転（過去の投稿を読んで文体を学び、AIが新しい投稿を前もって予約に並べる）の画面向けの受け口。
// 中身は _lib/autopilotHandler.ts。毎分の補充は publishDue から呼ばれる（autopilotEngine.topUpAll）。
export default createAutopilotHandler()

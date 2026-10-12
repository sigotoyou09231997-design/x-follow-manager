import { createPosterCommandHandler } from './_lib/posterCommandHandler.js'

// 画面からの「投稿役を再起動する」の依頼を、Mac の見張りが受け取る受け口。中身は _lib/posterCommandHandler.ts。
export default createPosterCommandHandler()

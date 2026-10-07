import { createPosterStatusHandler } from './_lib/autopostHandlers.js'

// Mac の投稿役が「動いている・最後の投稿」を報告する受け口。中身は _lib/autopostHandlers.ts。
export default createPosterStatusHandler()

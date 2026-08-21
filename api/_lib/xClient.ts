// X API v2 の呼び出しをまとめたモジュール。
// ブラウザからは api.x.com へ直接fetchできない(CORSヘッダを返さない)ため、
// Xとの通信はすべてこのサーバー側モジュールを経由する。

const TOKEN_ENDPOINT = 'https://api.x.com/2/oauth2/token'
const TWEETS_ENDPOINT = 'https://api.x.com/2/tweets'
const MEDIA_ENDPOINT = 'https://api.x.com/2/media/upload'
const MEDIA_METADATA_ENDPOINT = 'https://api.x.com/2/media/metadata'
const ME_ENDPOINT = 'https://api.x.com/2/users/me'

export const X_SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'media.write', 'offline.access']

export class XApiError extends Error {
  status: number
  /** リトライして直る種類のエラーか（レート制限・一時的な障害）。 */
  retryable: boolean

  constructor(message: string, status: number, retryable: boolean) {
    super(message)
    this.status = status
    this.retryable = retryable
  }
}

function clientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.X_CLIENT_ID
  const clientSecret = process.env.X_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('X_CLIENT_ID / X_CLIENT_SECRET が設定されていません')
  }
  return { clientId, clientSecret }
}

/** Confidential client として Basic 認証ヘッダを組む。 */
function basicAuthHeader(): string {
  const { clientId, clientSecret } = clientCredentials()
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
}

export interface XTokenSet {
  accessToken: string
  refreshToken: string
  expiresAt: string
  scope: string
}

async function requestToken(params: URLSearchParams): Promise<XTokenSet> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: basicAuthHeader(),
    },
    body: params,
  })
  const text = await response.text()
  if (!response.ok) {
    throw new XApiError(`トークン取得に失敗しました: ${text}`, response.status, response.status >= 500)
  }
  const data = JSON.parse(text) as {
    access_token: string
    refresh_token?: string
    expires_in: number
    scope: string
  }
  if (!data.refresh_token) {
    // offline.access がスコープに含まれていないと発行されない。これがないと
    // 2時間後にトークンが切れ、予約投稿が動かなくなる。
    throw new XApiError(
      'リフレッシュトークンが返されませんでした。Xアプリの設定で offline.access スコープを有効にしてください',
      400,
      false
    )
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    scope: data.scope,
  }
}

export async function exchangeAuthorizationCode(
  code: string,
  codeVerifier: string,
  redirectUri: string
): Promise<XTokenSet> {
  const { clientId } = clientCredentials()
  return requestToken(
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    })
  )
}

export async function refreshAccessToken(refreshToken: string): Promise<XTokenSet> {
  const { clientId } = clientCredentials()
  return requestToken(
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
    })
  )
}

export async function fetchMe(accessToken: string): Promise<{ id: string; username: string }> {
  const response = await fetch(ME_ENDPOINT, {
    headers: { authorization: `Bearer ${accessToken}` },
  })
  const text = await response.text()
  if (!response.ok) {
    throw new XApiError(`Xアカウント情報の取得に失敗しました: ${text}`, response.status, false)
  }
  const data = JSON.parse(text) as { data: { id: string; username: string } }
  return { id: data.data.id, username: data.data.username }
}

/**
 * 画像をXへアップロードして media_id を得る。
 * v2 のアップロードは INIT / APPEND / FINALIZE の3段階しか用意されていないため、
 * 小さい画像でもこの手順を踏む必要がある。
 */
export async function uploadMedia(
  accessToken: string,
  bytes: Uint8Array,
  mimeType: string
): Promise<string> {
  const auth = { authorization: `Bearer ${accessToken}` }

  const initForm = new FormData()
  initForm.set('command', 'INIT')
  initForm.set('media_type', mimeType)
  initForm.set('total_bytes', String(bytes.byteLength))
  initForm.set('media_category', mimeType === 'image/gif' ? 'tweet_gif' : 'tweet_image')

  const initRes = await fetch(MEDIA_ENDPOINT, { method: 'POST', headers: auth, body: initForm })
  const initText = await initRes.text()
  if (!initRes.ok) {
    throw new XApiError(`画像アップロードの開始に失敗しました: ${initText}`, initRes.status, initRes.status >= 500)
  }
  // レスポンス形が data.id / media_id_string のどちらでも拾えるようにしておく。
  const initJson = JSON.parse(initText) as {
    data?: { id?: string; media_id_string?: string }
    media_id_string?: string
  }
  const mediaId = initJson.data?.id ?? initJson.data?.media_id_string ?? initJson.media_id_string
  if (!mediaId) throw new XApiError(`media_id を取得できませんでした: ${initText}`, 502, true)

  // 5MBずつに分割して送る。
  const chunkSize = 5 * 1024 * 1024
  for (let index = 0, offset = 0; offset < bytes.byteLength; index += 1, offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.byteLength))
    const appendForm = new FormData()
    appendForm.set('command', 'APPEND')
    appendForm.set('media_id', mediaId)
    appendForm.set('segment_index', String(index))
    appendForm.set('media', new Blob([chunk], { type: mimeType }))
    const appendRes = await fetch(MEDIA_ENDPOINT, { method: 'POST', headers: auth, body: appendForm })
    if (!appendRes.ok) {
      const t = await appendRes.text()
      throw new XApiError(`画像アップロードに失敗しました: ${t}`, appendRes.status, appendRes.status >= 500)
    }
  }

  const finalizeForm = new FormData()
  finalizeForm.set('command', 'FINALIZE')
  finalizeForm.set('media_id', mediaId)
  const finalizeRes = await fetch(MEDIA_ENDPOINT, { method: 'POST', headers: auth, body: finalizeForm })
  const finalizeText = await finalizeRes.text()
  if (!finalizeRes.ok) {
    throw new XApiError(
      `画像アップロードの確定に失敗しました: ${finalizeText}`,
      finalizeRes.status,
      finalizeRes.status >= 500
    )
  }

  // 動画やGIFは変換処理の完了待ちが必要。静止画では processing_info が返らない。
  const finalizeJson = JSON.parse(finalizeText) as {
    data?: { processing_info?: { state: string; check_after_secs?: number } }
    processing_info?: { state: string; check_after_secs?: number }
  }
  const processing = finalizeJson.data?.processing_info ?? finalizeJson.processing_info
  if (processing && processing.state !== 'succeeded') {
    await waitForMediaProcessing(accessToken, mediaId)
  }

  return mediaId
}

async function waitForMediaProcessing(accessToken: string, mediaId: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2000))
    const url = `${MEDIA_ENDPOINT}?command=STATUS&media_id=${encodeURIComponent(mediaId)}`
    const res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } })
    if (!res.ok) continue
    const json = (await res.json()) as {
      data?: { processing_info?: { state: string } }
      processing_info?: { state: string }
    }
    const state = (json.data?.processing_info ?? json.processing_info)?.state
    if (state === 'succeeded') return
    if (state === 'failed') throw new XApiError('画像の処理に失敗しました', 400, false)
  }
  throw new XApiError('画像の処理が時間内に終わりませんでした', 504, true)
}

export async function setMediaAltText(
  accessToken: string,
  mediaId: string,
  altText: string
): Promise<void> {
  // 代替テキストは付けられなくても投稿自体は成功させたいので、失敗しても投げない。
  try {
    await fetch(MEDIA_METADATA_ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ id: mediaId, metadata: { alt_text: { text: altText.slice(0, 1000) } } }),
    })
  } catch {
    // noop
  }
}

export interface CreatePostOptions {
  text: string
  mediaIds?: string[]
  /** スレッドの2件目以降で、直前の投稿IDを指定する。 */
  inReplyToTweetId?: string
}

export async function createPost(
  accessToken: string,
  options: CreatePostOptions
): Promise<string> {
  const body: Record<string, unknown> = {}
  if (options.text) body.text = options.text
  if (options.mediaIds?.length) body.media = { media_ids: options.mediaIds }
  if (options.inReplyToTweetId) body.reply = { in_reply_to_tweet_id: options.inReplyToTweetId }

  const response = await fetch(TWEETS_ENDPOINT, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  if (!response.ok) {
    // 429(レート制限)と5xxは時間をおけば直る。それ以外は本文の問題なのでリトライしない。
    const retryable = response.status === 429 || response.status >= 500
    throw new XApiError(`投稿に失敗しました (${response.status}): ${text}`, response.status, retryable)
  }
  const data = JSON.parse(text) as { data: { id: string } }
  return data.data.id
}

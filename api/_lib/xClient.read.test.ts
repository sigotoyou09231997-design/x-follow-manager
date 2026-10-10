// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { describeReadFailure, fetchOwnPosts, XApiError } from './xClient.js'

// X に送る要求の形（自分の投稿だけ・返信とリポスト抜き・差分読み・ページ送り）と、失敗の理由の出し方を確かめる。
// 本物の X には送らず、fetch を偽物にして、送った中身を見る。

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
  vi.restoreAllMocks()
})

function stubFetch(pages: unknown[]) {
  const urls: string[] = []
  let i = 0
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    urls.push(String(input))
    const page = pages[Math.min(i++, pages.length - 1)]
    return new Response(JSON.stringify(page), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  return urls
}

const posts = (from: number, n: number) => Array.from({ length: n }, (_, k) => ({ id: String(from + k), text: `本文${from + k}` }))

describe('fetchOwnPosts', () => {
  it('自分のタイムラインを、返信とリポストを除いて読む', async () => {
    const urls = stubFetch([{ data: posts(1, 3) }])
    const result = await fetchOwnPosts('token', '123', { limit: 50 })
    expect(result).toHaveLength(3)
    const url = new URL(urls[0])
    expect(url.pathname).toBe('/2/users/123/tweets')
    expect(url.searchParams.get('exclude')).toBe('retweets,replies')
    expect(url.searchParams.get('tweet.fields')).toBe('created_at,public_metrics')
    expect(url.searchParams.get('max_results')).toBe('50')
  })

  it('次のページがあれば続けて読み、上限の件数で止める', async () => {
    const urls = stubFetch([
      { data: posts(1, 100), meta: { next_token: 'page2' } },
      { data: posts(101, 100), meta: { next_token: 'page3' } },
      { data: posts(201, 100) },
    ])
    const result = await fetchOwnPosts('token', '123', { limit: 150 })
    expect(result).toHaveLength(150)
    expect(urls).toHaveLength(2) // 150件に届いた時点で、3ページ目は読まない（読み取りは件数で課金される）
    expect(new URL(urls[1]).searchParams.get('pagination_token')).toBe('page2')
    expect(new URL(urls[1]).searchParams.get('max_results')).toBe('50')
  })

  it('sinceId を渡すと、それより新しい投稿だけを頼む（差分の更新）', async () => {
    const urls = stubFetch([{ data: [] }])
    await fetchOwnPosts('token', '123', { limit: 100, sinceId: '999' })
    expect(new URL(urls[0]).searchParams.get('since_id')).toBe('999')
  })

  it('1回に読む件数には上限がある（400）', async () => {
    const urls = stubFetch([{ data: posts(1, 100), meta: { next_token: 'p' } }])
    await fetchOwnPosts('token', '123', { limit: 99999 })
    // 上限400件を超えて頼まない。最初の要求は 100 件まで
    expect(new URL(urls[0]).searchParams.get('max_results')).toBe('100')
  })

  it('投稿が1件も無くても落ちない', async () => {
    stubFetch([{ meta: { result_count: 0 } }])
    expect(await fetchOwnPosts('token', '123', { limit: 20 })).toEqual([])
  })

  it('失敗は理由つきの XApiError にする（クレジット不足・権限・制限）', async () => {
    globalThis.fetch = (async () => new Response('{"title":"CreditsDepleted"}', { status: 402 })) as typeof fetch
    await expect(fetchOwnPosts('token', '123', { limit: 10 })).rejects.toThrow('クレジットが足りません')

    globalThis.fetch = (async () => new Response('{}', { status: 429 })) as typeof fetch
    const error = await fetchOwnPosts('token', '123', { limit: 10 }).catch((e) => e)
    expect(error).toBeInstanceOf(XApiError)
    expect(error.retryable).toBe(true) // 利用制限は待てば直る
  })
})

describe('describeReadFailure', () => {
  it('原因ごとに、次にやることが分かる', () => {
    expect(describeReadFailure(401, '')).toContain('し直してください')
    expect(describeReadFailure(402, '')).toContain('クレジット')
    expect(describeReadFailure(403, 'client-forbidden')).toContain('権限')
    expect(describeReadFailure(500, 'oops')).toContain('500')
  })
})

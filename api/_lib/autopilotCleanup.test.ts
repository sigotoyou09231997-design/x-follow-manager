// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { deletePreviousAutopilotPosts, MAX_DELETIONS_PER_RUN, type CleanupDeps, type PreviousPost } from './autopilotCleanup.js'
import { deletePost, XApiError } from './xClient.js'

// 「次の投稿が出たら、前の自動運転の投稿を X から消す」の決めごと。本物の X・Supabase には触れず、偽物を渡して見る。

function deps(previous: PreviousPost[], overrides: Partial<CleanupDeps> = {}) {
  const deleted: string[] = []
  const marked: string[] = []
  const d: CleanupDeps = {
    listPrevious: async () => previous,
    deleteTweet: async (id) => {
      deleted.push(id)
    },
    markDeleted: async (id) => {
      marked.push(id)
    },
    ...overrides,
  }
  return { d, deleted, marked }
}

afterEach(() => vi.restoreAllMocks())

describe('deletePreviousAutopilotPosts', () => {
  it('前の自動運転の投稿を X から消し、消した印を付ける', async () => {
    const { d, deleted, marked } = deps([
      { id: 'a', tweetIds: ['t1'] },
      { id: 'b', tweetIds: ['t2'] },
    ])
    const result = await deletePreviousAutopilotPosts(d, 'u1', 'now')
    expect(deleted).toEqual(['t1', 't2'])
    expect(marked).toEqual(['a', 'b'])
    expect(result).toEqual({ deleted: 2, failed: 0 })
  })

  it('いま出した投稿そのものは、一覧に紛れていても消さない', async () => {
    const { d, deleted, marked } = deps([
      { id: 'now', tweetIds: ['tNow'] },
      { id: 'a', tweetIds: ['t1'] },
    ])
    await deletePreviousAutopilotPosts(d, 'u1', 'now')
    expect(deleted).toEqual(['t1'])
    expect(marked).toEqual(['a'])
  })

  it('いま出した投稿を渡して、前の投稿の一覧を頼む（持ち主と除外を取り違えない）', async () => {
    const listPrevious = vi.fn(async () => [] as PreviousPost[])
    const { d } = deps([], { listPrevious })
    await deletePreviousAutopilotPosts(d, 'u1', 'now')
    expect(listPrevious).toHaveBeenCalledWith('u1', 'now')
  })

  it('スレッドは、中の投稿を全部消してから印を付ける', async () => {
    const { d, deleted, marked } = deps([{ id: 'a', tweetIds: ['t1', 't2', 't3'] }])
    await deletePreviousAutopilotPosts(d, 'u1', 'now')
    expect(deleted).toEqual(['t1', 't2', 't3'])
    expect(marked).toEqual(['a'])
  })

  it('消せなかった投稿には印を付けず（次回やり直す）、ほかの投稿の削除は続ける', async () => {
    const { d, deleted, marked } = deps(
      [
        { id: 'a', tweetIds: ['t1'] },
        { id: 'b', tweetIds: ['t2'] },
        { id: 'c', tweetIds: ['t3'] },
      ],
      {
        deleteTweet: async (id) => {
          if (id === 't2') throw new XApiError('利用制限', 429, true)
          deleted.push(id)
        },
      }
    )
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await deletePreviousAutopilotPosts(d, 'u1', 'now')
    expect(deleted).toEqual(['t1', 't3'])
    expect(marked).toEqual(['a', 'c'])
    expect(result).toEqual({ deleted: 2, failed: 1 })
  })

  it('スレッドの途中で失敗したら、その予約には印を付けない（残りを次回消す）', async () => {
    const { d, marked } = deps([{ id: 'a', tweetIds: ['t1', 't2'] }], {
      deleteTweet: async (id) => {
        if (id === 't2') throw new Error('boom')
      },
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await deletePreviousAutopilotPosts(d, 'u1', 'now')
    expect(marked).toEqual([])
    expect(result.failed).toBe(1)
  })

  it('印を付けられなくても数えて続ける（X からは消えている。次回は「無い」と返り、成功になる）', async () => {
    const marked: string[] = []
    const { d } = deps(
      [
        { id: 'a', tweetIds: ['t1'] },
        { id: 'b', tweetIds: ['t2'] },
      ],
      {
        markDeleted: async (id) => {
          if (id === 'a') throw new Error('db down')
          marked.push(id)
        },
      }
    )
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await deletePreviousAutopilotPosts(d, 'u1', 'now')
    expect(marked).toEqual(['b'])
    expect(result).toEqual({ deleted: 1, failed: 1 })
  })

  it('溜まっていても、1回に消すのは上限まで。古いほうから', async () => {
    const many = Array.from({ length: MAX_DELETIONS_PER_RUN + 5 }, (_, i) => ({ id: `p${i}`, tweetIds: [`t${i}`] }))
    const { d, deleted } = deps(many)
    const result = await deletePreviousAutopilotPosts(d, 'u1', 'now')
    expect(result.deleted).toBe(MAX_DELETIONS_PER_RUN)
    expect(deleted[0]).toBe('t0')
    expect(deleted).not.toContain(`t${MAX_DELETIONS_PER_RUN}`)
  })

  it('投稿 ID が無い予約は、何も消さず、印も付けない', async () => {
    const { d, deleted, marked } = deps([{ id: 'a', tweetIds: [] }])
    await deletePreviousAutopilotPosts(d, 'u1', 'now')
    expect(deleted).toEqual([])
    expect(marked).toEqual([])
  })

  it('前の投稿が無ければ、何もしない', async () => {
    const { d, deleted } = deps([])
    expect(await deletePreviousAutopilotPosts(d, 'u1', 'now')).toEqual({ deleted: 0, failed: 0 })
    expect(deleted).toEqual([])
  })
})

describe('deletePost（X への削除の要求）', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  function stub(status: number, body = '{}') {
    const calls: { url: string; init: RequestInit | undefined }[] = []
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      calls.push({ url: String(input), init })
      return new Response(body, { status })
    }) as typeof fetch
    return calls
  }

  it('DELETE /2/tweets/:id を、持ち主の鍵付きで送る', async () => {
    const calls = stub(200, '{"data":{"deleted":true}}')
    await deletePost('token', '123')
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.x.com/2/tweets/123')
    expect(calls[0].init?.method).toBe('DELETE')
    const headers = calls[0].init?.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer token')
  })

  it('すでに無い（404）は成功として扱う', async () => {
    stub(404)
    await expect(deletePost('token', '123')).resolves.toBeUndefined()
  })

  it('利用制限（429）・サーバーの不調（5xx）は、やり直して直る失敗として投げる', async () => {
    stub(429, 'Too Many Requests')
    await expect(deletePost('token', '1')).rejects.toMatchObject({ status: 429, retryable: true })
    stub(503, 'down')
    await expect(deletePost('token', '1')).rejects.toMatchObject({ status: 503, retryable: true })
  })

  it('権限が無い（403）などは、やり直しても直らない失敗として投げる', async () => {
    stub(403, 'forbidden')
    await expect(deletePost('token', '1')).rejects.toMatchObject({ status: 403, retryable: false })
  })
})

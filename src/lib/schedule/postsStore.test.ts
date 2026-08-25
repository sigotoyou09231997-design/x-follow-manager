import { beforeEach, describe, expect, it, vi } from 'vitest'

// Supabaseクライアントを差し替えて、削除で何が呼ばれたかだけを見る。
const remove = vi.hoisted(() => vi.fn(async () => ({ error: null })))
const deleteEq = vi.hoisted(() => vi.fn(async () => ({ error: null })))

vi.mock('../supabase', () => ({
  requireSupabase: async () => ({
    from: () => ({ delete: () => ({ eq: deleteEq }) }),
    storage: { from: () => ({ remove }) },
  }),
}))

const { deleteScheduledPost } = await import('./postsStore')
const { buildPost } = await import('./testFixtures')

describe('deleteScheduledPost', () => {
  beforeEach(() => {
    remove.mockClear()
    deleteEq.mockClear()
  })

  it('ふつうの予約は、添付画像もStorageから消す', async () => {
    await deleteScheduledPost(
      buildPost({
        segments: [
          { text: '1件目', media: [{ path: 'u/a.png', mime: 'image/png' }] },
          { text: '2件目', media: [{ path: 'u/b.png', mime: 'image/png' }] },
        ],
      })
    )

    expect(deleteEq).toHaveBeenCalledWith('id', 'post-1')
    expect(remove).toHaveBeenCalledWith(['u/a.png', 'u/b.png'])
  })

  it('画像がなければStorageには触らない', async () => {
    await deleteScheduledPost(buildPost())
    expect(remove).not.toHaveBeenCalled()
  })

  // 繰り返し予約は、テンプレートと各回の実体行が同じ画像パスを共有している。
  // 片方を消したときに実体を消すと、残る側の投稿から画像だけが失われる。
  it('繰り返しのテンプレートは、共有している画像を消さない', async () => {
    await deleteScheduledPost(
      buildPost({
        repeatRule: { freq: 'daily', interval: 1, time: '09:00', timeZone: 'Asia/Tokyo' },
        segments: [{ text: '毎日の投稿', media: [{ path: 'u/a.png', mime: 'image/png' }] }],
      })
    )
    expect(deleteEq).toHaveBeenCalledWith('id', 'post-1')
    expect(remove).not.toHaveBeenCalled()
  })

  it('繰り返しから作られた1回分も、共有している画像を消さない', async () => {
    await deleteScheduledPost(
      buildPost({
        repeatParentId: 'template-1',
        segments: [{ text: '今日のぶん', media: [{ path: 'u/a.png', mime: 'image/png' }] }],
      })
    )
    expect(remove).not.toHaveBeenCalled()
  })
})

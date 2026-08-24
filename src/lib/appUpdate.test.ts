import { describe, expect, it } from 'vitest'
import { buildUpdateNotificationPayload, shouldNotifyUpdate } from './appUpdate'

describe('shouldNotifyUpdate', () => {
  it('記録がまだ無いときは通知しない（機能を入れた直後の誤通知を防ぐ）', () => {
    expect(shouldNotifyUpdate(null, 'abc123')).toBe(false)
  })

  it('前回と同じバージョンなら通知しない', () => {
    expect(shouldNotifyUpdate('abc123', 'abc123')).toBe(false)
  })

  it('バージョンが変わったら通知する', () => {
    expect(shouldNotifyUpdate('abc123', 'def456')).toBe(true)
  })
})

describe('buildUpdateNotificationPayload', () => {
  it('push-sw.js が読む形（title / body / url）で返す', () => {
    const payload = JSON.parse(buildUpdateNotificationPayload())
    expect(payload.title).toBeTruthy()
    expect(payload.body).toBeTruthy()
    expect(payload.url).toBe('/')
  })
})

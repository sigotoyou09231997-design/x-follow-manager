import { requireSupabase } from '../supabase'
import type { Hours } from './hours'

// 掲示板・Yay の自動投稿（Mac で動く投稿役）の文と状態を、サーバー（/api/autopost）と
// やり取りする。Supabase のアクセストークンを添えて、サーバー側で本人確認する。

/** xrepeat は、決めた文を X へくり返し投稿する（サーバーが投稿。Mac は使わない）。AI の自動運転（'x'）とは別物。 */
export type ChannelName = 'discord' | 'yay' | 'xrepeat'

export const CHANNEL_NAMES: ChannelName[] = ['discord', 'yay', 'xrepeat']

/** 画面に出す投稿先の名前。 */
export const CHANNEL_LABELS: Record<ChannelName, string> = { discord: 'ディスコード', yay: 'Yay', xrepeat: 'X（くり返し）' }

export interface PosterStatus {
  lastPost: { t: string; text: string } | null
  today: number
  /**
   * 投稿役が「いま止まっている」と受け止めているか。画面で止めたあと、本当に止まったかを確かめる印。
   * 止める機能より前の投稿役は送ってこないので、無いことがある。
   */
  paused?: boolean
  /** サーバーが報告を受け取った時刻。 */
  at: string
  /**
   * いま投稿できていない理由（Mac が失敗のたびに送り、投稿できたら null で消す）。
   * この項目より前の投稿役は送ってこないので、無いことがある。
   */
  problem?: PosterProblem | null
  /** サーバーが投稿している投稿先（xrepeat）の印。Mac からの報告の途絶えを見ない（投稿したときにしか書かれないため）。 */
  server?: true
}

export interface PosterProblem {
  /** 何が起きているか（1行） */
  message: string
  /** 失敗が続き始めた時刻 */
  since: string
  /** 続けて何回失敗したか */
  count: number
  /** それで投稿役が止まったか（止まると報告も来なくなる） */
  stopped: boolean
}

/** いま（日本時間の何時か）どの文が使われるか。サーバーが決めて返す。 */
export interface Schedule {
  hour: number
  /** いま投稿に使う文（messages の何番目か）。 */
  activeIndexes: number[]
  /** 文はあるのに、この時間に使える文が無く、投稿を休んでいる。 */
  idle: boolean
  /** 休んでいるとき、次に投稿が始まる「時」。 */
  nextHour: number | null
}

/** 投稿先ごとの設定。いまは X（くり返し）の間隔だけ。 */
export interface ChannelSettings {
  intervalMinutes: number
}

/** X（くり返し）の間隔として選べるもの（分）。サーバーは10分〜24時間を受ける。 */
export const X_REPEAT_INTERVALS = [10, 15, 30, 60, 120, 180, 360, 720, 1440] as const

export interface ChannelSnapshot {
  channel: ChannelName
  /** この項目より前のサーバーは返さない。無ければ既定（60分）。 */
  settings?: ChannelSettings
  /**
   * X（くり返し）が投稿するアカウント（専用の連携）。null は未連携（連携するまで投稿しない）。
   * xrepeat 以外と、この項目より前のサーバーでは無い。
   */
  account?: { username: string } | null
  messages: string[]
  /** messages と同じ並びで、それぞれの文を投稿する時間帯。null は終日。 */
  hours: Hours[]
  schedule: Schedule
  /** 差し替えで外れた前の文。新しいものが先。 */
  archive: string[]
  /** 文を保存するたびに +1。別の端末で先に保存されたかどうかの目印。 */
  version: number
  savedAt: string | null
  status: PosterStatus | null
  /** 画面で「止める」にしているか（投稿役が受け取ったかどうかは status.paused）。 */
  paused: boolean
  /** 止めた時刻。止めていなければ null。 */
  pausedAt: string | null
  /** 止める機能の準備（SQL 006）ができているか。 */
  pauseReady: boolean
  limits: { maxLength: number; maxMessages: number }
}

/**
 * 投稿先ごとの状態。xrepeat はあとから足した投稿先なので、それより前のサーバー（公開の切り替わりの一瞬など）は返さない。
 * 無いときは、その投稿先を画面に出さないだけにする（無い前提で読むと画面ごと落ちる）。
 */
export type Snapshots = Record<'discord' | 'yay', ChannelSnapshot> & Partial<Record<'xrepeat', ChannelSnapshot>>

/** 返事にある投稿先だけ（並びは CHANNEL_NAMES のまま）。 */
export function presentChannels(snapshots: Snapshots | null | undefined): ChannelName[] {
  return CHANNEL_NAMES.filter((name) => !!snapshots?.[name])
}

/** 保存が別の端末と取り合いになった。最新の中身を添えて知らせる。 */
export class SaveConflictError extends Error {
  readonly snapshot: ChannelSnapshot
  constructor(message: string, snapshot: ChannelSnapshot) {
    super(message)
    this.snapshot = snapshot
  }
}

async function call<T>(method: 'GET' | 'POST', body?: unknown, query = ''): Promise<{ status: number; data: T }> {
  const client = await requireSupabase()
  const {
    data: { session },
  } = await client.auth.getSession()
  if (!session) throw new Error('ログインしていません')

  const response = await fetch(`/api/autopost${query}`, {
    method,
    headers: {
      authorization: `Bearer ${session.access_token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  })
  const text = await response.text()
  let data: unknown
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    // 受け口が無い版（まだデプロイされていない）だと、SPA の HTML が返ってくる。
    throw new Error(`サーバーから予期しない応答が返りました (${response.status})`)
  }
  return { status: response.status, data: data as T }
}

function failureMessage(status: number, data: unknown): string {
  return (data as { error?: string }).error ?? `リクエストに失敗しました (${status})`
}

export async function fetchSnapshots(): Promise<Snapshots> {
  const { status, data } = await call<{ channels: Snapshots }>('GET')
  if (status < 200 || status >= 300) throw new Error(failureMessage(status, data))
  return data.channels
}

export async function saveMessages(
  channel: ChannelName,
  messages: string[],
  baseVersion: number,
  hours: Hours[]
): Promise<ChannelSnapshot> {
  const { status, data } = await call<{ snapshot: ChannelSnapshot; error?: string }>('POST', {
    channel,
    messages,
    hours,
    baseVersion,
  })
  if (status === 409) throw new SaveConflictError(failureMessage(status, data), data.snapshot)
  if (status < 200 || status >= 300) throw new Error(failureMessage(status, data))
  return data.snapshot
}

/**
 * 投稿を止める／再開する。投稿役は動いたまま、次の投稿から見合わせる（再開もこの画面からできる）。
 * 文の保存とは別の操作なので、文の版は動かない。
 */
export async function setPaused(channel: ChannelName, paused: boolean): Promise<ChannelSnapshot> {
  const { status, data } = await call<{ snapshot: ChannelSnapshot; error?: string }>('POST', { channel, paused })
  if (status < 200 || status >= 300) throw new Error(failureMessage(status, data))
  return data.snapshot
}

/** X（くり返し）の間隔を保存する。 */
export async function saveSettings(channel: ChannelName, settings: ChannelSettings): Promise<ChannelSnapshot> {
  const { status, data } = await call<{ snapshot: ChannelSnapshot; error?: string }>('POST', { channel, settings })
  if (status < 200 || status >= 300) throw new Error(failureMessage(status, data))
  return data.snapshot
}

/**
 * 投稿役（Mac）の再起動の依頼の状態。画面の「投稿役を再起動する」を押すと依頼が置かれ、
 * Mac の見張りが1分ごとに見に来て、投稿役を入れ替えて結果を書き戻す。
 */
export interface RestartState {
  /** 準備（SQL 008）ができているか。無ければ画面は、ボタンの代わりに案内を出す。 */
  ready: boolean
  requestedAt: string | null
  /** Mac が処理した時刻。null のあいだは依頼中。 */
  handledAt: string | null
  /** Mac が書き戻した結果（何を再起動し、何をそのままにしたか）。 */
  result: string | null
}

export async function fetchRestart(): Promise<RestartState> {
  const { status, data } = await call<{ restart: RestartState }>('GET', undefined, '?part=restart')
  if (status < 200 || status >= 300) throw new Error(failureMessage(status, data))
  return data.restart
}

/** 投稿役の再起動を依頼する。依頼が1分以内に出ていれば、それをそのまま返す（連打しても何度も入れ替わらない）。 */
export async function requestRestart(): Promise<RestartState> {
  const { status, data } = await call<{ restart: RestartState; error?: string }>('POST', { restart: true })
  if (status < 200 || status >= 300) throw new Error(failureMessage(status, data))
  return data.restart
}

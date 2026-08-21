// Artifactホスト（claude.ai）がページに注入する window.claude の最小限の型定義。
// 公式のruntime contract 0.2.6 (artifact.d.ts / downloads.d.ts) に基づく。

interface ArtifactPublishResult {
  version: string
}

export type ArtifactErrorCode =
  | 'conflict'
  | 'not_writer'
  | 'not_declared'
  | 'too_large'
  | 'invalid_content'
  | 'rate_limited'
  | 'consent_required'
  | 'upstream_error'
  | 'not_granted'
  | 'capability_disabled'
  | 'capability_removed'
  | 'transform_error'

export interface ArtifactError {
  code: ArtifactErrorCode
  message: string
  live?: string
}

interface ArtifactCapability {
  publish(html: string): Promise<ArtifactPublishResult>
}

export type DownloadsErrorCode =
  | 'rejected_extension'
  | 'extension_not_enabled'
  | 'too_large'
  | 'declined'
  | 'rate_limited'
  | 'bad_request'
  | 'unavailable'
  | 'not_granted'
  | 'capability_disabled'
  | 'capability_removed'
  | 'transform_error'

export interface DownloadsError {
  code: DownloadsErrorCode
  message: string
}

interface DownloadsSaveRequest {
  filename: string
  data: string | Blob | ArrayBuffer | ArrayBufferView
}

interface DownloadsSaveResult {
  status: 'saved'
}

interface DownloadsCapability {
  save(request: DownloadsSaveRequest): Promise<DownloadsSaveResult>
}

interface ClaudeCapabilityMap {
  artifact: ArtifactCapability
  downloads: DownloadsCapability
}

declare global {
  interface Window {
    claude?: {
      use<K extends keyof ClaudeCapabilityMap>(name: K): Promise<ClaudeCapabilityMap[K] | null>
    }
  }
}

interface Props {
  title?: string
  messages: string[]
  detectedFiles?: string[]
  tone?: 'error' | 'warning'
  onDismiss?: () => void
}

export function ErrorBanner({ title, messages, detectedFiles, tone = 'warning', onDismiss }: Props) {
  if (messages.length === 0) return null

  return (
    <div className={`banner banner--${tone}`} role="alert">
      <div className="banner__body">
        {title && <p className="banner__title">{title}</p>}
        <ul>
          {messages.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
        {import.meta.env.DEV && detectedFiles && (
          <details className="banner__debug">
            <summary>検出されたファイル一覧（開発モード）</summary>
            <ul>
              {detectedFiles.length === 0 && <li>（なし）</li>}
              {detectedFiles.map((path) => (
                <li key={path}>{path}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
      {onDismiss && (
        <button type="button" className="banner__dismiss" onClick={onDismiss} aria-label="閉じる">
          ×
        </button>
      )}
    </div>
  )
}

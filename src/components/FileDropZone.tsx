import { useRef, useState, type DragEvent } from 'react'
import { Icon } from './Icon'

interface Props {
  onFile: (file: File) => void
  disabled?: boolean
  /**
   * 'panel'  … 点線の枠に説明を添えた、これまでの形。設定画面で使う。
   * 'button' … 写真の上に置く白いボタン。ホームのHeroで使う。
   *
   * 見た目は変わるが、どちらもドロップを受けるのは変えない。ボタンに見えても
   * ZIPを放り込めるのは、これまでの使い方（画面へドラッグ）を壊さないため。
   */
  variant?: 'panel' | 'button'
  /** 'button' のときのラベル。 */
  label?: string
}

export function FileDropZone({ onFile, disabled, variant = 'panel', label }: Props) {
  const [isDragOver, setIsDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setIsDragOver(false)
    if (disabled) return
    const file = event.dataTransfer.files?.[0]
    if (file) onFile(file)
  }

  const classes = [variant === 'button' ? 'file-drop file-drop--button' : 'file-drop']
  if (isDragOver) classes.push('file-drop--active')
  if (disabled) classes.push('file-drop--disabled')

  return (
    <div
      className={classes.join(' ')}
      onDragOver={(e) => {
        e.preventDefault()
        if (!disabled) setIsDragOver(true)
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
      onClick={() => !disabled && inputRef.current?.click()}
      role="button"
      tabIndex={0}
      aria-disabled={disabled}
      onKeyDown={(e) => {
        // role="button" を付けた以上、EnterとSpaceでも押せないと
        // キーボードだけでは読み込みを始められない。
        if (disabled) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          inputRef.current?.click()
        }
      }}
    >
      {variant === 'button' ? (
        <span className="file-drop__label">
          <Icon name="download" size={18} />
          {label ?? 'アーカイブを読み込む'}
        </span>
      ) : (
        <>
          <p className="file-drop__title">Xアーカイブ ZIP をドロップ</p>
          <p className="file-drop__hint">またはクリックしてファイルを選択</p>
        </>
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".zip,application/zip"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onFile(file)
          e.target.value = ''
        }}
      />
    </div>
  )
}

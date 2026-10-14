import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'

// jsdom の scrollTo は「未実装」と出すだけ。画面を切り替えたとき先頭へ戻す処理が使うので、何もしない関数にしておく。
if (typeof window !== 'undefined') window.scrollTo = () => {}

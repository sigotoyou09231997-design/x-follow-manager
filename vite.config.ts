/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '#store': path.resolve(import.meta.dirname, 'src/db/db.ts'),
      '#accounts-hook': path.resolve(import.meta.dirname, 'src/hooks/useAccounts.ts'),
      '#csv': path.resolve(import.meta.dirname, 'src/lib/csv.ts'),
      '#schedule-view': path.resolve(import.meta.dirname, 'src/components/schedule/ScheduleView.tsx'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
})

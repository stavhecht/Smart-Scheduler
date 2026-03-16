import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // הגדרה שמפנה בקשות API לשרת ה-Backend המקומי
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
      }
    },
    // SPA fallback: כל path שלא קיים יפנה ל-index.html
    historyApiFallback: true,
  }
})
import { readFileSync } from 'node:fs'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const certPath = process.env.JARVIS_HTTPS_CERT || env.JARVIS_HTTPS_CERT
  const keyPath = process.env.JARVIS_HTTPS_KEY || env.JARVIS_HTTPS_KEY
  if (Boolean(certPath) !== Boolean(keyPath)) {
    throw new Error('JARVIS_HTTPS_CERT and JARVIS_HTTPS_KEY must both be configured.')
  }
  const https = certPath && keyPath
    ? { cert: readFileSync(certPath), key: readFileSync(keyPath) }
    : undefined

  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      https,
      port: Number(process.env.PORT) || 5173,
      proxy: {
        '/api/ollama': {
          target: 'http://127.0.0.1:8789',
          changeOrigin: false,
          rewrite: (path) => path.replace('/api/ollama', '/api/chat'),
        },
      },
    },
    optimizeDeps: {
      exclude: ['kokoro-js', 'phonemizer', '@huggingface/transformers'],
    },
  }
})

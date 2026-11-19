import { readFileSync } from 'node:fs'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { resolveViteNetworkPolicy } from './scripts/vite-network-policy.mjs'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const certPath = process.env.JARVIS_HTTPS_CERT || env.JARVIS_HTTPS_CERT
  const keyPath = process.env.JARVIS_HTTPS_KEY || env.JARVIS_HTTPS_KEY
  const network = resolveViteNetworkPolicy(certPath, keyPath)
  const https = network.httpsEnabled
    ? { cert: readFileSync(certPath!), key: readFileSync(keyPath!) }
    : undefined

  return {
    plugins: [react()],
    server: {
      // Never expose the development server to the LAN over plaintext HTTP.
      // Trusted HTTPS is required before enabling phone-on-Wi-Fi access.
      host: network.host,
      https,
      port: Number(process.env.PORT) || 5173,
      proxy: {
        '/api/ollama': {
          target: 'http://127.0.0.1:8789',
          changeOrigin: false,
          rewrite: (path) => path.replace(/^\/api\/ollama/, '/api'),
        },
      },
    },
    optimizeDeps: {
      exclude: ['kokoro-js', 'phonemizer', '@huggingface/transformers'],
    },
  }
})

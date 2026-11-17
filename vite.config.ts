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
      // Honour PORT so a second instance can run alongside the first. The bridge
      // only accepts sockets from localhost:5173-5199, so stay inside that range
      // or set JARVIS_ALLOWED_ORIGINS to match.
      port: Number(process.env.PORT) || 5173,
    },
    optimizeDeps: {
      // kokoro-js pulls in `phonemizer`, which carries espeak-ng as inline WASM.
      // Vite's dependency pre-bundler rewrites that initialisation and the
      // language table ends up empty — the symptom is
      // `Invalid language identifier: "en". Should be one of: .` at generate()
      // time, long after the model has loaded successfully. Serving these
      // untouched fixes it.
      exclude: ['kokoro-js', 'phonemizer', '@huggingface/transformers'],
    },
  }
})

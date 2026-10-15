# JARVIS: practical free-first implementation plan

Status: planning document, not a claim that the whole application has been implemented or tested. The current app still depends on Claude Code / the Claude Agent SDK for its reasoning bridge (see `package.json` and `bridge/server.mjs`). Removing that dependency is a real code change, not a configuration toggle.

## Target outcome

Keep the existing holographic React/Vite interface, but make the assistant usable without a paid subscription wherever practical. Prefer local/browser capabilities first, and make cloud providers optional adapters. A provider being free today does not guarantee unlimited or permanent free use.

## Recommended simplest architecture

1. **Interface:** keep the existing React + Vite + Three.js UI and browser-based call screen.
2. **Voice output:** browser `speechSynthesis` as the zero-key fallback; optionally use Kokoro JS for a local neural voice after verifying Czech voice/model support and device performance.
3. **Speech input:** browser SpeechRecognition as a no-key fallback in supported browsers. It is not guaranteed to be offline or available in every browser. For a more private local path, evaluate Whisper/faster-whisper on the laptop; it adds model downloads and CPU/RAM use.
4. **AI brain:** add a provider interface and replace the mandatory Claude Agent SDK path with a Gemini API adapter as an optional cloud brain. The Gemini API has a free tier for eligible models, but quotas/model availability can change and are not unlimited. Keep a clear offline/fallback state when no key or quota is available.
5. **Device control:** run a local, authenticated Windows companion/bridge for Windows-only actions. A website or cloud server alone cannot safely control arbitrary local apps. Android control should be a separate explicitly permissioned integration; iOS background and device-control restrictions mean feature parity cannot be promised.
6. **Plugins/tools:** use a small built-in registry first. Every plugin needs a manifest, source/release link, license, version, required permissions, and test status. Default-deny writes and device actions; ask for confirmation before sending, deleting, installing, purchasing, or changing settings. Do not auto-install third-party plugins just because a search result labels them safe.

## API keys and cost

- **No key needed:** UI, browser speech synthesis, local UI controls, and local plugin registry.
- **Optional Gemini API key:** only for cloud AI reasoning. Create it in Google AI Studio: https://aistudio.google.com/app/apikey
- Do not put secrets in frontend `VITE_*` variables, source code, commits, screenshots, or chat. Frontend variables are exposed to the browser. For local testing use a git-ignored `.env` read by the local bridge; for hosted deployments use the host's secret/environment-variable settings.
- Before relying on a free quota, verify the selected model's current pricing and rate limits. Google's free-tier data-use terms differ from paid-tier terms; avoid sending sensitive personal data on a free tier.

## Verification gates before calling it ready

- `npm install` succeeds on a clean checkout.
- `npm run lint` and `npm run build` pass.
- App starts without any API key and clearly reports which fallback capabilities are active.
- Gemini adapter reports missing key, quota/rate-limit errors, and network failures without crashing.
- No secret is present in browser bundles, repository history, or logs.
- Tool permissions are default-deny and destructive actions require explicit confirmation.
- Test microphone permissions, speech interruption, reconnect/retry, and graceful fallback in Chrome/Edge.
- Test the Windows companion separately on a real Windows machine; do not mark phone or iOS support complete based only on the browser UI.

## Official project references

- Gemini API pricing: https://ai.google.dev/gemini-api/docs/pricing
- Gemini API rate limits: https://ai.google.dev/gemini-api/docs/rate-limits
- Gemini API key handling: https://ai.google.dev/gemini-api/docs/api-key
- OpenAI Whisper (open-source speech recognition): https://github.com/openai/whisper
- Kokoro JS (local/browser TTS package): https://github.com/hexgrad/kokoro
- Current JARVIS repository README: https://github.com/dominixe2/jarvis

## Important current limitation

This plan does not itself make the application complete. The next implementation step is to inspect and refactor the current bridge behind a provider interface, then run the verification gates above. A cloud API key alone will not add safe Windows control, reliable background microphone access, or universal Android/iOS control.

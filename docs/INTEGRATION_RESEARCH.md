# JARVIS integration research: evidence and realistic limits

Research checked: 2026-10-16. This is a source-backed integration plan, not a claim that these integrations have already been implemented or that every device combination has been tested.

## Recommended foundation: Home Assistant

Home Assistant is the strongest free-first foundation for smart-home control because its Assist voice pipeline can run locally and integrates with a broad range of supported devices. Use it as the smart-home control plane rather than trying to reimplement every vendor integration inside JARVIS.

Official sources:
- Assist overview: https://www.home-assistant.io/voice_control/
- Fully local voice pipeline: https://www.home-assistant.io/voice_control/voice_remote_local_assistant
- Assist on Android and wake-word behavior: https://www.home-assistant.io/voice_control/android/
- Assist pipeline developer API: https://developers.home-assistant.io/docs/voice/pipelines/

The local pipeline can use local speech-to-text (Whisper or Speech-to-Phrase) and text-to-speech (Piper). That avoids per-request cloud voice charges, but requires compatible hardware, setup, and enough CPU/RAM. Speech-to-Phrase is intentionally limited to known command patterns; Whisper is more open-ended but can need more resources.

## Android background voice: supported, but not magic

Home Assistant documents an Android companion-app path for setting Assist as the default digital assistant and enabling wake-word detection. Its current docs mark wake-word detection experimental and note battery impact. Android imposes restrictions on starting microphone foreground services from the background. Therefore, do not promise that a custom JARVIS app can continuously listen in every state or on every phone without OS restrictions.

Official sources:
- https://www.home-assistant.io/voice_control/android/
- https://developer.android.com/about/versions/11/privacy/foreground-services

## Smart-home integration options

### Option A: Home Assistant (recommended)
- Open-source, local-first control hub.
- Many integrations; exact device compatibility must be checked against the user's devices.
- JARVIS should call a small allowlisted set of Home Assistant actions through an authenticated local integration.
- Require confirmation for locks, alarms, garage doors, or other safety-sensitive actions.

### Option B: Google Home APIs
Google publishes Home APIs for Android and iOS, including device and automation APIs. This is a legitimate official path, but requires native app integration, authentication/consent, developer setup, and support/eligibility checks. It is not a universal zero-configuration connector and should not be promised as entirely free for every future use.

Official sources:
- https://developers.home.google.com/apis
- https://developers.home.google.com/apis/get-started

## AI brain and free usage

Keep the AI provider behind an adapter so JARVIS can switch between Gemini API, local models, or another provider without rewriting device-control tools. Gemini API offers a free tier for eligible models, but availability, quota, and terms vary. The app must display quota errors and fall back gracefully. It must not claim unlimited free AI.

Official sources:
- Pricing: https://ai.google.dev/gemini-api/docs/pricing
- Rate limits: https://ai.google.dev/gemini-api/docs/rate-limits
- API key security: https://ai.google.dev/gemini-api/docs/api-key
- Key creation: https://aistudio.google.com/app/apikey

## Proposed end-to-end structure

1. Existing React/Vite/Three.js interface remains the visual shell.
2. Local JARVIS bridge on the Windows laptop handles OS actions, provider credentials, plugin policy, and communication with the UI.
3. Provider adapter handles AI chat; no API secret is placed in Vite/browser code.
4. Voice layer has a no-key browser fallback and a later local STT/TTS option.
5. Home Assistant is the smart-home gateway; JARVIS uses authenticated, allowlisted actions.
6. Android app uses Android's supported assistant/foreground-service mechanisms; iOS is a separate implementation with different restrictions.
7. Plugin catalog initially ships with a small number of built-in, reviewed integrations. Each entry records license, version, source, permissions, test evidence, and known limitations. External plugins are not auto-installed or trusted merely because they appear in search results.

## Acceptance tests before calling the build complete

- Clean install and build succeed.
- Works with no AI key for UI and fallback voice; clearly reports missing cloud brain.
- AI provider handles missing key, quota limit, network loss, and provider outage without crashing.
- Voice can be interrupted and resumed in supported browsers; microphone permissions and background behavior are documented by platform.
- Windows actions are allowlisted, authenticated, logged, and require confirmation for risky changes.
- Home Assistant test devices can be discovered and controlled; unsupported devices are reported honestly.
- Secrets are absent from frontend bundles, source control, logs, and screenshots.
- Android and iOS claims are tested separately on real devices.
- CI/build tests are recorded; untested integrations are labeled planned, not verified.

## What “100% works” can honestly mean

No public project or method can be guaranteed to work with every laptop, phone, router, smart-home device, browser, and future OS update. We can aim for a reliable, tested baseline on a specified setup, then expand compatibility with explicit tests. The first real target should be the user's Windows laptop + Android phone; smart-home devices can be added after identifying their brands/models.

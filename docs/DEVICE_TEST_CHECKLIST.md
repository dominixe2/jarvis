# Mobile-first test checklist

This document separates what can be tested in a phone browser from features that require the native Android client or a running desktop agent.

## Current baseline

The repository's current app is a React/Vite web client. Its documented default brain connects to a local Node bridge at `ws://localhost:8787`, and that bridge imports `@anthropic-ai/claude-agent-sdk`. Opening the current frontend on a phone does not make that bridge available on the phone, and it does not provide Android system-level control.

## Phone browser smoke test

After a working web deployment exists:
1. Open the HTTPS site in Chrome on Android.
2. Confirm the UI loads without horizontal overflow.
3. Tap the initialise control and grant microphone permission only if prompted.
4. Test browser speech recognition and speech synthesis separately.
5. Send a text prompt and confirm a response comes from the configured cloud backend.
6. Refresh the page and verify the conversation persists only if cloud history has been implemented and authentication is configured.
7. Test reconnect behavior after briefly disabling and re-enabling the network.

## Android device-control acceptance tests

These require an Android app or a supported, explicitly paired device-control integration. A web page alone cannot promise arbitrary control of the phone.
- Pairing and permission explanation are visible and understandable.
- Device status and capability list are returned from the real phone.
- Screenshot is returned only after the required Android permission/consent.
- A harmless test action runs and reports its actual result.
- Risky actions require explicit confirmation.
- Disconnecting the phone causes a clear offline status rather than a fake success.

## Windows acceptance tests

- The Windows agent starts and reports online.
- The cloud UI can distinguish Windows online from offline.
- A harmless action works while the agent is running.
- The same action reports that the computer is offline when it is shut down.
- Provider credentials remain server-side and are not embedded in the Vite bundle.

## Release gate

Do not label a build "fully functional" until the automated build passes and the relevant phone and Windows acceptance tests have actually been performed. A successful frontend build is not proof of microphone, cloud, or device-control functionality.

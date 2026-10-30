# Phone-first JARVIS: current reality and bring-up path

## What this change does

- Adds a web-app manifest so a deployed HTTPS build can be installed from a supported mobile browser.
- Declares Czech as the document language and adds mobile safe-area / home-screen metadata.
- Does not claim offline operation, background wake-word listening, or Android system control.

## Critical blocker in the current architecture

The current Gemini client sends requests to `http://127.0.0.1:8788`, and the default settings flow saves the Gemini key through the local Node proxy. On a phone, `127.0.0.1` means the phone itself, not the Lenovo notebook or a hosted server. Therefore, installing or opening the frontend on a phone does **not** make AI chat work by itself.

The existing local PC tools also run on the Windows host. A phone-only web page cannot open Windows applications, inspect notebook processes, or control Android system settings. Those require a separately paired, online companion with explicit permissions.

## Required work before calling phone support complete

1. Choose a secure reachable backend for Gemini requests. Keep the provider key in server-side secrets; never ship it as a `VITE_*` value or commit it.
2. Add authenticated phone-to-backend requests, rate limiting, and clear handling for expired sessions / quota errors.
3. Split remote chat from local PC tools. If the Windows companion is offline, report that honestly and do not send PC tool calls to the phone.
4. Deploy the frontend and backend over HTTPS, then test on a real Android device.
5. Verify microphone permission, Czech recognition and speech output, interruption, reconnect, mobile layout, and install-to-home-screen behavior.
6. Build a separately permissioned Android companion before advertising Android system control or reliable background wake-word support.

## Install after a real HTTPS deployment exists

1. Open the deployed HTTPS address in Chrome on Android.
2. Open Chrome's menu and choose **Add to Home screen** or **Install app** if offered.
3. Launch JARVIS from the new home-screen icon.
4. Grant microphone permission only when you choose to test voice features.

A local development URL or GitHub source ZIP is not a publicly reachable mobile deployment. The manifest alone is not a deployment and does not resolve the backend blocker.

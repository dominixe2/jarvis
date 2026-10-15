# Cloud-first synchronized JARVIS architecture

Decision: JARVIS should continue working when the laptop is off. The phone and laptop are clients of a shared cloud backend, and conversation/settings/plugin state sync through a shared account. A local device agent runs only when that device is online and available.

## Architecture

- **Cloud backend:** authentication, conversation history, user preferences, device registry, plugin metadata, provider routing, and sync events. Keep this provider-neutral so the backend can move later.
- **Client apps:** current web UI/laptop client and Android app connect to the same account and sync state. iOS is a separate client with its own OS restrictions.
- **AI provider:** Gemini API adapter initially, with strict server-side secret storage. Never expose keys through frontend Vite variables or source control.
- **Device agents:** Windows control runs on the laptop and cannot act while that laptop is powered off. Phone actions run through a permitted Android integration. A cloud backend cannot magically control a disconnected device.
- **Smart home:** Home Assistant is the recommended gateway. If it runs on a home server, it can control devices while the laptop is off. Remote access requires secure networking; the easiest official Home Assistant remote access is paid Home Assistant Cloud/Link, while self-hosted alternatives require more setup and security care.
- **Voice:** cloud AI and sync do not themselves guarantee always-on microphone access. Each mobile OS has background-microphone restrictions. Use explicit platform-supported assistant/foreground-service behavior and test on actual devices. Local speech options can reduce ongoing voice API costs.

## Sync model

1. Sign in to the same account on each client.
2. Store conversations and preferences in cloud storage with user-level access controls.
3. Sync changes over authenticated HTTPS/realtime channels; recover after reconnect.
4. Keep secrets server-side, never sync API keys to clients.
5. Maintain per-device capabilities and online/offline status; queue only safe, non-destructive actions.
6. For actions with real-world impact (locks, alarms, deleting files, sending messages), require confirmation and audit the result.

## Free-first backend candidate

Supabase Free can be evaluated for authentication, Postgres, and realtime sync, but it has quotas and free projects may pause after inactivity. It is not a guarantee of permanently available, always-on compute. Keep the backend portable and do not put the AI API key in the mobile or browser app.

Official plan references:
- Supabase billing and quotas: https://supabase.com/docs/guides/platform/billing-on-supabase
- Supabase pricing: https://supabase.com/pricing
- Firebase Spark plan and quotas as an alternative: https://firebase.google.com/docs/projects/billing/firebase-pricing-plans

## Smart-home remote access cost caveat

Home Assistant itself can run locally without Home Assistant Cloud, but its official easy remote-access service is subscription-based. See:
- https://www.home-assistant.io/docs/configuration/remote/
- https://www.nabucasa.com/pricing/

A free self-managed secure remote route may be possible, but it requires configuration and must be security-reviewed. Do not claim that every cloud, voice, and smart-home function is guaranteed free and always on.

## Acceptance criteria

- Laptop may be off while mobile app still signs in, chats (within provider quotas), and syncs history.
- Laptop-only actions clearly report that the laptop agent is offline when the laptop is off.
- Home Assistant devices remain controllable independently if Home Assistant and the home network are online.
- Client apps never contain provider secrets.
- Sync resumes after network loss without duplicating conversations or actions.
- Mobile background voice is documented and tested per OS/device.
- Free-tier quotas, pause behavior, and degraded modes are visible to the user.

# JARVIS

JARVIS is the standalone desktop/browser voice assistant project. Springtrap is a separate character project and must not be added to this repository.

## Project direction

- Cyan holographic HUD with the existing React/Three.js scene, reactor, voice visualizer, diagnostics, and panels.
- Voice-first conversations with wake-word support and interruptible speech.
- Local Node bridge for computer-control integrations. Write-capable tools stay disabled by default.
- Provider integrations are optional and configured locally. Do not commit API keys or put secret keys in Vite client variables.

## Current backend and voice

The existing project uses the Claude Code local bridge by default and browser speech synthesis as the default speech output. Optional integrations such as Groq and Fish Audio must be implemented and tested before they are advertised as available.

## Gemini backend (local only)

Set `VITE_BACKEND=gemini` and `GEMINI_API_KEY=...` in `.env.local`, then run `npm start`. The API key is read by the local Node proxy, not by Vite, and requests are relayed through `127.0.0.1:8788`. Do not use the old `VITE_GEMINI_API_KEY` variable. The local key is currently plaintext in `.env.local`; do not commit that file. Encrypted Windows-account storage and an in-app key entry field are not implemented yet.

## Run locally

Use Node.js 20 or newer. Install dependencies with `npm install`, then follow the setup script with `npm run setup`. Start the app using `npm start`. The local bridge uses your existing Claude Code login; it is not a standalone API-key-free hosted service.

## Separate Springtrap project

Springtrap's 3D character, animations, interaction logic, and character-specific AI live in the separate [Springtrap repository](https://github.com/dominixe2/springtrap-). Keep this JARVIS repository focused on the assistant HUD, voice loop, and computer-control bridge.

## Security

- Never commit API keys, tokens, or credentials.
- Keep write-capable computer tools disabled unless explicitly enabled on the local machine.
- Provider free tiers and quotas can change; check the provider's current terms before relying on them.

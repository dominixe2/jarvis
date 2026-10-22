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

Run `npm start`, open **Settings**, choose the Gemini Flash backend, and enter the API key. Restart JARVIS after changing the backend so Vite reloads the saved setting. On Windows, the local Node service encrypts the key using Windows DPAPI for the current Windows account and stores only the encrypted value under the user profile. The key is never included in the Vite browser bundle. Requests are relayed through `127.0.0.1:8788`. Do not use `VITE_GEMINI_API_KEY` or store the key in a plaintext environment variable.

Gemini mode provides model replies but does not currently provide the Claude bridge's local computer-control/MCP tools. API access, quotas, and any free allowance depend on Google's current terms.

## Run on Windows

1. Install Node.js 20 or newer from [nodejs.org](https://nodejs.org/).
2. Download or clone this repository and open its folder.
3. Double-click `start-jarvis.bat`. On first run it installs npm dependencies if they are missing, then starts the local services and Vite.
4. Open the local URL printed in the terminal, preferably in Chrome or Edge, and click **INITIALISE**.
5. Open **Settings** to store a Gemini API key and select the Gemini backend. Restart using `start-jarvis.bat` after changing the backend.

Keep the terminal window open while JARVIS runs. Press Ctrl+C in that window to stop it. To diagnose prerequisites without changing anything, run `npm run setup`.

## Run from a terminal

Use Node.js 20 or newer. Install dependencies with `npm install`, then run `npm run setup` for an advisory preflight check. Start the app using `npm start`. The local bridge uses your existing Claude Code login; it is not a standalone API-key-free hosted service.

## Separate Springtrap project

Springtrap's 3D character, animations, interaction logic, and character-specific AI live in the separate [Springtrap repository](https://github.com/dominixe2/springtrap-). Keep this JARVIS repository focused on the assistant HUD, voice loop, and computer-control bridge.

## Security

- Never commit API keys, tokens, or credentials.
- Keep write-capable computer tools disabled unless explicitly enabled on the local machine.
- The legacy direct Anthropic mode still uses a Vite client variable for its key; do not use that mode for public deployments.
- Provider free tiers and quotas can change; check the provider's current terms before relying on them.

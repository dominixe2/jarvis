# JARVIS

JARVIS is the standalone assistant project: a cyan holographic interface, voice conversation, and a local Node bridge for computer-control integrations. Springtrap is a separate project and its character code does not belong here.

## Download JARVIS for Windows

**[Download the JARVIS source ZIP from the main branch](https://github.com/dominixe2/jarvis/archive/refs/heads/main.zip)**

1. Install [Node.js 20 or newer](https://nodejs.org/).
2. Download and extract the ZIP.
3. Double-click `start-jarvis.bat`.
4. Keep the terminal window open and open the local URL printed there.
5. Click **INITIALISE**. Open **Settings** to configure the Gemini 3.8 Flash backend and save your API key.

The launcher installs npm dependencies on first run. JARVIS currently runs locally in Chrome or Edge with a Node service; this repository does **not yet provide a signed standalone Windows installer or a single-file EXE**.

## Project features

- Cyan holographic HUD with the React/Three.js scene, reactor, voice visualizer, diagnostics, and panels.
- Voice-first conversations, wake-word support, and interruptible speech.
- Local Node bridge for computer-control integrations. Write-capable tools stay disabled by default.
- Provider integrations are optional and configured locally. Never commit API keys or put secret keys in Vite client variables.

## Backends and voice

The default backend is Gemini 3.8 Flash, which has a free API tier subject to Google's rate limits and includes a restricted set of local PC tools. Claude Code is not included in Claude's Free plan: its subscription access requires Pro (currently $20/month or $17/month with annual billing) or a higher eligible plan; a Claude Console account can use it with separately billed API tokens. The optional Claude Code bridge exposes configured MCP integrations, but may consume subscription limits or paid API credits. Keep Gemini selected if you want to avoid a Claude subscription. Browser speech synthesis is the default voice output. Optional integrations such as Groq and Fish Audio must be implemented and tested before being advertised as available.

The default language is Czech. Browser speech recognition requests `cs-CZ`, and spoken output prefers an installed Czech system voice. For best results, use a current Chrome or Edge build and install a Czech speech voice in Windows if none is available. Wake-word recognition and the free browser voice path require an active internet connection in supported browsers.

To enable write-capable local tools in bridge mode, start from a terminal in the project folder with `npm start -- --writes`. This is an opt-in mode because the configured tools may run commands or modify files. Start without `--writes` for read-only operation. Do not expose the local bridge to the public internet.

### Gemini backend

Run `npm start`, open **Settings**, choose the Gemini 3.8 Flash backend, and enter the API key. Gemini 3.8 Flash has a free tier, subject to Google's model access and usage limits; check the current limits in AI Studio. Restart JARVIS after changing the backend so Vite reloads the saved setting. On Windows, the local Node service encrypts the key using Windows DPAPI for the current Windows account and stores only the encrypted value under the user profile. The key is never included in the Vite browser bundle. Requests are relayed through `127.0.0.1:8788`. Do not use `VITE_GEMINI_API_KEY` or store the key in a plaintext environment variable.

Gemini mode uses the current Gemini 3.8 Flash model and includes a restricted local tool set: opening allowlisted Windows apps and HTTP/HTTPS websites, reading basic system status, listing processes, searching filenames, opening requested documents/media, and reading explicitly requested small text files under Desktop/Documents/Downloads. It cannot write or delete files. The advanced Claude bridge exposes configured MCP integrations when Claude Code is authenticated. Gemini 3.8 Flash has a free tier, but access and rate limits depend on Google's current terms; free-tier content may be used to improve Google's products.

## Run from a terminal

Use Node.js 20 or newer. Install dependencies with `npm install`, then run `npm run setup` for an advisory preflight check. Start the app using `npm start`. Keep the terminal open while JARVIS runs. Press Ctrl+C in that window to stop it. To diagnose prerequisites without changing anything, run `npm run setup`.

## Free local AI (no API key)

JARVIS now has an optional **Ollama** backend. The language model runs on your own notebook, so there is no provider account, API key, subscription, or per-message fee. The first model download uses internet and takes disk space; after that, inference runs locally. Speed and answer quality depend on your hardware.

### Set up on the Windows notebook

1. Install Ollama from [ollama.com](https://ollama.com/).
2. Open PowerShell and run `ollama pull qwen2.5:3b` (the model download is a few GB; Ollama needs to be running).
3. Start JARVIS with `npm start`, open Settings, choose **Ollama lokálně (zdarma, bez API klíče)**, then restart JARVIS.
4. Open the network URL Vite prints in the terminal from a phone connected to the same Wi-Fi. Keep the notebook and JARVIS running.
5. The phone sends chat requests to the notebook's chat-only relay on port 8789. The relay has no filesystem or PC-control tools and must not be port-forwarded to the internet.

You can change the model by setting `JARVIS_OLLAMA_MODEL` in the environment before launching JARVIS. The default is `qwen2.5:3b`. If the notebook is on a different network, this local setup will not reach it.

### Important mobile limitations

This is a **local-network chat path**, not a finished native Android companion. Browsers commonly restrict microphone and speech-recognition APIs on plain HTTP LAN addresses, so text chat is the reliable first test on the phone. Reliable mobile voice, background wake word, lock-screen operation, Android permissions, and a secure remote pairing flow still need a native Android companion or a properly configured HTTPS endpoint. The PC must stay powered on to provide the local model. PC-control tools remain local and are not exposed through the Ollama relay.

## Separate Springtrap project

Springtrap's 3D character, animations, interaction logic, and character-specific AI live in the separate [Springtrap repository](https://github.com/dominixe2/springtrap-). Keep this JARVIS repository focused on the assistant HUD, voice loop, and computer-control bridge.

## Security

- Never commit API keys, tokens, or credentials.
- Keep write-capable computer tools disabled unless explicitly enabled on the local machine.
- The legacy direct Anthropic mode still uses a Vite client variable for its key; do not use that mode for public deployments.
- Provider free tiers and quotas can change; check the provider's current terms before relying on them.

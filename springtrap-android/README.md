# Springtrap for Android (first prototype)

This is a separate Android prototype on branch `springtrap-android`. The existing Windows work on `springtrap-rewrite` is preserved.

## Included
- Native Android screen with an original, locally drawn 2D Springtrap-inspired animatronic portrait (not a ripped game asset or 3D model)
- Czech chat personality backed by Gemini API
- Android text-to-speech and speech input when supported by the device
- API key field held in memory only; the app does not intentionally save it to disk
- Conversation history for the current app session

## Build
Open this folder in Android Studio, let Gradle sync, then build/run the app on an Android phone. It requires Android SDK 35 and JDK 17. GitHub Actions also attempts to build a debug APK on pushes to this branch.

## Gemini API
The app currently calls the Gemini REST API using model `gemini-3.8-flash`, listed in Google's current model documentation: https://ai.google.dev/gemini-api/docs/models

Create a key in https://aistudio.google.com/apikey. Do not commit the key or send it to anyone. Enter it into the app when testing. Gemini usage is subject to current quotas and pricing.

## Known limitations
This is an initial prototype, not a finished Springtrap. The avatar is a custom 2D drawing, not an exact in-game model or animation; there is no 3D model, screen awareness, persistent memory, background service, desktop sync, or tested APK attached yet. Speech recognition and Czech TTS depend on Android's installed speech services. The source has not been run on a physical device in this environment.

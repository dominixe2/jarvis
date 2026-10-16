# Gemini brain (first integration step)

This is an initial Python module for connecting Springtrap to the Gemini API.
It is not yet connected to the Windows avatar, microphone, or screen capture.

## Requirements
- Python 3.10+
- A Gemini API key created in Google AI Studio
- Internet access and available API quota

## Configure on Windows PowerShell
Set a key only in your local session (do not paste it into GitHub):
```powershell
$env:GEMINI_API_KEY = "YOUR_KEY_HERE"
$env:GEMINI_MODEL = "gemini-3.6-flash"
python -c "from gemini_brain import GeminiBrain; print(GeminiBrain().ask('Představ se česky jako Springtrap.'))"
```

For a real screenshot analysis, pass the screenshot bytes to `ask(..., screenshot=...)`.
Screen capture must be implemented separately and should happen only with user permission.
Never commit your API key. The free tier has quotas and Google may use data submitted
through the free service to improve products; do not send sensitive content.

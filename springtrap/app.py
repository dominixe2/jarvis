"""Springtrap Windows desktop prototype. Python 3.10+, Windows 10/11, standard library only."""
import os
import queue
import subprocess
import tempfile
import threading
import tkinter as tk
from tkinter import messagebox, scrolledtext
from pathlib import Path

from brain.gemini_brain import GeminiBrain, GeminiBrainError

APP_DIR = Path(__file__).resolve().parent
PS = ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command"]


def powershell(script, timeout=60):
    return subprocess.run(
        PS + [script], capture_output=True, text=True, timeout=timeout,
        encoding="utf-8", errors="replace", creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)
    )


class SpringtrapApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Springtrap")
        self.root.geometry("780x700")
        self.root.minsize(620, 560)
        self.root.configure(bg="#101612")
        self.events = queue.Queue()
        self.history = []
        self.busy = False
        self.speech_enabled = tk.BooleanVar(value=True)
        self._build_ui()
        self.root.after(100, self._poll_events)
        self._append("Springtrap", "Jsem vzhůru. Napiš mi, nebo použij hlas. Zatím jde o první Windows prototyp.")
        if not os.getenv("GEMINI_API_KEY"):
            self._append("Systém", "Chybí GEMINI_API_KEY. Nastav ho podle README a aplikaci spusť znovu.")

    def _build_ui(self):
        top = tk.Frame(self.root, bg="#101612")
        top.pack(fill="x", padx=16, pady=(14, 4))
        tk.Label(top, text="SPRINGTRAP", font=("Segoe UI", 18, "bold"),
                 fg="#b8e986", bg="#101612").pack(side="left")
        tk.Checkbutton(top, text="Přečíst odpovědi nahlas", variable=self.speech_enabled,
                       fg="#d8e4d7", bg="#101612", selectcolor="#25352a",
                       activebackground="#101612", activeforeground="#ffffff").pack(side="right")

        self.canvas = tk.Canvas(self.root, height=190, bg="#18221b", highlightthickness=0)
        self.canvas.pack(fill="x", padx=16, pady=8)
        self._draw_avatar()

        self.chat = scrolledtext.ScrolledText(
            self.root, wrap="word", state="disabled", font=("Segoe UI", 10),
            bg="#0d120e", fg="#e6eee5", insertbackground="white",
            relief="flat", padx=10, pady=10
        )
        self.chat.pack(fill="both", expand=True, padx=16, pady=8)
        self.chat.tag_config("name", foreground="#b8e986", font=("Segoe UI", 10, "bold"))
        self.chat.tag_config("system", foreground="#e8c77a", font=("Segoe UI", 9, "italic"))

        controls = tk.Frame(self.root, bg="#101612")
        controls.pack(fill="x", padx=16, pady=(4, 16))
        self.entry = tk.Entry(controls, font=("Segoe UI", 11), bg="#202b22",
                              fg="#ffffff", insertbackground="white", relief="flat")
        self.entry.pack(side="left", fill="x", expand=True, ipady=10, padx=(0, 8))
        self.entry.bind("<Return>", lambda _event: self.send_text())
        self.send_button = tk.Button(controls, text="Odeslat", command=self.send_text,
                                     bg="#426d3d", fg="white", relief="flat", padx=14, pady=8)
        self.send_button.pack(side="left", padx=(0, 6))
        tk.Button(controls, text="🎙 Mluvit", command=self.listen,
                  bg="#293a2c", fg="white", relief="flat", padx=10, pady=8).pack(side="left", padx=(0, 6))
        tk.Button(controls, text="📸 Analyzovat obrazovku", command=self.analyze_screen,
                  bg="#293a2c", fg="white", relief="flat", padx=10, pady=8).pack(side="left")

    def _draw_avatar(self):
        c = self.canvas
        c.delete("all")
        c.create_oval(315, 15, 385, 105, fill="#718c47", outline="#b1c97b", width=3)
        c.create_polygon(325, 45, 300, 0, 335, 18, fill="#647d3e", outline="#b1c97b", width=2)
        c.create_polygon(370, 22, 397, 0, 381, 54, fill="#647d3e", outline="#b1c97b", width=2)
        c.create_oval(326, 47, 345, 67, fill="#e6e8d6", outline="#d0d7ba")
        c.create_oval(355, 47, 374, 67, fill="#e6e8d6", outline="#d0d7ba")
        c.create_oval(334, 52, 341, 64, fill="#a72d28")
        c.create_oval(362, 52, 369, 64, fill="#a72d28")
        c.create_polygon(343, 72, 357, 72, 350, 80, fill="#293128", outline="#b1c97b")
        c.create_arc(334, 76, 366, 98, start=200, extent=140, style="arc", outline="#d2d7bc", width=3)
        c.create_oval(300, 98, 400, 184, fill="#526b37", outline="#b1c97b", width=3)
        c.create_line(318, 119, 338, 130, fill="#2e3e29", width=4)
        c.create_line(382, 116, 364, 133, fill="#2e3e29", width=4)
        c.create_text(18, 18, anchor="nw", text="NEJSEM JEN TAPETA.", fill="#b8e986",
                      font=("Segoe UI", 10, "bold"))
        c.create_text(18, 40, anchor="nw", text="První desktopový prototyp", fill="#a7b7a4",
                      font=("Segoe UI", 9))

    def _append(self, speaker, text):
        self.chat.configure(state="normal")
        tag = "system" if speaker == "Systém" else "name"
        self.chat.insert("end", speaker + ": ", tag)
        self.chat.insert("end", text + "\n\n")
        self.chat.see("end")
        self.chat.configure(state="disabled")

    def _set_busy(self, busy):
        self.busy = busy
        self.send_button.configure(state="disabled" if busy else "normal")
        self.entry.configure(state="disabled" if busy else "normal")
        self.canvas.itemconfigure if False else None

    def send_text(self):
        message = self.entry.get().strip()
        if not message or self.busy:
            return
        self.entry.delete(0, "end")
        self._append("Ty", message)
        self._ask_async(message)

    def _ask_async(self, message, screenshot=None):
        self._set_busy(True)
        self._append("Systém", "Springtrap přemýšlí…")
        threading.Thread(target=self._ask_worker, args=(message, screenshot), daemon=True).start()

    def _ask_worker(self, message, screenshot):
        try:
            brain = GeminiBrain()
            context = ""
            if self.history:
                context = "Dosavadní konverzace (nejnovější část):\n" + "\n".join(
                    f"{role}: {text}" for role, text in self.history[-12:]
                ) + "\n\n"
            reply = brain.ask(context + message, screenshot=screenshot)
            self.history.extend([("Uživatel", message), ("Springtrap", reply)])
            self.events.put(("reply", reply))
        except GeminiBrainError as exc:
            self.events.put(("error", str(exc)))
        except Exception as exc:
            self.events.put(("error", f"Neočekávaná chyba: {exc}"))

    def _poll_events(self):
        try:
            while True:
                kind, payload = self.events.get_nowait()
                if kind == "heard":
                    self.entry.configure(state="normal")
                    self.entry.delete(0, "end")
                    self.entry.insert(0, payload)
                    self._append("Rozpoznaná řeč", payload)
                    self.send_text()
                elif kind == "screen":
                    self._append("Ty", "[Povolil jsem analýzu obrazovky]")
                    self._ask_async(
                        "Popiš, co je na snímku obrazovky, a upozorni mě na důležité prvky. Nepředstírej akce.",
                        payload
                    )
                elif kind == "reply":
                    self._set_busy(False)
                    self._append("Springtrap", payload)
                    if self.speech_enabled.get():
                        threading.Thread(target=self._speak, args=(payload,), daemon=True).start()
                elif kind == "error":
                    self._set_busy(False)
                    self._append("Systém", payload)
        except queue.Empty:
            pass
        self.root.after(100, self._poll_events)

    def _speak(self, text):
        # Uses the Windows built-in speech synthesizer; installed Czech voices depend on Windows setup.
        safe = text.replace("'", "''")
        script = (
            "Add-Type -AssemblyName System.Speech; "
            "$s=New-Object System.Speech.Synthesis.SpeechSynthesizer; "
            "$s.Speak('" + safe + "'); $s.Dispose()"
        )
        try:
            powershell(script, timeout=120)
        except Exception:
            pass

    def listen(self):
        if self.busy:
            return
        self._append("Systém", "Poslouchám až 10 sekund. Windows může vyžadovat nastavený mikrofon a podporovaný jazyk rozpoznávání.")
        script = r"""
Add-Type -AssemblyName System.Speech
$r = New-Object System.Speech.Recognition.SpeechRecognitionEngine
try {
  $r.SetInputToDefaultAudioDevice()
  $g = New-Object System.Speech.Recognition.DictationGrammar
  $r.LoadGrammar($g)
  $r.InitialSilenceTimeout = [TimeSpan]::FromSeconds(5)
  $r.BabbleTimeout = [TimeSpan]::FromSeconds(2)
  $r.EndSilenceTimeout = [TimeSpan]::FromSeconds(1)
  $result = $r.Recognize([TimeSpan]::FromSeconds(10))
  if ($result) { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Write-Output $result.Text }
} finally { $r.Dispose() }
"""
        def worker():
            try:
                result = powershell(script, timeout=20)
                text = result.stdout.strip()
                if result.returncode != 0:
                    self.events.put(("error", "Windows Speech Recognition se nepodařilo spustit. Zkus napsat zprávu."))
                elif text:
                    self.events.put(("heard", text))
                else:
                    self.events.put(("error", "Nerozuměl jsem nebo nebyla rozpoznána řeč. Zkus to znovu nebo napiš zprávu."))
            except Exception as exc:
                self.events.put(("error", f"Chyba mikrofonu: {exc}"))
        threading.Thread(target=worker, daemon=True).start()

    def analyze_screen(self):
        if self.busy:
            return
        if not messagebox.askyesno("Povolit snímek obrazovky",
                                  "Springtrap pořídí snímek celé obrazovky a odešle ho do Gemini API k analýze. Pokračovat?"):
            return
        script = r"""
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap($b.Width, $b.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
try {
  $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
  $p = Join-Path $env:TEMP 'springtrap-screen.png'
  $bmp.Save($p, [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Output $p
} finally { $g.Dispose(); $bmp.Dispose() }
"""
        def worker():
            try:
                result = powershell(script, timeout=20)
                path = result.stdout.strip().splitlines()[-1]
                if result.returncode != 0 or not path or not os.path.exists(path):
                    self.events.put(("error", "Nepodařilo se pořídit snímek obrazovky."))
                    return
                data = Path(path).read_bytes()
                os.remove(path)
                self.events.put(("screen", data))
            except Exception as exc:
                self.events.put(("error", f"Snímek obrazovky selhal: {exc}"))
        threading.Thread(target=worker, daemon=True).start()

    def close(self):
        self.root.destroy()


def main():
    if os.name != "nt":
        raise SystemExit("Tento prototyp je určený pro Windows 10/11.")
    root = tk.Tk()
    app = SpringtrapApp(root)
    root.protocol("WM_DELETE_WINDOW", app.close)
    root.mainloop()


if __name__ == "__main__":
    main()

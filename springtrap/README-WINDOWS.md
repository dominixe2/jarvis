# Springtrap for Windows (prototype)

První desktopový základ pro Windows 10/11. Používá Python a knihovny dodávané s Windows/Pythonem; žádné balíčky z pipu nejsou zatím potřeba.

## Co tato verze obsahuje
- samostatné okno s jednoduchým kresleným Springtrapem a chatem;
- volání Gemini API přes modul `brain/gemini_brain.py`;
- omezenou konverzační historii během běhu aplikace;
- volitelnou hlasovou odpověď přes Windows System.Speech;
- pokus o hlasový vstup přes Windows System.Speech Recognition;
- snímek primární obrazovky pouze po potvrzení uživatelem a odeslání do Gemini k analýze.

## Požadavky
- Windows 10/11;
- Python 3.10 nebo novější, při instalaci zaškrtnout **Add Python to PATH**;
- Gemini API key. Použití API může mít kvóty nebo náklady podle účtu a aktuálních podmínek.

## Spuštění
1. Stáhni nebo naklonuj větev `springtrap-rewrite`.
2. Otevři PowerShell ve složce `springtrap`.
3. Nastav klíč jen v aktuálním okně PowerShellu (neposílej ho do chatu a nevkládej ho do GitHubu):
   ```powershell
   $env:GEMINI_API_KEY = "SEM_VLOŽ SVŮJ KLÍČ"
   ```
4. Spusť:
   ```powershell
   python .\app.py
   ```

Pokud Python příkaz nefunguje, zkus `py .\app.py`.

## Hlas
Tlačítko **Mluvit** využívá vestavěné Windows Speech Recognition. Dostupné jazyky a mikrofony závisí na nastavení Windows; čeština nemusí být na každém počítači podporována. Hlasový výstup používá hlas nainstalovaný ve Windows, takže český hlas není zaručen.

## Soukromí
Snímek obrazovky se pořizuje pouze po potvrzení dialogu a posílá se do Gemini API. Zatím není implementováno automatické sledování obrazovky, režim Nerušit, automatické spuštění Windows, ukládání dlouhodobé paměti ani ovládání her/počítače.

## Stav testování
Kód je připravený v repozitáři, ale nebyl spuštěn ani otestován na uživatelově notebooku a připojení Gemini API není potvrzené. Toto je prototyp, nikoli finální instalátor.

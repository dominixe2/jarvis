# Průzkum funkčních open-source základů pro JARVIS

Datum průzkumu: 2026-10-16

## Důležitá poznámka k ověření

Veřejné README a dokumentace dokazují, že projekt deklaruje určité schopnosti a popisuje postupy. Neprokazují, že jsme daný projekt sami spustili na našem zařízení. Níže proto rozlišuji zdrojovou dokumentaci od nezávisle provedených testů. Žádný cizí projekt ani jeho plugin se nemá automaticky kopírovat do JARVISe bez kontroly licence, závislostí, oprávnění a kompatibility.

## Kandidáti k technickému posouzení

### 1. Web Speech API — hlasové rozhraní v prohlížeči

- Dokumentace: https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API
- Poskytuje rozpoznávání řeči a syntézu řeči přes webové API.
- Omezení: rozpoznávání není jednotně podporované napříč prohlížeči; některé implementace používají vzdálenou službu. Není to záruka nepřetržitého poslechu na pozadí.
- Doporučení: vhodné jako volitelná hlasová cesta pro současné webové rozhraní, s textovým ovládáním a jasnou chybovou hláškou jako zálohou.
- Stav pro náš repozitář: dokumentačně ověřeno; integrace a zařízení zatím netestovány.

### 2. Home Assistant Assist — hlas a chytrá domácnost

- Android dokumentace: https://www.home-assistant.io/voice_control/android/
- REST API: https://developers.home-assistant.io/docs/api/rest/
- Home Assistant podporuje hlasové ovládání přes doprovodnou Android aplikaci a API pro integrace. Některé funkce, například wake word, mohou být experimentální nebo závislé na verzi a konfiguraci.
- Doporučení: případná pozdější integrace pro chytrou domácnost, nikoli základní požadavek pro první verzi JARVISe.
- Stav pro náš repozitář: oficiální dokumentace zkontrolována; vlastní instalace ani zařízení netestovány.

### 3. AskRex Assistant — desktopový hlasový asistent

- Repozitář: https://github.com/Blueibear/AskRex-Assistant
- Projekt popisuje lokální hlasové ovládání, desktopové rozhraní, lokální/cloudové modely a některé integrace. Jeho vlastní dokumentace zároveň označuje některé části jako beta, experimentální nebo čekající na validační kroky.
- Doporučení: použít jako referenci pro stavové označování funkcí a oddělení implementovaných, experimentálních a otestovaných částí. Nekopírovat celý projekt do JARVISe.
- Stav pro náš repozitář: README prozkoumáno; vlastní instalace a testy neprovedeny.

### 4. Ari — hlasové ovládání Windows

- Repozitář: https://github.com/DO0OG/Ari-VoiceCommand
- README popisuje hlasovou konverzaci, spouštění aplikací, ovládání desktopu a lokální modely pro Windows 10/11.
- Doporučení: reference pro návrh bezpečného seznamu povolených akcí na Windows. Před použitím jakéhokoli kódu ověřit licenci, údržbu, závislosti a konkrétní implementaci.
- Stav pro náš repozitář: README prozkoumáno; vlastní instalace a testy neprovedeny.

### 5. Lokální asistenti jako alternativní směr

- Příklad lokálního asistenta pro Windows: https://github.com/onlyflames360/jarvis
- Projekt popisuje lokální STT, TTS, wake word, lokální LLM a nástroje bez povinného cloudového API.
- Lokální řešení může snížit závislost na placených API, ale vyžaduje dostatečný výkon počítače a stažení modelů. Jazyková podpora, spotřeba RAM/VRAM a kvalita češtiny musí být změřeny.
- Stav pro náš repozitář: README prozkoumáno; vlastní instalace a testy neprovedeny.

## Doporučený postup pro náš JARVIS

1. Nejdřív sestavit aktuální repozitář a zaznamenat přesné chyby; neměnit náhodně několik subsystémů najednou.
2. Zachovat stávající holografické UI a přidat rozhraní `AIProvider`, aby šlo později měnit mozek bez přestavby UI.
3. Začít s bezpečnými, snadno ověřitelnými lokálními akcemi: otevřít povolenou URL, zjistit čas, zastavit řeč a zobrazit výsledek.
4. Přidat testy pro různé formulace v češtině, neznámé příkazy, chyby sítě a odmítnutí rizikových akcí.
5. Pro Windows ovládání používat explicitní allowlist nástrojů; příkazy terminálu, mazání souborů, instalace a externí akce vyžadují samostatné potvrzení.
6. API klíče držet mimo Git: lokálně v ignorovaném `.env` nebo v bezpečných proměnných serveru. Nikdy je nevkládat do klientského JavaScriptu ani do veřejných commitů.
7. U každé schopnosti udržovat stav: `planned`, `implemented`, `tested locally`, `verified in CI`. Označení `tested` použít pouze po skutečně zaznamenaném běhu testu.

## Testovací checklist

- [ ] Čistá instalace závislostí na podporované verzi Node.js.
- [ ] Produkční sestavení proběhne bez chyb.
- [ ] UI a hlasové oprávnění fungují v cílovém prohlížeči.
- [ ] Více českých formulací vede ke správnému záměru.
- [ ] Neznámý příkaz nevyvolá nebezpečnou nebo náhodnou akci.
- [ ] Přerušení řeči a obnovení po chybě fungují.
- [ ] API klíče nejsou v Gitu, front-endovém balíčku ani logách.
- [ ] Každý převzatý balíček má zkontrolovanou licenci a známé bezpečnostní problémy.

## Zdroje

- MDN Web Speech API: https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API
- Home Assistant Assist pro Android: https://www.home-assistant.io/voice_control/android/
- Home Assistant REST API: https://developers.home-assistant.io/docs/api/rest/
- AskRex Assistant: https://github.com/Blueibear/AskRex-Assistant
- Ari VoiceCommand: https://github.com/DO0OG/Ari-VoiceCommand
- Lokální Jarvis pro Windows: https://github.com/onlyflames360/jarvis
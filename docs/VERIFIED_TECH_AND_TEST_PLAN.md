# JARVIS: ověřené technické základy a plán integrace

> Stav: technický podklad, nikoli potvrzení, že všechny funkce už v tomto repozitáři fungují. Každá integrace musí projít testy v tomto projektu před označením za hotovou.

## Co už projekt podle aktuálního README používá

- React, Vite a Three.js pro webové/holografické rozhraní.
- Node.js bridge, který propojuje rozhraní s agentem a nástroji.
- Web Speech API jako hlasovou záložní variantu bez vlastního TTS/STT klíče.
- Volitelné připojení ElevenLabs.
- Stávající AI bridge závisí na Claude Agent SDK a přihlášení ke Claude Code. To je nutné odstranit nebo nahradit, pokud má být běžný provoz bez placeného předplatného.

Tyto body jsou převzaté z projektu; nejsou samy o sobě výsledkem nového běhu testů.

## Ověřitelné technické možnosti

### 1. Hlas v prohlížeči

Web Speech API nabízí SpeechRecognition pro rozpoznávání řeči a SpeechSynthesis pro předčítání. Dostupnost rozpoznávání se liší podle prohlížeče a systému; v některých prohlížečích se zvuk zpracovává online, takže nelze slíbit offline provoz ani nepřetržitý poslech na pozadí.

Zdroj: https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API
Další podrobnosti: https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API/Using_the_Web_Speech_API

### 2. Verze prostředí

Projekt v package.json vyžaduje Node.js >=20. Aktuální dokumentace Vite uvádí pro novou verzi Vite minimálně Node.js 20.19+ nebo 22.12+. Při sestavení je proto nutné ověřit skutečnou verzi Node.js a výsledek npm run build.

Zdroj: https://vite.dev/guide/

### 3. AI bez povinného předplatného

Gemini API má bezplatnou úroveň pro některé modely, ale dostupnost modelů, limity a podmínky se mění. Bezplatná kvóta není zárukou neomezeného používání. U bezplatné úrovně Google uvádí, že odeslaná data mohou být použita ke zlepšování produktů; neposílat proto tajné ani citlivé údaje.

Zdroj: https://ai.google.dev/gemini-api/docs/pricing

Před výběrem modelu ověřit aktuální dostupnost, kvótu a cenu. Klíč nikdy neukládat do front-endového kódu, commitu ani veřejného repozitáře. Tajemství patří do lokálního ignorovaného .env souboru pro vývoj nebo do správce tajemství/serverové proměnné v nasazení. Pokud by klíč někdy unikl, zneplatnit jej a vytvořit nový.

### 4. Ovládání chytré domácnosti

Home Assistant poskytuje REST API a vyžaduje autentizaci pomocí bearer tokenu. Je to možná pozdější integrace, nikoli povinná závislost pro první verzi. Token musí být chráněný stejně jako API klíč.

Zdroj: https://developers.home-assistant.io/docs/api/rest/

## Doporučené pořadí práce

1. Zachovat stávající holografické rozhraní a nejprve zjistit, zda se projekt čistě sestaví.
2. Přidat automatické testy pro rozpoznání záměru a nástroje. Minimální scénáře: „kolik je hodin“, „otevři YouTube“, „vyhledej PTK na YouTube“, „jaké bude zítra počasí“ a neznámý příkaz, na který se asistent musí doptat nebo vysvětlit omezení.
3. Oddělit AI mozek od rozhraní přes jednotné rozhraní providera, aby bylo možné přepnout mezi lokálním modelem a externím API bez přestavby UI.
4. Přidat skutečné nástroje s allowlistem, validací vstupů a potvrzením uživatele před rizikovými akcemi. Samotný jazykový model nesmí mít neomezený přístup k příkazovému řádku.
5. Otestovat hlasové přerušení, chyby mikrofonu, odpojení bridge a obnovu spojení.
6. Teprve potom přidat konfiguraci API klíčů a návod pro jejich bezpečné vložení.
7. Každou funkci označit jako implementováno, otestováno nebo plánováno podle skutečných výsledků. Neoznačovat funkci za otestovanou jen proto, že existuje knihovna nebo dokumentace.

## Akceptační testy před označením první verze za funkční

- [ ] Závislosti se nainstalují čistě na podporované verzi Node.js.
- [ ] npm run build projde bez chyb.
- [ ] Rozhraní se načte a požádá o přístup k mikrofonu.
- [ ] JARVIS odpoví na běžnou českou otázku, nejen na pevně danou frázi.
- [ ] Neznámý požadavek nespustí náhodnou akci.
- [ ] Akce v systému vyžadují jen minimální potřebná oprávnění.
- [ ] Žádný API klíč není ve zdrojovém kódu, historii Gitu ani klientském balíčku.
- [ ] Při nedostupném AI provideru JARVIS srozumitelně oznámí chybu a nespadne bez vysvětlení.

## Bezpečnostní zásady pro pluginy

- Preferovat open-source projekty s aktivní údržbou a dohledatelnou licencí.
- Zkontrolovat závislosti, oprávnění, vydání a známé bezpečnostní problémy.
- Pluginy spouštět s minimálními oprávněními a bez přístupu k tajemstvím, pokud je nepotřebují.
- Neexistuje univerzální certifikace, která by sama zaručila, že každý plugin je bezpečný. Každá integrace potřebuje vlastní kontrolu a testy.

## Oficiální odkazy

- Web Speech API: https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API
- Vite: https://vite.dev/guide/
- Gemini API ceny a bezplatná úroveň: https://ai.google.dev/gemini-api/docs/pricing
- Home Assistant REST API: https://developers.home-assistant.io/docs/api/rest/
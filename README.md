# Website QA System

Ett automatiserat kvalitetssäkringssystem (QA) för webbplatser. Du anger en webbadress, och systemet crawlar sajten, kör över 20 kontroller, klassificerar varje resultat som **PASS**, **WARNING** eller **FAIL**, låter en lokal AI sammanfatta resultatet och skapar en färdig **PDF-rapport**.

Systemet är byggt med **Playwright**, **TypeScript**, **Node.js** och lokal AI via **Ollama**. Det kan användas på tre sätt: från terminalen, via ett REST API eller via ett Chrome-tillägg.

> Projektet är utvecklat som ett praktiskt projekt inom IT-testning och testautomation.

---

## Innehåll

1. [Vad gör systemet?](#1-vad-gör-systemet)
2. [Snabbstart (kort version)](#2-snabbstart-kort-version)
3. [Installation steg för steg](#3-installation-steg-för-steg)
4. [Konfiguration (.env)](#4-konfiguration-env)
5. [Så använder du systemet](#5-så-använder-du-systemet)
6. [Var hamnar rapporten?](#6-var-hamnar-rapporten)
7. [Förstå resultatet](#7-förstå-resultatet)
8. [Alla kontroller](#8-alla-kontroller)
9. [Anpassa systemet](#9-anpassa-systemet)
10. [REST API](#10-rest-api)
11. [Chrome-tillägget](#11-chrome-tillägget)
12. [Tester och kodkontroll](#12-tester-och-kodkontroll)
13. [Projektstruktur](#13-projektstruktur)
14. [Säkerhet och integritet](#14-säkerhet-och-integritet)
15. [Felsökning](#15-felsökning)
16. [Utveckling och Git](#16-utveckling-och-git)

---

## 1. Vad gör systemet?

Systemet automatiserar de kontroller som annars görs för hand när man granskar en webbplats:

- **Crawling:** hittar alla sidor på sajten och kontrollerar att de fungerar.
- **SEO:** rubriker (H1), meta description, canonical, alt-texter på bilder med mera.
- **Prestanda:** mäter hastighet på dator och mobil med Google PageSpeed Insights.
- **Responsivitet:** testar sidorna i mobilvy.
- **Länkar, bilder, navigation och CTA-knappar:** hittar trasiga länkar och bilder.
- **Formulär:** hittar formulär och testar obligatoriska fält samt validering av e-post och telefonnummer.
- **Text och stavning:** kontrollerar svensk text med LanguageTool och en AI som filtrerar bort falska träffar.
- **Säkerhet och domäner:** HTTPS, alternativa domäner (med/utan `www`) och liknande domäner.
- **GDPR:** letar efter cookie- och integritetspolicy.
- **Externa profiler:** sociala medier, Google Maps och Google Business Profile.
- **Rapport:** AI-sammanfattning och en strukturerad PDF med åtgärdsförslag.

De faktiska kontrollerna görs av systemets egen testlogik. AI:n är ett **komplement** som sammanfattar och tolkar resultaten, den är inte själva testet.

```text
Webbplats (URL)
    |
    v
Crawler  ->  hittar alla sidor
    |
    v
QA-kontroller (sidor, SEO, prestanda, länkar, formulär, text, ...)
    |
    v
Klassificering: PASS / WARNING / FAIL
    |
    v
Lokal AI-analys (Ollama)
    |
    v
PDF-rapport
```

---

## 2. Snabbstart (kort version)

Har du redan Node.js, och vill bara komma igång? Kör detta i terminalen:

```bash
git clone https://github.com/moazam33r/website-qa-system.git
cd website-qa-system
npm install
npx playwright install chromium
```

Skapa sedan `.env` (se [kapitel 4](#4-konfiguration-env)) och starta:

```bash
npm run qa
```

Är du ny? Hoppa till [kapitel 3](#3-installation-steg-för-steg), där varje steg förklaras.

---

## 3. Installation steg för steg

Följ stegen i ordning. Allt är gratis. Räkna med 20–30 minuter första gången, mest för nedladdningar.

### Steg 1: Installera Node.js

Node.js är programmet som kör projektet.

1. Gå till **https://nodejs.org** och ladda ner versionen märkt **LTS**.
2. Installera med standardvalen (klicka *Next* hela vägen).
3. Starta om datorn eller öppna ett nytt terminalfönster.
4. Kontrollera att det fungerade:

```bash
node -v
npm -v
```

Du ska se versionsnummer, till exempel `v22.x.x`. Projektet kräver **Node.js 20 eller nyare**.

### Steg 2: Ladda ner projektet

Välj ett av alternativen.

**Alternativ A: Ladda ner som ZIP (enklast, kräver inget extra program)**

1. Gå till **https://github.com/moazam33r/website-qa-system**.
2. Klicka på den gröna knappen **Code** och välj **Download ZIP**.
3. Packa upp ZIP-filen, till exempel på skrivbordet.
4. Mappen heter `website-qa-system-main`. Du kan döpa om den till `website-qa-system`.

**Alternativ B: Klona med Git (rekommenderas om du vill uppdatera enkelt)**

1. Installera Git från **https://git-scm.com** om du inte har det.
2. Kör:

```bash
git clone https://github.com/moazam33r/website-qa-system.git
```

### Steg 3: Öppna en terminal i projektmappen

Alla kommandon nedan körs inne i projektmappen.

- **Windows:** öppna mappen i Utforskaren, klicka i adressfältet högst upp, skriv `powershell` och tryck Enter.
- **macOS:** högerklicka på mappen och välj *Ny terminal i mapp*.
- **VS Code:** öppna mappen (*File → Open Folder*) och välj *Terminal → New Terminal*.

Kontrollera att du står rätt. Kommandot `dir` (Windows) eller `ls` (macOS/Linux) ska visa bland annat `package.json`.

### Steg 4: Installera projektets beroenden

```bash
npm install
```

Det hämtar alla bibliotek som projektet behöver och tar någon minut. Du får en mapp som heter `node_modules`. Den ska du aldrig ändra själv.

### Steg 5: Installera webbläsaren som Playwright använder

```bash
npx playwright install chromium
```

Detta laddar ner en egen Chromium-webbläsare som systemet styr. På Linux kan du behöva:

```bash
npx playwright install --with-deps chromium
```

### Steg 6: Skapa din `.env`-fil

`.env` är en inställningsfil för dina egna värden. Den läggs aldrig upp på GitHub.

**Windows (PowerShell):**

```powershell
Copy-Item .env.example .env
```

**Windows (cmd):**

```cmd
copy .env.example .env
```

**macOS / Linux:**

```bash
cp .env.example .env
```

Öppna sedan `.env` i en textredigerare (t.ex. Anteckningar eller VS Code). Vad varje rad betyder står i [kapitel 4](#4-konfiguration-env). Du behöver inte ändra något för att komma igång, men prestandakontrollen kräver en API-nyckel (se nästa steg).

### Steg 7 (rekommenderas): Skaffa en Google PageSpeed-nyckel

Prestandakontrollen använder Googles PageSpeed Insights och behöver en gratis nyckel. Utan nyckel hoppas den kontrollen över och du får en varning.

1. Gå till **https://console.cloud.google.com** och logga in med ett Google-konto.
2. Skapa ett nytt projekt (valfritt namn).
3. Sök efter **PageSpeed Insights API** och klicka på **Enable**.
4. Gå till **APIs & Services → Credentials → Create credentials → API key**.
5. Kopiera nyckeln och klistra in den i `.env`:

```env
PAGESPEED_API_KEY=din_nyckel_här
```

### Steg 8 (rekommenderas): Installera Ollama och AI-modellen

Ollama kör AI-modellen lokalt på din dator. Den används för AI-sammanfattningen och för att sortera bort falska stavfelsträffar.

1. Ladda ner och installera Ollama från **https://ollama.com**.
2. Hämta modellen (cirka 2,5 GB, görs en gång):

```bash
ollama pull qwen3:4b
```

3. Kontrollera att modellen finns:

```bash
ollama list
```

4. Ollama ska köras i bakgrunden när du kör QA-systemet. På Windows och macOS startar den normalt automatiskt efter installationen. Kontrollera med:

```bash
curl http://127.0.0.1:11434
```

Svaret ska vara `Ollama is running`.

### Steg 9: Kontrollera att allt fungerar

```bash
npx tsc --noEmit
```

Om kommandot inte skriver ut några fel är installationen klar. Nu kan du köra din första skanning, se [kapitel 5](#5-så-använder-du-systemet).

---

## 4. Konfiguration (.env)

Alla inställningar ligger i filen `.env` i projektets rotmapp. Mallen finns i `.env.example`.

```env
# Google PageSpeed Insights API-nyckel.
# Lämna tom om prestandakontrollen inte ska användas.
PAGESPEED_API_KEY=

# Adressen till den lokala Ollama-servern.
OLLAMA_HOST=http://127.0.0.1:11434

# Lokal modell som används av AI-analysen.
OLLAMA_MODEL=qwen3:4b

# Maximal tid för ett Ollama-anrop i millisekunder (180000 = 3 minuter).
OLLAMA_TIMEOUT_MS=180000

# Sätt till true för extra felsökningsutskrift i terminalen (valfritt).
QA_DEBUG=false
```

| Variabel | Vad den gör | Standardvärde |
|---|---|---|
| `PAGESPEED_API_KEY` | Nyckel till Google PageSpeed Insights. Behövs för prestandakontrollen. | tom |
| `OLLAMA_HOST` | Adress till Ollama. Ändra bara om Ollama körs på en annan dator eller port. | `http://127.0.0.1:11434` |
| `OLLAMA_MODEL` | Vilken AI-modell som används. | `qwen3:4b` |
| `OLLAMA_TIMEOUT_MS` | Hur länge systemet väntar på AI-svar. Höj värdet om du får timeout på en långsam dator. | `180000` |
| `QA_DEBUG` | `true` visar en detaljerad tabell över textkontrollen i terminalen. | `false` |

Efter att du ändrat `.env` ska du starta om programmet.

---

## 5. Så använder du systemet

Det finns tre sätt. Börja med terminalen, det är enklast.

### Sätt 1: Skanna en webbplats i terminalen

1. Se till att Ollama körs (om du vill ha AI-analys).
2. Kör:

```bash
npm run qa
```

3. När det står `Ange webbplats:` skriver du adressen **med `https://`** och trycker Enter:

```text
> https://exempel.se/
```

4. Vänta medan systemet arbetar. Ett helt test tar vanligtvis flera minuter, beroende på antal sidor. Terminalen visar vad som pågår.
5. När det är klart skriver terminalen ut en sammanfattning och sökvägen till PDF-rapporten.

### Sätt 2: Skanna flera webbplatser från en CSV-fil

Skapa en fil, till exempel `webbplatser.csv`. **Första raden är en rubrik och hoppas över.** Därefter en webbadress per rad i första kolumnen:

```csv
URL
https://exempel.se/
https://annan-sajt.se/
```

Kör sedan:

```bash
npm run qa -- webbplatser.csv
```

Notera `--` före filnamnet, det behövs för att skicka filnamnet vidare.

I terminalläget skrivs resultatet för varje sajt ut i terminalen. Vill du ha en PDF per webbplats vid bulk-skanning, använd [Chrome-tillägget](#11-chrome-tillägget) eller [API:t](#10-rest-api).

### Sätt 3: Chrome-tillägget och API:t

För ett grafiskt gränssnitt, se [kapitel 11](#11-chrome-tillägget).

---

## 6. Var hamnar rapporten?

PDF-rapporten sparas i **datorns temporära mapp**, i en undermapp som heter `website-qa-system`. Filen heter `QA-Report-<domän>.pdf`. Terminalen skriver alltid ut den exakta sökvägen när rapporten är klar, till exempel:

```text
C:\Users\dittnamn\AppData\Local\Temp\website-qa-system\QA-Report-exempel.se.pdf
```

Öppna mappen:

- **Windows (PowerShell):** `explorer $env:TEMP\website-qa-system`
- **macOS/Linux:** sökvägen skrivs ut i terminalen, kopiera den.

Flytta eller kopiera rapporten till en annan plats om du vill spara den, eftersom temp-mappen kan rensas av systemet. Mappen `reports/` i projektet innehåller bara exempelrapporter.

---

## 7. Förstå resultatet

Varje kontroll får en av tre statusar:

| Status | Betydelse | Vad du ska göra |
|---|---|---|
| ✓ **PASS** | Kontrollen gick bra. | Inget. |
| ⚠ **WARNING** | Något kan förbättras, men inget är trasigt. | Granska och bedöm. |
| ✗ **FAIL** | Ett konkret fel hittades. | Utred och åtgärda. |

Exempel:

- **PASS:** alla länkar svarar med rätt statuskod.
- **WARNING:** ett telefonfält godkänner ett ogiltigt nummer, eller Google Business Profile hittades inte.
- **FAIL:** en bild är trasig eller en intern länk ger 404.

Det totala resultatet blir **FAIL** om minst en kontroll är FAIL, annars **WARNING** om minst en är WARNING, annars **PASS**.

### Prestanda

Prestandakontrollen mäter dator och mobil var för sig. Standard är att båda behöver minst **90/100** för PASS. Mellan 50 och gränsen är det WARNING, och under 50 är det FAIL. Gränserna kan ändras, se [kapitel 9](#9-anpassa-systemet).

Dessutom kan ett dåligt Core Web Vital (till exempel för hög LCP) sänka resultatet även om poängen är hög. Det kan stängas av.

### Statuskod 202

Vissa webbhotell (till exempel SiteGround) svarar med statuskod **202** och en kort "challenge"-sida innan den riktiga sidan visas. Systemet väntar och följer med när sidan laddas om. Om den riktiga sidan aldrig laddas räknas sidan som att den inte fungerar. På SiteGrounds tillfälliga `sg-host.com`-adresser kan alternativa domäner visas som "kunde inte verifieras", vilket inte är ett fel på sajten.

---

## 8. Alla kontroller

| Kontroll | Vad den kontrollerar |
|---|---|
| **Sidor** | Crawlar webbplatsen och kontrollerar att varje sida svarar. Bilder, PDF:er och andra filer räknas inte som sidor. |
| **SEO** | H1, meta description, canonical, alt-texter på bilder och andra SEO-element. |
| **Prestanda** | Poäng och Core Web Vitals (LCP, CLS, TBT, FCP) för dator och mobil via Google PageSpeed. |
| **Responsivitet** | Att sidorna fungerar i mobilvy. |
| **Cookie / GDPR** | Att en cookie- eller integritetspolicy finns. |
| **HTTPS / Security** | Att webbplatsen använder HTTPS och vissa säkerhetsförhållanden. |
| **Alternativa domäner** | Att varianter med och utan `www` samt `http`/`https` fungerar. |
| **Liknande domäner** | Söker efter andra domäner som liknar företagsnamnet. |
| **Text / stavning** | Svensk stavnings- och grammatikkontroll (LanguageTool) med AI-filtrering av falska träffar. |
| **Länkar** | Interna och externa länkar, telefonlänkar och om länkar leder till rätt typ av sida. |
| **Bilder** | Att bilder laddas. |
| **Formulär** | Hittar formulär och fält samt vilka som är obligatoriska. |
| **Validering** | Testar att e-post- och telefonfält stoppar ogiltiga värden. |
| **Navigation** | Att menyn och interna navigeringsvägar fungerar. |
| **CTA** | Att knappar och länkar för handling (till exempel "Kontakta oss") fungerar. |
| **Sociala medier** | Hittar Facebook, Instagram, LinkedIn med flera och kontrollerar att profilen verkar tillhöra företaget. |
| **Google Maps** | Letar efter Google Maps-karta eller länk. |
| **Google Business Profile** | Letar efter företagets Google-profil. |
| **AI-analys** | Sammanfattar allt, pekar ut viktigaste problemen och ger rekommendationer. |

### Om sociala medier

Kontrollen jämför profilens namn med företagets namn. Företagsnamnet hämtas från sidans metadata, JSON-LD, sidfotens copyright-rad och domännamnet. Små stavningsskillnader tolereras. Om en Facebook-profil bara har ett ID i adressen försöker systemet läsa profilens namn från sidan. Går det inte visas profilen som **"kunde inte verifieras automatiskt"** (WARNING), och du bör kontrollera den manuellt.

---

## 9. Anpassa systemet

### Prestandagränser

Öppna `src/checks/performance.ts`. Överst i filen finns:

```ts
const DESKTOP_PASS_SCORE = 90;
const MOBILE_PASS_SCORE = 90;
const FAIL_SCORE = 50;

// true  = ett dåligt Core Web Vital ger WARNING/FAIL även om poängen är hög.
// false = endast poängen avgör.
const CORE_WEB_VITALS_CAN_OVERRIDE_SCORE = true;
```

Diagrammet i PDF-rapporten har egna målvärden i `src/report/pdf-report.ts`:

```ts
const DESKTOP_PERFORMANCE_TARGET = 90;
const MOBILE_PERFORMANCE_TARGET = 90;
```

Ändrar du gränserna i `performance.ts` bör du ändra samma värden i `pdf-report.ts`, annars visar diagrammet fel mål.

### Felsökningsutskrift

Sätt `QA_DEBUG=true` i `.env` för att se en detaljerad tabell över textkontrollen (LanguageTool mot AI-bedömning).

### Byta AI-modell

Hämta en annan modell med `ollama pull <modellnamn>` och ändra `OLLAMA_MODEL` i `.env`. Större modeller ger ofta bättre analys men är långsammare.

---

## 10. REST API

API:t används av Chrome-tillägget, men du kan också anropa det själv.

Starta servern:

```bash
npm run api
```

Den körs på `http://localhost:3000`. Lämna terminalfönstret öppet så länge du använder API:t.

| Metod | Endpoint | Beskrivning |
|---|---|---|
| `GET` | `/api/health` | Kontrollerar att servern fungerar. |
| `POST` | `/api/scan` | Skannar en webbplats och svarar när allt (inklusive PDF) är klart. |
| `POST` | `/api/scan-progress` | Skannar en webbplats och rapporterar riktig progress under tiden. |
| `POST` | `/api/scan-csv` | Skannar flera webbplatser. |
| `POST` | `/api/scan-csv-progress` | Skannar flera webbplatser med progress. |
| `GET` | `/api/reports/:filename` | Hämtar en skapad PDF-rapport. |

Webbadressen måste börja med `http://` eller `https://`.

**Exempel (PowerShell):**

```powershell
Invoke-RestMethod http://localhost:3000/api/health
```

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/scan `
  -ContentType "application/json" `
  -Body '{"url":"https://exempel.se/"}'
```

**Exempel (macOS/Linux):**

```bash
curl -X POST http://localhost:3000/api/scan \
  -H "Content-Type: application/json" \
  -d '{"url":"https://exempel.se/"}'
```

Mer om API-testerna finns i `docs/API-TEST.md`.

---

## 11. Chrome-tillägget

Tillägget är ett grafiskt gränssnitt mot API:t. Du kan skanna en sajt eller ladda upp en CSV-/Excel-fil med flera webbplatser.

1. Starta API:t i en terminal och lämna det öppet:

```bash
npm run api
```

2. Öppna Chrome och skriv `chrome://extensions/` i adressfältet.
3. Slå på **Developer mode** (uppe till höger).
4. Klicka på **Load unpacked**.
5. Välj mappen `extension/` i projektet.
6. Klicka på pussel-ikonen i Chrome och fäst **Website QA System** i verktygsfältet.
7. Klicka på tillägget, skriv en webbadress (med `https://`) och starta skanningen.

Tillägget pratar med `http://localhost:3000`, så API-servern måste köra medan du använder det.

---

## 12. Tester och kodkontroll

### Automatiserade tester

Projektet har tester i mappen `tests/` som körs med Playwright:

```bash
npm test
```

(Samma sak som `npx playwright test`.)

### TypeScript-kontroll

Kontrollerar koden utan att köra den:

```bash
npx tsc --noEmit
```

Inga utskrifter betyder att allt är rätt.

---

## 13. Projektstruktur

```text
website-qa-system/
│
├── src/
│   ├── cli.ts               # Startpunkt för terminalkörning (npm run qa)
│   ├── website-scanner.ts   # Styr hela skanningen och samlar alla resultat
│   ├── ai/                  # Ollama-integration, AI-analys och textgranskning
│   ├── api/                 # Express-server (REST API)
│   ├── checks/              # Alla QA-kontroller, en fil per kontroll
│   └── report/              # Rapportutskrift och PDF-generering
│
├── tests/                   # Automatiserade Playwright-tester
├── extension/               # Chrome-tillägg (Manifest V3)
├── docs/                    # Dokumentation, t.ex. API-test
├── reports/                 # Exempelrapporter (PDF)
├── config/                  # Konfigurationsmapp
│
├── .env.example             # Mall för inställningar (kopieras till .env)
├── package.json             # Projektets beroenden och kommandon
├── playwright.config.ts     # Inställningar för Playwright
├── tsconfig.json            # TypeScript-inställningar
└── README.md
```

### Kommandon

| Kommando | Vad det gör |
|---|---|
| `npm install` | Installerar beroenden. |
| `npm run qa` | Startar en skanning i terminalen. |
| `npm run qa -- fil.csv` | Skannar flera webbplatser från en CSV-fil. |
| `npm run api` | Startar REST API:t (och används av Chrome-tillägget). |
| `npm test` | Kör de automatiserade testerna. |
| `npx tsc --noEmit` | Kontrollerar TypeScript-koden. |

---

## 14. Säkerhet och integritet

- **`.env` ska aldrig laddas upp till GitHub.** Den är redan exkluderad via `.gitignore`. Lägg aldrig API-nycklar direkt i koden eller i README.
- **Skanna bara webbplatser du har tillåtelse att testa.** Systemet besöker många sidor och fyller i formulär med testvärden.
- **AI-analysen körs lokalt** via Ollama. Ingen QA-data skickas till en extern AI-tjänst.
- **Vissa kontroller använder externa tjänster:**
  - Prestanda: webbadressen skickas till **Google PageSpeed Insights**.
  - Text/stavning: sidornas text skickas till den publika tjänsten **LanguageTool** (`api.languagetool.org`). Den kräver internetanslutning och har användningsgränser.
  - Kontrollen av liknande domäner gör sökningar på internet.

Det betyder att systemet inte är helt offline. Skanna inte sidor med känsligt eller privat innehåll om du inte vill att texten lämnar din dator.

---

## 15. Felsökning

### `node` eller `npm` känns inte igen

Node.js är inte installerat eller terminalen öppnades före installationen. Installera Node.js (steg 1) och öppna ett **nytt** terminalfönster.

### PowerShell säger att skript är blockerade (`npm.ps1 cannot be loaded`)

Windows blockerar skript som standard. Kör detta en gång i PowerShell och försök igen:

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

Eller använd vanlig **cmd** i stället för PowerShell.

### `Executable doesn't exist` eller Playwright hittar ingen webbläsare

Installera webbläsaren igen:

```bash
npx playwright install chromium
```

### Ollama svarar inte / AI-analysen misslyckas

1. Kontrollera att Ollama körs: `curl http://127.0.0.1:11434`.
2. Kontrollera att modellen finns: `ollama list`. Saknas den, kör `ollama pull qwen3:4b`.
3. Kontrollera att `OLLAMA_HOST` och `OLLAMA_MODEL` i `.env` stämmer.
4. Får du timeout på en långsam dator, höj `OLLAMA_TIMEOUT_MS`, till exempel till `300000`.
5. Står det att svaret kapades eller att genereringsgränsen nåddes är gränsen för hur långt AI-svaret får vara (`num_predict`) för låg. Den ställs in i `src/ai/ollama-worker.ts`.

### `PAGESPEED_API_KEY saknas i .env`

Prestandakontrollen kan inte köras utan nyckel. Följ steg 7 i installationen och starta om programmet.

### Prestandakontrollen misslyckas eller ger 429

Googles API har användningsgränser. Vänta en stund och försök igen.

### Text-/stavningskontrollen misslyckas

LanguageTool är en publik tjänst som kräver internet och har gränser per minut. Försök igen om en stund.

### Port 3000 används redan (API)

Ett annat program (eller en tidigare API-server) använder porten. Stäng det, eller avsluta tidigare terminalfönster med `Ctrl + C`.

### Chrome-tillägget kan inte ansluta

- Kontrollera att `npm run api` körs och att terminalen är öppen.
- Öppna `http://localhost:3000/api/health` i webbläsaren. Du ska se `status: ok`.
- Ladda om tillägget på `chrome://extensions/`.
- Titta efter felmeddelanden i Chrome DevTools.

### Startsidan svarar med 202 eller sajten blockerar skanningen

Webbhotellet har ett bot-skydd. Lägg din IP-adress på godkänd-lista (allowlist) hos webbhotellet, eller stäng av skyddet tillfälligt under testet.

### Rapporten hittas inte

PDF:en sparas i temp-mappen. Se [kapitel 6](#6-var-hamnar-rapporten). Sökvägen skrivs ut i terminalen när skanningen är klar.

---

## 16. Utveckling och Git

Rekommenderad arbetsgång när du lägger till eller ändrar en kontroll:

1. Gör ändringen.
2. Lägg till eller uppdatera ett test i `tests/`.
3. Kör `npm test`.
4. Kör `npx tsc --noEmit`.
5. Kör en fullständig skanning med `npm run qa`.
6. Commit:a och pusha:

```bash
git add .
git commit -m "feat: beskriv ändringen kort"
git push origin main
```

Kontrollera med `git status` att `.env` **inte** finns med bland filerna som ska committas.

---

**Författare:** Moaz Ameer  
**Licens:** ISC  
**GitHub:** https://github.com/moazam33r/website-qa-system
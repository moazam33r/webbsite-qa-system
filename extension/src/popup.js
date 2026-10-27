// =========================================================
// API-ENDPOINTS
// =========================================================

// API-endpoint för vanlig QA-skanning.
const API_URL = "http://localhost:3000/api/scan";

// API-endpoint för vanlig QA-skanning med riktig progress.
const SCAN_PROGRESS_API_URL =
    "http://localhost:3000/api/scan-progress";

// API-endpoint för bulk-skanning.
// Samma endpoint används för CSV och Excel eftersom
// frontend omvandlar Excel-filen till en URL-lista.
const CSV_API_URL =
    "http://localhost:3000/api/scan-csv";

// API-endpoint för bulk-skanning med riktig progress.
const CSV_PROGRESS_API_URL =
    "http://localhost:3000/api/scan-csv-progress";

// Basadress till backend-servern.
const API_BASE_URL =
    "http://localhost:3000";


// =========================================================
// HTML-ELEMENT
// =========================================================

// Inputfält för vanlig webbplats.
const urlInput =
    document.getElementById("url");

// Knapp för vanlig QA-skanning.
const startButton =
    document.getElementById("scanButton");

// Filväljare för CSV, XLSX och XLS.
const csvFileInput =
    document.getElementById("csvFile");

// Området där användaren kan dra in en fil.
const csvDropzone =
    document.getElementById("csvDropzone");

// Området där vald fil visas.
const selectedFile =
    document.getElementById("selectedFile");

// Elementet där filnamnet visas.
const selectedFileName =
    document.getElementById("selectedFileName");

// Knapp för bulk-skanning.
const csvScanButton =
    document.getElementById("csvScanButton");

// Progress-container.
const progressContainer =
    document.getElementById("progressContainer");

// Progress-status.
const progressStatus =
    document.getElementById("progressStatus");

// Progress-procent.
const progressPercent =
    document.getElementById("progressPercent");

// Själva progressbaren.
const progressFill =
    document.getElementById("progressFill");

// Statusfält.
const statusElement =
    document.getElementById("status");

// Resultatområde.
const resultsElement =
    document.getElementById("results");

// Området som innehåller PDF-knapparna.
const pdfSection =
    document.getElementById("pdfSection");

// Knapp för att öppna PDF.
const pdfButton =
    document.getElementById("pdfButton");

// Knapp för att ladda ner PDF.
const downloadPdfButton =
    document.getElementById("downloadPdfButton");


// =========================================================
// VARIABLER
// =========================================================

// URL till senaste PDF-rapporten.
let latestPdfUrl = null;

// Aktuell progress.
let currentProgress = 0;

// Webbplatser i aktuell bulk-skanning.
let csvWebsites = [];

// Antal färdiganalyserade webbplatser.
let csvCompletedCount = 0;

// Progress för varje webbplats.
let csvSitePercentages = [];


// =========================================================
// VAL AV TESTER
// =========================================================

// Alla tester som kan väljas. Id:n måste matcha servern
// (QA_TESTS i src/website-scanner.ts).
const QA_TESTS = [
    { id: "seo", label: "SEO" },
    { id: "performance", label: "Prestanda" },
    { id: "responsive", label: "Responsivitet" },
    { id: "cookie", label: "Cookie / GDPR" },
    { id: "security", label: "HTTPS / säkerhet" },
    { id: "domains", label: "Alternativa domäner" },
    { id: "similar", label: "Liknande domäner" },
    { id: "text", label: "Text / stavning" },
    { id: "links", label: "Länkar" },
    { id: "images", label: "Bilder" },
    { id: "forms", label: "Formulär" },
    { id: "email", label: "E-postvalidering" },
    { id: "phone", label: "Telefonvalidering" },
    { id: "navigation", label: "Navigation" },
    { id: "cta", label: "CTA" },
    { id: "social", label: "Sociala medier" },
    { id: "maps", label: "Google Maps" },
    { id: "gbp", label: "Google Business Profile" },
    { id: "ai", label: "AI-analys" }
];

const TEST_SELECTION_KEY = "qaTestSelection";

// Aktuellt val. mode "all" = hela analysen.
let testSelection = {
    mode: "all",
    selected: QA_TESTS.map((test) => test.id)
};

// Lagring som tål att chrome.storage saknas.
function loadTestSelection(callback) {

    const apply = (saved) => {

        if (
            saved &&
            (saved.mode === "all" || saved.mode === "custom") &&
            Array.isArray(saved.selected)
        ) {
            testSelection = {
                mode: saved.mode,
                selected: saved.selected.filter((id) =>
                    QA_TESTS.some((test) => test.id === id)
                )
            };
        }

        callback();
    };

    try {

        if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {

            chrome.storage.local.get(TEST_SELECTION_KEY, (items) => {
                apply(items ? items[TEST_SELECTION_KEY] : null);
            });

            return;
        }

        apply(JSON.parse(localStorage.getItem(TEST_SELECTION_KEY)));

    } catch (error) {
        apply(null);
    }
}

function saveTestSelection() {

    try {

        if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({ [TEST_SELECTION_KEY]: testSelection });
            return;
        }

        localStorage.setItem(TEST_SELECTION_KEY, JSON.stringify(testSelection));

    } catch (error) {
        // Valet används ändå under den här körningen.
    }
}

// Vad som skickas till servern. undefined = hela analysen.
function getSelectedTests() {

    if (testSelection.mode === "all") {
        return undefined;
    }

    return testSelection.selected.slice();
}

// Falskt om läget är Välj tester och inget är valt.
function hasValidTestSelection() {

    return (
        testSelection.mode === "all" ||
        testSelection.selected.length > 0
    );
}

function renderTestSelector() {

    const modeAll = document.getElementById("modeAll");
    const modeCustom = document.getElementById("modeCustom");
    const picker = document.getElementById("testPicker");
    const list = document.getElementById("testList");
    const summary = document.getElementById("testSummary");

    if (!modeAll || !modeCustom || !picker || !list || !summary) {
        return;
    }

    const custom = testSelection.mode === "custom";

    modeAll.classList.toggle("active", !custom);
    modeCustom.classList.toggle("active", custom);
    modeAll.setAttribute("aria-checked", String(!custom));
    modeCustom.setAttribute("aria-checked", String(custom));

    picker.hidden = !custom;

    list.innerHTML = "";

    QA_TESTS.forEach((test) => {

        const label = document.createElement("label");
        label.className = "test-item";

        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = testSelection.selected.includes(test.id);

        box.addEventListener("change", () => {

            const selected = new Set(testSelection.selected);

            if (box.checked) {
                selected.add(test.id);
            } else {
                selected.delete(test.id);
            }

            testSelection.selected =
                QA_TESTS.map((t) => t.id).filter((id) => selected.has(id));

            saveTestSelection();
            renderTestSummary();
        });

        const text = document.createElement("span");
        text.textContent = test.label;

        label.appendChild(box);
        label.appendChild(text);
        list.appendChild(label);
    });

    renderTestSummary();
}

function renderTestSummary() {

    const summary = document.getElementById("testSummary");

    if (!summary) {
        return;
    }

    summary.classList.remove("warn");

    if (testSelection.mode === "all") {
        summary.textContent = "Alla tester körs.";
        return;
    }

    const count = testSelection.selected.length;

    if (count === 0) {
        summary.textContent = "Välj minst ett test.";
        summary.classList.add("warn");
        return;
    }

    summary.textContent =
        `${count} av ${QA_TESTS.length} tester körs.`;
}

function setupTestSelector() {

    const modeAll = document.getElementById("modeAll");
    const modeCustom = document.getElementById("modeCustom");
    const selectAll = document.getElementById("selectAllTests");
    const clearAll = document.getElementById("clearAllTests");

    if (!modeAll || !modeCustom) {
        return;
    }

    modeAll.addEventListener("click", () => {
        testSelection.mode = "all";
        saveTestSelection();
        renderTestSelector();
    });

    modeCustom.addEventListener("click", () => {
        testSelection.mode = "custom";
        saveTestSelection();
        renderTestSelector();
    });

    selectAll.addEventListener("click", () => {
        testSelection.selected = QA_TESTS.map((test) => test.id);
        saveTestSelection();
        renderTestSelector();
    });

    clearAll.addEventListener("click", () => {
        testSelection.selected = [];
        saveTestSelection();
        renderTestSelector();
    });

    loadTestSelection(renderTestSelector);
}

setupTestSelector();


// =========================================================
// FILTYPER
// =========================================================

// Kontrollerar om filen är CSV, XLSX eller XLS.
function isSupportedFile(file) {

    // Kontrollera att filen finns.
    if (!file || !file.name) {
        return false;
    }

    // Hämtar filändelsen.
    const fileName =
        file.name.toLowerCase();

    // Returnerar true för alla tre filtyper.
    return (
        fileName.endsWith(".csv") ||
        fileName.endsWith(".xlsx") ||
        fileName.endsWith(".xls")
    );
}


// =========================================================
// VISA VALD FIL
// =========================================================

// Uppdaterar UI:t när användaren väljer en fil.
function showSelectedCSVFile(file) {

    // Kontrollera att en fil finns.
    if (!file) {
        return;
    }

    // Visa filens namn.
    selectedFileName.textContent =
        file.name;

    // Visa vald fil.
    selectedFile.hidden = false;
}


// =========================================================
// FILVÄLJARE
// =========================================================

// Körs när användaren väljer en fil.
csvFileInput.addEventListener(
    "change",
    () => {

        // Hämtar den valda filen.
        const file =
            csvFileInput.files[0];

        // Kontrollera filtypen.
        if (!isSupportedFile(file)) {

            // Rensa filväljaren.
            csvFileInput.value = "";

            // Visa felmeddelande.
            setStatus(
                "Välj en CSV-, XLSX- eller XLS-fil."
            );

            return;
        }

        // Visa filen i UI:t.
        showSelectedCSVFile(file);

        // Visa information om vald fil.
        setStatus(
            `Fil vald: ${file.name}`
        );
    }
);


// =========================================================
// DRAG & DROP
// =========================================================

// Förhindrar webbläsaren från att öppna filen direkt.
csvDropzone.addEventListener(
    "dragover",
    (event) => {

        // Förhindrar standardbeteendet.
        event.preventDefault();

        // Markerar drop-zonen visuellt.
        csvDropzone.classList.add(
            "drag-active"
        );
    }
);


// När användaren lämnar drop-zonen.
csvDropzone.addEventListener(
    "dragleave",
    () => {

        // Tar bort markeringen.
        csvDropzone.classList.remove(
            "drag-active"
        );
    }
);


// När användaren släpper en fil.
csvDropzone.addEventListener(
    "drop",
    (event) => {

        // Förhindrar webbläsaren från att öppna filen.
        event.preventDefault();

        // Tar bort markeringen.
        csvDropzone.classList.remove(
            "drag-active"
        );

        // Hämtar första filen.
        const file =
            event.dataTransfer.files[0];

        // Kontrollera filtypen.
        if (!isSupportedFile(file)) {

            setStatus(
                "Välj en CSV-, XLSX- eller XLS-fil."
            );

            return;
        }

        // Skapar ett DataTransfer-objekt.
        const dataTransfer =
            new DataTransfer();

        // Lägger till filen.
        dataTransfer.items.add(file);

        // Uppdaterar file-input.
        csvFileInput.files =
            dataTransfer.files;

        // Visar filnamnet.
        showSelectedCSVFile(file);

        // Visar information.
        setStatus(
            `Fil vald: ${file.name}`
        );
    }
);


// =========================================================
// URL-HANTERING
// =========================================================

// Gör om användarens inmatning till en komplett URL.
function normalizeWebsiteUrl(value) {

    // Gör om värdet till text.
    let url =
        String(value || "").trim();

    // Tar bort BOM.
    url =
        url.replace(/^\uFEFF/, "");

    // Tar bort citattecken.
    url =
        url
            .replace(/^["']|["']$/g, "")
            .trim();

    // Tom text ger tom URL.
    if (!url) {
        return "";
    }

    // Om URL redan har HTTP eller HTTPS
    // används den som den är.
    if (
        url.toLowerCase().startsWith("http://") ||
        url.toLowerCase().startsWith("https://")
    ) {
        return url;
    }

    // Lägg till HTTPS om protokoll saknas.
    return `https://${url}`;
}


// =========================================================
// KONTROLLERA OM TEXT ÄR EN WEBBPLATS
// =========================================================

// Kontrollerar om ett textvärde ser ut som en domän.
function looksLikeWebsite(value) {

    // Rensa värdet.
    const text =
        String(value || "")
            .trim()
            .replace(/^\uFEFF/, "")
            .replace(/^["']|["']$/g, "")
            .trim();

    // Tom text kan inte vara en webbplats.
    if (!text) {
        return false;
    }

    // Ta bort HTTP/HTTPS.
    const withoutProtocol =
        text
            .replace(/^https?:\/\//i, "")
            .trim();

    // Ta bort sökväg.
    const hostnamePart =
        withoutProtocol.split("/")[0];

    // Ta bort portnummer.
    const hostname =
        hostnamePart.split(":")[0];

    // Kontrollerar vanliga domännamn.
    const domainPattern =
        /^(www\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

    return domainPattern.test(hostname);
}


// =========================================================
// CSV-FÄLT
// =========================================================

// Tar bort citattecken och mellanslag.
function cleanCSVField(value) {

    return String(value || "")
        .replace(/^\uFEFF/, "")
        .trim()
        .replace(/^"(.*)"$/s, "$1")
        .replace(/^'(.*)'$/s, "$1")
        .trim();
}


// =========================================================
// HITTA CSV-DELIMITER
// =========================================================

// Försöker hitta vilket CSV-format filen använder.
function detectCSVDelimiter(text) {

    // Hämtar de första raderna.
    const sample =
        text
            .split(/\r?\n/)
            .slice(0, 10)
            .join("\n");

    // Räknar komma.
    const commaCount =
        (sample.match(/,/g) || []).length;

    // Räknar semikolon.
    const semicolonCount =
        (sample.match(/;/g) || []).length;

    // Räknar tab.
    const tabCount =
        (sample.match(/\t/g) || []).length;

    // Semikolon används om det förekommer mest.
    if (
        semicolonCount > commaCount &&
        semicolonCount >= tabCount
    ) {
        return ";";
    }

    // Tab används om det förekommer mest.
    if (
        tabCount > commaCount &&
        tabCount > semicolonCount
    ) {
        return "\t";
    }

    // Komma används som standard.
    return ",";
}


// =========================================================
// PARSA CSV
// =========================================================

// Enkel men robust CSV-parser.
//
// Hanterar:
// - komma
// - semikolon
// - tab
// - citattecken
// - komma inne i citattecken
// - radbrytningar inne i citattecken
function parseCSV(
    text,
    delimiter
) {

    // Resultatet blir en lista med rader.
    const rows = [];

    // Aktuell rad.
    let row = [];

    // Aktuellt fält.
    let field = "";

    // Anger om vi befinner oss inne i citattecken.
    let insideQuotes = false;

    // Går igenom varje tecken.
    for (
        let i = 0;
        i < text.length;
        i++
    ) {

        const char =
            text[i];

        // Hanterar citattecken.
        if (char === '"') {

            // Två citattecken efter varandra
            // betyder ett escaped citattecken.
            if (
                insideQuotes &&
                text[i + 1] === '"'
            ) {

                field += '"';

                i++;

                continue;
            }

            // Växlar mellan citattecken.
            insideQuotes =
                !insideQuotes;

            continue;
        }

        // Delimiter avslutar ett fält.
        if (
            char === delimiter &&
            !insideQuotes
        ) {

            row.push(
                cleanCSVField(field)
            );

            field = "";

            continue;
        }

        // Radbrytning avslutar en rad.
        if (
            (char === "\n" ||
                char === "\r") &&
            !insideQuotes
        ) {

            // Hanterar Windows-radbrytning.
            if (
                char === "\r" &&
                text[i + 1] === "\n"
            ) {
                continue;
            }

            // Lägg till sista fältet.
            row.push(
                cleanCSVField(field)
            );

            // Lägg till raden om den innehåller data.
            if (
                row.some(
                    value =>
                        value.length > 0
                )
            ) {

                rows.push(row);
            }

            // Börja på ny rad.
            row = [];

            field = "";

            continue;
        }

        // Vanligt tecken läggs till.
        field += char;
    }

    // Hantera sista fältet.
    row.push(
        cleanCSVField(field)
    );

    // Hantera sista raden.
    if (
        row.some(
            value =>
                value.length > 0
        )
    ) {

        rows.push(row);
    }

    return rows;
}


// =========================================================
// HÄMTA WEBBPLATSER FRÅN CSV
// =========================================================

// Hittar webbplatser i hela CSV-filen.
function extractWebsitesFromCSV(
    csvText
) {

    // Ta bort BOM.
    const cleanedText =
        String(csvText || "")
            .replace(/^\uFEFF/, "");

    // Tom fil ger tom lista.
    if (!cleanedText.trim()) {
        return [];
    }

    // Hitta delimiter.
    const delimiter =
        detectCSVDelimiter(
            cleanedText
        );

    // Parsar CSV.
    const rows =
        parseCSV(
            cleanedText,
            delimiter
        );

    // Lista med hittade webbplatser.
    const foundWebsites = [];

    // Går igenom varje rad.
    rows.forEach(
        (row) => {

            // Går igenom varje cell.
            row.forEach(
                (cell) => {

                    // Rensa cellen.
                    const value =
                        cleanCSVField(cell);

                    // Hoppa över tomma celler.
                    if (!value) {
                        return;
                    }

                    // Gör värdet till lowercase.
                    const lowerValue =
                        value.toLowerCase();

                    // Hoppa över vanliga rubriker.
                    if (
                        lowerValue === "url" ||
                        lowerValue === "website" ||
                        lowerValue === "webbplats" ||
                        lowerValue === "webbsida" ||
                        lowerValue === "website url" ||
                        lowerValue === "websiteurl"
                    ) {
                        return;
                    }

                    // Kontrollera om cellen är en webbplats.
                    if (
                        !looksLikeWebsite(
                            value
                        )
                    ) {
                        return;
                    }

                    // Gör URL komplett.
                    const normalizedUrl =
                        normalizeWebsiteUrl(
                            value
                        );

                    // Lägg till URL.
                    if (normalizedUrl) {

                        foundWebsites.push(
                            normalizedUrl
                        );
                    }
                }
            );
        }
    );

    // Ta bort dubbletter.
    return [
        ...new Set(
            foundWebsites
        )
    ];
}


// =========================================================
// HÄMTA WEBBPLATSER FRÅN EXCEL
// =========================================================

// Läser XLSX/XLS och letar efter webbplatser
// i alla celler i arbetsbokens första blad.
function extractWebsitesFromExcel(
    arrayBuffer
) {

    // Kontrollera att XLSX-biblioteket finns.
    if (
        typeof XLSX === "undefined"
    ) {

        throw new Error(
            "Excel-biblioteket kunde inte laddas."
        );
    }

    // Läser Excel-filen.
    const workbook =
        XLSX.read(
            arrayBuffer,
            {
                type: "array"
            }
        );

    // Kontrollera att Excel-filen innehåller blad.
    if (
        !workbook.SheetNames ||
        workbook.SheetNames.length === 0
    ) {

        return [];
    }

    // Vi använder första bladet.
    const firstSheetName =
        workbook.SheetNames[0];

    // Hämtar första bladet.
    const firstSheet =
        workbook.Sheets[
            firstSheetName
        ];

    // Gör om Excel-bladet till en array med rader.
    const rows =
        XLSX.utils.sheet_to_json(
            firstSheet,
            {
                header: 1,
                defval: ""
            }
        );

    // Lista med hittade webbplatser.
    const foundWebsites = [];

    // Går igenom varje rad.
    rows.forEach(
        (row) => {

            // Säkerställ att raden är en array.
            if (!Array.isArray(row)) {
                return;
            }

            // Går igenom varje cell.
            row.forEach(
                (cell) => {

                    // Rensa cellen.
                    const value =
                        String(cell || "")
                            .trim();

                    // Hoppa över tomma celler.
                    if (!value) {
                        return;
                    }

                    // Gör värdet till lowercase.
                    const lowerValue =
                        value.toLowerCase();

                    // Hoppa över vanliga rubriker.
                    if (
                        lowerValue === "url" ||
                        lowerValue === "website" ||
                        lowerValue === "webbplats" ||
                        lowerValue === "webbsida" ||
                        lowerValue === "website url" ||
                        lowerValue === "websiteurl"
                    ) {
                        return;
                    }

                    // Kontrollera om cellen är en webbplats.
                    if (
                        !looksLikeWebsite(
                            value
                        )
                    ) {
                        return;
                    }

                    // Gör URL komplett.
                    const normalizedUrl =
                        normalizeWebsiteUrl(
                            value
                        );

                    // Lägg till URL.
                    if (normalizedUrl) {

                        foundWebsites.push(
                            normalizedUrl
                        );
                    }
                }
            );
        }
    );

    // Ta bort dubbletter.
    return [
        ...new Set(
            foundWebsites
        )
    ];
}


// =========================================================
// LÄS FIL OCH HITTA WEBBPLATSER
// =========================================================

// Gemensam funktion för CSV, XLSX och XLS.
async function extractWebsitesFromFile(
    file
) {

    // Kontrollera filtypen.
    if (!isSupportedFile(file)) {

        throw new Error(
            "Filen måste vara CSV, XLSX eller XLS."
        );
    }

    // Hämtar filnamnet.
    const fileName =
        file.name.toLowerCase();

    // =====================================================
    // CSV
    // =====================================================

    // CSV läses direkt som text.
    if (
        fileName.endsWith(".csv")
    ) {

        // Läser filen.
        const csvText =
            await file.text();

        // Använder befintlig CSV-parser.
        return extractWebsitesFromCSV(
            csvText
        );
    }

    // =====================================================
    // XLSX / XLS
    // =====================================================

    // Excel-filer läses som ArrayBuffer.
    const arrayBuffer =
        await file.arrayBuffer();

    // Använder XLSX-biblioteket.
    return extractWebsitesFromExcel(
        arrayBuffer
    );
}


// =========================================================
// STATUS
// =========================================================

// Visar meddelande i statusfältet.
function setStatus(message) {

    statusElement.textContent =
        message;
}


// =========================================================
// PROGRESSBAR
// =========================================================

// Uppdaterar progressbaren.
//
// Progressen kommer från backend.
// Funktionen tillåter aldrig att progress går bakåt.
function updateProgress(
    value,
    message = null
) {

    // Gör om värdet till nummer.
    const numericValue =
        Number(value);

    // Använd aktuell progress om värdet är ogiltigt.
    const safeValue =
        Number.isFinite(numericValue)
            ? numericValue
            : currentProgress;

    // Begränsa mellan 0 och 100.
    const nextProgress =
        Math.max(
            0,
            Math.min(
                100,
                Math.round(
                    safeValue
                )
            )
        );

    // Progress får inte gå bakåt.
    if (
        nextProgress <
        currentProgress
    ) {
        return;
    }

    // Spara progress.
    currentProgress =
        nextProgress;

    // Uppdatera procenttext.
    progressPercent.textContent =
        `${currentProgress}%`;

    // Uppdatera progressbar.
    progressFill.style.width =
        `${currentProgress}%`;

    // Uppdatera meddelande.
    if (message) {

        progressStatus.textContent =
            message;
    }
}


// =========================================================
// STARTA VANLIG PROGRESS
// =========================================================

// Förbereder progressbaren för en ny skanning.
function startProgress() {

    // Börja från 0%.
    currentProgress = 0;

    // Visa startmeddelande.
    updateProgress(
        0,
        "Startar QA-skanning..."
    );

    // Visa progressområdet.
    progressContainer.hidden =
        false;

    // Dölj PDF tills analysen är klar.
    pdfSection.hidden =
        true;

    // Dölj PDF-knapparna.
    pdfButton.hidden =
        true;

    downloadPdfButton.hidden =
        true;
}


// =========================================================
// BULK-SIDOR
// =========================================================

// Visar status för varje webbplats.
function renderCSVSiteProgress() {

    // Ta bort tidigare lista.
    const oldList =
        document.querySelector(
            ".csv-site-progress"
        );

    if (oldList) {
        oldList.remove();
    }

    // Skapa nytt område.
    const progressList =
        document.createElement(
            "div"
        );

    progressList.className =
        "csv-site-progress";

    // Skapa rubrik.
    const heading =
        document.createElement(
            "div"
        );

    heading.className =
        "csv-progress-title";

    heading.innerHTML =
        "<strong>BULK QA-ANALYS</strong>";

    progressList.appendChild(
        heading
    );

    // Gå igenom alla webbplatser.
    csvWebsites.forEach(
        (websiteUrl, index) => {

            // Skapa rad.
            const row =
                document.createElement(
                    "div"
                );

            row.className =
                "csv-site-row";

            // Standardstatus = väntar.
            let icon = "○";
            let statusText = "Väntar";

            // Hämta individuell progress.
            const sitePercentage =
                csvSitePercentages[index] ||
                0;

            // Webbplatsen är färdig.
            if (
                index <
                csvCompletedCount
            ) {

                icon = "✓";

                statusText =
                    "Klar — 100%";

            // Webbplatsen körs just nu.
            } else if (
                index ===
                csvCompletedCount
            ) {

                icon = "⟳";

                statusText =
                    `Analyserar... — ${sitePercentage}%`;
            }

            // Skapa radens innehåll.
            row.innerHTML = `
                <span class="csv-site-number">
                    ${icon} ${index + 1}
                </span>

                <span class="csv-site-url">
                    ${websiteUrl}
                </span>

                <span class="csv-site-status">
                    ${statusText}
                </span>
            `;

            progressList.appendChild(
                row
            );
        }
    );

    // Lägg listan längst upp.
    resultsElement.prepend(
        progressList
    );
}


// =========================================================
// STARTA BULK-PROGRESS
// =========================================================

// Startar riktig bulk-progress.
function startCSVProgress(
    urls
) {

    // Spara URL-listan.
    csvWebsites = [
        ...urls
    ];

    // Börja med noll färdiga webbplatser.
    csvCompletedCount = 0;

    // Sätt alla webbplatser till 0%.
    csvSitePercentages =
        urls.map(
            () => 0
        );

    // Börja från 0%.
    currentProgress = 0;

    // Visa progressområdet.
    progressContainer.hidden =
        false;

    // Dölj PDF-sektionen.
    pdfSection.hidden =
        true;

    // Dölj PDF-knapparna.
    pdfButton.hidden =
        true;

    downloadPdfButton.hidden =
        true;

    // Rensa gamla resultat.
    resultsElement.innerHTML =
        "";

    // Visa startmeddelande.
    updateProgress(
        0,
        "Startar QA-analys..."
    );

    // Visa alla webbplatser.
    renderCSVSiteProgress();
}


// =========================================================
// UPPDATERA BULK-PROGRESS
// =========================================================

// Uppdaterar progress från backend.
function updateCSVProgress(
    data
) {

    // Kontrollera grundläggande data.
    if (
        typeof data.completed !==
            "number" ||
        typeof data.total !==
            "number"
    ) {
        return;
    }

    // Spara antal färdiga webbplatser.
    csvCompletedCount =
        data.completed;

    // Individuell progress.
    const sitePercentage =
        typeof data.sitePercentage ===
            "number"
            ? Math.max(
                0,
                Math.min(
                    100,
                    Math.round(
                        data.sitePercentage
                    )
                )
            )
            : 0;

    // Aktuell webbplats.
    const currentIndex =
        data.completed;

    // Spara progress.
    if (
        currentIndex >= 0 &&
        currentIndex <
            csvSitePercentages.length
    ) {

        csvSitePercentages[
            currentIndex
        ] =
            Math.max(
                csvSitePercentages[
                    currentIndex
                ],
                sitePercentage
            );
    }

    // Total progress.
    const overallPercentage =
        typeof data.percentage ===
            "number"
            ? data.percentage
            : currentProgress;

    // Meddelande.
    const message =
        data.message ||
        (
            data.completed <
            data.total
                ? `Analyserar webbplats ${data.completed + 1} av ${data.total}`
                : "Alla webbplatser analyserade."
        );

    // Uppdatera stora progressbaren.
    updateProgress(
        overallPercentage,
        message
    );

    // Markera aktuell webbplats som 100%.
    if (
        sitePercentage >= 100 &&
        currentIndex >= 0 &&
        currentIndex <
            csvSitePercentages.length
    ) {

        csvSitePercentages[
            currentIndex
        ] = 100;
    }

    // Uppdatera webbplatslistan.
    renderCSVSiteProgress();
}


// =========================================================
// PDF-URL
// =========================================================

// Gör PDF-URL absolut.
function createAbsolutePdfUrl(
    pdfUrl
) {

    // Ingen PDF.
    if (!pdfUrl) {
        return null;
    }

    try {

        // Gör URL absolut.
        return new URL(
            pdfUrl,
            API_BASE_URL
        ).href;

    } catch (error) {

        console.error(
            "Kunde inte skapa PDF-URL:",
            error
        );

        return null;
    }
}


// =========================================================
// VISA PDF-KNAPPAR
// =========================================================

// Visar PDF-sektionen.
function showPdfButtons(
    pdfUrl
) {

    // Skapa absolut URL.
    const absolutePdfUrl =
        createAbsolutePdfUrl(
            pdfUrl
        );

    // Avsluta om URL saknas.
    if (!absolutePdfUrl) {
        return;
    }

    // Spara URL.
    latestPdfUrl =
        absolutePdfUrl;

    // Visa PDF-sektionen.
    pdfSection.hidden =
        false;

    // Visa öppna-knappen.
    pdfButton.hidden =
        false;

    // Visa download-knappen.
    downloadPdfButton.hidden =
        false;
}


// =========================================================
// VISA VANLIGA RESULTAT
// =========================================================

// Visar resultat från vanlig QA-skanning.
function displayResults(
    data
) {

    // Rensa gamla resultat.
    resultsElement.innerHTML =
        "";

    // Visa övergripande status.
    if (data.overallStatus) {

        const overall =
            document.createElement(
                "div"
            );

        overall.className =
            "result-summary";

        overall.innerHTML = `
            <strong>Övergripande status:</strong>
            ${data.overallStatus}
        `;

        resultsElement.appendChild(
            overall
        );
    }

    // Kontrollera att resultat finns.
    if (
        data.results &&
        Array.isArray(
            data.results
        )
    ) {

        // Räkna PASS.
        const passCount =
            data.results.filter(
                result =>
                    result.status ===
                    "PASS"
            ).length;

        // Räkna WARNING.
        const warningCount =
            data.results.filter(
                result =>
                    result.status ===
                    "WARNING"
            ).length;

        // Räkna FAIL.
        const failCount =
            data.results.filter(
                result =>
                    result.status ===
                    "FAIL"
            ).length;

        // Skapa sammanfattning.
        const summary =
            document.createElement(
                "div"
            );

        summary.className =
            "result-summary";

        summary.innerHTML = `
            <strong>QA-resultat</strong><br>
            PASS: ${passCount}<br>
            WARNING: ${warningCount}<br>
            FAIL: ${failCount}
        `;

        resultsElement.appendChild(
            summary
        );
    }

    // Visa PDF om backend skickade PDF.
    if (data.pdfUrl) {

        showPdfButtons(
            data.pdfUrl
        );
    }
}


// =========================================================
// VISA BULK-RESULTAT
// =========================================================

// Visar slutresultatet från bulk-skanningen.
function displayCSVResults(
    data
) {

    // Rensa gamla resultat.
    resultsElement.innerHTML =
        "";

    // Skapa sammanfattning.
    const title =
        document.createElement(
            "div"
        );

    title.className =
        "csv-result";

    title.innerHTML = `
        <strong>Bulk-resultat</strong><br>
        Totalt: ${data.total}<br>
        Klara: ${data.completed}<br>
        Misslyckade: ${data.failed}
    `;

    resultsElement.appendChild(
        title
    );

    // Visa varje webbplats.
    if (
        data.results &&
        Array.isArray(
            data.results
        )
    ) {

        data.results.forEach(
            (site) => {

                const siteResult =
                    document.createElement(
                        "div"
                    );

                siteResult.className =
                    "csv-result";

                // Om webbplatsen lyckades.
                if (site.success) {

                    siteResult.innerHTML = `
                        <strong>
                            ${site.websiteUrl}
                        </strong><br>
                        Status: QA klar
                    `;

                // Om webbplatsen misslyckades.
                } else {

                    siteResult.innerHTML = `
                        <strong>
                            ${site.websiteUrl}
                        </strong><br>
                        FEL:
                        ${site.error || "Okänt fel"}
                    `;
                }

                resultsElement.appendChild(
                    siteResult
                );
            }
        );
    }

    // Visa PDF om backend skapade en.
    if (data.pdfUrl) {

        const pdfContainer =
            document.createElement(
                "div"
            );

        pdfContainer.className =
            "csv-pdf-link";

        pdfContainer.innerHTML = `
            <strong>
                Samlad PDF-rapport
            </strong><br>
            PDF-rapporten är klar.
        `;

        resultsElement.appendChild(
            pdfContainer
        );

        // Visa PDF-sektionen.
        showPdfButtons(
            data.pdfUrl
        );
    }
}


// =========================================================
// VANLIG QA-SKANNING
// =========================================================

startButton.addEventListener(
    "click",
    async () => {

        // Hämtar och normaliserar URL.
        const url =
            normalizeWebsiteUrl(
                urlInput.value
            );

        // Kontrollera URL.
        if (!url) {

            setStatus(
                "Ange en webbplats."
            );

            return;
        }

        // Kontrollera att minst ett test är valt.
        if (!hasValidTestSelection()) {

            setStatus(
                "Välj minst ett test."
            );

            return;
        }

        // Rensa gamla resultat.
        resultsElement.innerHTML =
            "";

        // Nollställ PDF.
        latestPdfUrl =
            null;

        // Dölj PDF.
        pdfSection.hidden =
            true;

        pdfButton.hidden =
            true;

        downloadPdfButton.hidden =
            true;

        // Starta progress.
        startProgress();

        // Inaktivera knappen.
        startButton.disabled =
            true;

        try {

            // Skicka URL till backend.
            const response =
                await fetch(
                    SCAN_PROGRESS_API_URL,
                    {
                        method: "POST",

                        headers: {
                            "Content-Type":
                                "application/json"
                        },

                        body: JSON.stringify({
                            url: url,
                            tests: getSelectedTests()
                        })
                    }
                );

            // Kontrollera HTTP-status.
            if (!response.ok) {

                let errorMessage =
                    `QA-skanningen misslyckades (${response.status}).`;

                try {

                    const errorData =
                        await response.json();

                    errorMessage =
                        errorData.error ||
                        errorMessage;

                } catch (error) {
                    // Standardmeddelandet används.
                }

                throw new Error(
                    errorMessage
                );
            }

            // Kontrollera stream.
            if (!response.body) {

                throw new Error(
                    "Backend skickade ingen progress-stream."
                );
            }

            // Hämta stream-läsare.
            const reader =
                response.body.getReader();

            // Omvandla bytes till text.
            const decoder =
                new TextDecoder();

            // Buffer för SSE-data.
            let buffer = "";

            // Läs SSE-streamen.
            while (true) {

                const {
                    value,
                    done
                } = await reader.read();

                if (done) {
                    break;
                }

                // Lägg till ny data.
                buffer +=
                    decoder.decode(
                        value,
                        {
                            stream: true
                        }
                    );

                // Dela upp SSE-events.
                const events =
                    buffer.split(
                        /\r?\n\r?\n/
                    );

                // Spara ofullständigt event.
                buffer =
                    events.pop() || "";

                // Hantera kompletta events.
                for (
                    const eventText of events
                ) {

                    const eventLines =
                        eventText.split(
                            /\r?\n/
                        );

                    let eventType = "";
                    let eventData = "";

                    // Läs eventets rader.
                    eventLines.forEach(
                        (line) => {

                            if (
                                line.startsWith(
                                    "event:"
                                )
                            ) {

                                eventType =
                                    line
                                        .replace(
                                            "event:",
                                            ""
                                        )
                                        .trim();
                            }

                            if (
                                line.startsWith(
                                    "data:"
                                )
                            ) {

                                eventData +=
                                    line
                                        .replace(
                                            "data:",
                                            ""
                                        )
                                        .trim();
                            }
                        }
                    );

                    // Hoppa över tomma events.
                    if (
                        !eventType ||
                        !eventData
                    ) {
                        continue;
                    }

                    // Läs JSON.
                    let data;

                    try {

                        data =
                            JSON.parse(
                                eventData
                            );

                    } catch (error) {

                        console.error(
                            "Kunde inte läsa SSE-data:",
                            eventData
                        );

                        continue;
                    }

                    // START.
                    if (
                        eventType ===
                        "started"
                    ) {

                        updateProgress(
                            data.percentage ??
                                0,
                            data.message ||
                                "Startar QA-skanning..."
                        );
                    }

                    // PROGRESS.
                    else if (
                        eventType ===
                        "progress"
                    ) {

                        updateProgress(
                            data.percentage,
                            data.message
                        );
                    }

                    // KLAR.
                    else if (
                        eventType ===
                        "complete"
                    ) {

                        updateProgress(
                            data.percentage ??
                                100,
                            data.message ||
                                "QA-skanning och PDF-rapport är klara."
                        );

                        // Visa resultat.
                        displayResults(
                            data
                        );

                        // Visa status.
                        setStatus(
                            "QA-skanning klar."
                        );
                    }

                    // FEL.
                    else if (
                        eventType ===
                        "error"
                    ) {

                        throw new Error(
                            data.error ||
                                "QA-skanningen misslyckades."
                        );
                    }
                }
            }

        } catch (error) {

            // Visa fel.
            setStatus(
                `FEL: ${error.message}`
            );

            resultsElement.innerHTML = `
                <div class="csv-result">
                    <strong>
                        Skanningen misslyckades.
                    </strong><br>
                    ${error.message}
                </div>
            `;

        } finally {

            // Aktivera knappen igen.
            startButton.disabled =
                false;
        }
    }
);


// =========================================================
// BULK QA-SKANNING
// =========================================================

csvScanButton.addEventListener(
    "click",
    async () => {

        // Kontrollera att en fil finns.
        if (
            !csvFileInput.files ||
            csvFileInput.files.length === 0
        ) {

            setStatus(
                "Välj en CSV-, XLSX- eller XLS-fil först."
            );

            return;
        }

        // Kontrollera att minst ett test är valt.
        if (!hasValidTestSelection()) {

            setStatus(
                "Välj minst ett test."
            );

            return;
        }

        // Hämta filen.
        const file =
            csvFileInput.files[0];

        // Kontrollera filtypen.
        if (!isSupportedFile(file)) {

            setStatus(
                "Välj en CSV-, XLSX- eller XLS-fil."
            );

            return;
        }

        try {

            // =================================================
            // LÄS FIL
            // =================================================

            setStatus(
                `Läser ${file.name}...`
            );

            // Läser filen och hittar URL:er.
            const urls =
                await extractWebsitesFromFile(
                    file
                );

            // Loggar hittade URL:er för felsökning.
            console.log(
                "Webbplatser hittade i filen:",
                urls
            );

            // Kontrollera att URL:er hittades.
            if (
                urls.length === 0
            ) {

                setStatus(
                    "Inga giltiga webbplatser hittades i filen."
                );

                return;
            }

            // Visa antal hittade webbplatser.
            setStatus(
                `${urls.length} webbplatser hittades. Startar QA...`
            );

            // Rensa gamla resultat.
            resultsElement.innerHTML =
                "";

            // Nollställ PDF.
            latestPdfUrl =
                null;

            // Dölj PDF.
            pdfSection.hidden =
                true;

            pdfButton.hidden =
                true;

            downloadPdfButton.hidden =
                true;

            // Inaktivera knappen.
            csvScanButton.disabled =
                true;

            // Starta bulk-progress.
            startCSVProgress(
                urls
            );

            try {

                // =================================================
                // STARTA BULK-PROGRESS STREAM
                // =================================================

                // Skicka URL-listan till backend.
                const response =
                    await fetch(
                        CSV_PROGRESS_API_URL,
                        {
                            method: "POST",

                            headers: {
                                "Content-Type":
                                    "application/json"
                            },

                            body: JSON.stringify({
                                urls: urls,
                                tests: getSelectedTests()
                            })
                        }
                    );

                // Kontrollera HTTP-status.
                if (!response.ok) {

                    let errorMessage =
                        `Bulk-skanningen misslyckades (${response.status}).`;

                    try {

                        const errorData =
                            await response.json();

                        errorMessage =
                            errorData.error ||
                            errorMessage;

                    } catch (error) {
                        // Standardfelet används.
                    }

                    throw new Error(
                        errorMessage
                    );
                }

                // Kontrollera streaming.
                if (!response.body) {

                    throw new Error(
                        "Backend skickade ingen progress-stream."
                    );
                }

                // Hämta stream-läsare.
                const reader =
                    response.body.getReader();

                // Omvandla bytes till text.
                const decoder =
                    new TextDecoder();

                // Buffer för SSE-data.
                let buffer = "";

                // Läs SSE-streamen.
                while (true) {

                    const {
                        value,
                        done
                    } = await reader.read();

                    if (done) {
                        break;
                    }

                    // Lägg till data.
                    buffer +=
                        decoder.decode(
                            value,
                            {
                                stream: true
                            }
                        );

                    // Dela upp events.
                    const events =
                        buffer.split(
                            /\r?\n\r?\n/
                        );

                    // Spara ofullständigt event.
                    buffer =
                        events.pop() || "";

                    // Hantera events.
                    for (
                        const eventText of events
                    ) {

                        const eventLines =
                            eventText.split(
                                /\r?\n/
                            );

                        let eventType = "";
                        let eventData = "";

                        // Läs eventet.
                        eventLines.forEach(
                            (line) => {

                                if (
                                    line.startsWith(
                                        "event:"
                                    )
                                ) {

                                    eventType =
                                        line
                                            .replace(
                                                "event:",
                                                ""
                                            )
                                            .trim();
                                }

                                if (
                                    line.startsWith(
                                        "data:"
                                    )
                                ) {

                                    eventData +=
                                        line
                                            .replace(
                                                "data:",
                                                ""
                                            )
                                            .trim();
                                }
                            }
                        );

                        // Hoppa över tomma events.
                        if (
                            !eventType ||
                            !eventData
                        ) {
                            continue;
                        }

                        // Läs JSON.
                        let data;

                        try {

                            data =
                                JSON.parse(
                                    eventData
                                );

                        } catch (error) {

                            console.error(
                                "Kunde inte läsa SSE-data:",
                                eventData
                            );

                            continue;
                        }

                        // -----------------------------------------
                        // START
                        // -----------------------------------------

                        if (
                            eventType ===
                            "started"
                        ) {

                            updateProgress(
                                data.percentage ??
                                    0,
                                data.message ||
                                    "Startar QA-analys..."
                            );

                            renderCSVSiteProgress();
                        }

                        // -----------------------------------------
                        // WEBBPLATS STARTAR
                        // -----------------------------------------

                        else if (
                            eventType ===
                            "website-start"
                        ) {

                            const websiteNumber =
                                data.completed + 1;

                            updateProgress(
                                data.percentage ??
                                    currentProgress,
                                data.message ||
                                    `Analyserar webbplats ${websiteNumber} av ${data.total}`
                            );

                            // Nollställ individuell progress
                            // för den nya webbplatsen.
                            if (
                                data.completed >= 0 &&
                                data.completed <
                                    csvSitePercentages.length
                            ) {

                                csvSitePercentages[
                                    data.completed
                                ] = 0;
                            }

                            renderCSVSiteProgress();
                        }

                        // -----------------------------------------
                        // PROGRESS
                        // -----------------------------------------

                        else if (
                            eventType ===
                            "progress"
                        ) {

                            updateCSVProgress(
                                data
                            );
                        }

                        // -----------------------------------------
                        // PDF
                        // -----------------------------------------

                        else if (
                            eventType ===
                            "pdf"
                        ) {

                            updateProgress(
                                data.percentage,
                                data.message ||
                                    "PDF-rapporten är klar."
                            );
                        }

                        // -----------------------------------------
                        // KLAR
                        // -----------------------------------------

                        else if (
                            eventType ===
                            "complete"
                        ) {

                            updateProgress(
                                data.percentage ??
                                    100,
                                data.message ||
                                    "Bulk QA-analys och PDF-rapport är klara."
                            );

                            // Markera alla webbplatser som klara.
                            csvCompletedCount =
                                data.completed ??
                                csvWebsites.length;

                            // Sätt alla till 100%.
                            csvSitePercentages =
                                csvWebsites.map(
                                    () => 100
                                );

                            // Uppdatera listan.
                            renderCSVSiteProgress();

                            // Visa resultat.
                            displayCSVResults(
                                data
                            );

                            // Visa slutstatus.
                            setStatus(
                                "Bulk QA-skanning klar."
                            );
                        }

                        // -----------------------------------------
                        // FEL
                        // -----------------------------------------

                        else if (
                            eventType ===
                            "error"
                        ) {

                            throw new Error(
                                data.error ||
                                    "Bulk-skanningen misslyckades."
                            );
                        }
                    }
                }

            } catch (error) {

                // Visa fel.
                setStatus(
                    `FEL: ${error.message}`
                );

                resultsElement.innerHTML = `
                    <div class="csv-result">
                        <strong>
                            Bulk-skanningen misslyckades.
                        </strong><br>
                        ${error.message}
                    </div>
                `;

            } finally {

                // Aktivera knappen igen.
                csvScanButton.disabled =
                    false;
            }

        } catch (error) {

            // Hanterar fel vid filinläsning.
            console.error(
                "Filfel:",
                error
            );

            setStatus(
                `FEL: Kunde inte läsa filen. ${error.message}`
            );
        }
    }
);


// =========================================================
// ÖPPNA PDF
// =========================================================

pdfButton.addEventListener(
    "click",
    () => {

        // Kontrollera att PDF finns.
        if (!latestPdfUrl) {

            setStatus(
                "Ingen PDF-rapport finns ännu."
            );

            return;
        }

        // Öppna PDF i ny flik.
        window.open(
            latestPdfUrl,
            "_blank"
        );
    }
);


// =========================================================
// LADDA NER PDF
// =========================================================

downloadPdfButton.addEventListener(
    "click",
    async () => {

        // Kontrollera att PDF finns.
        if (!latestPdfUrl) {

            setStatus(
                "Ingen PDF-rapport finns ännu."
            );

            return;
        }

        try {

            // Visa status.
            setStatus(
                "Laddar ner PDF..."
            );

            // Hämta PDF.
            const response =
                await fetch(
                    latestPdfUrl
                );

            // Kontrollera svar.
            if (!response.ok) {

                throw new Error(
                    "PDF-filen kunde inte hämtas."
                );
            }

            // Läs PDF som Blob.
            const blob =
                await response.blob();

            // Skapa temporär URL.
            const blobUrl =
                URL.createObjectURL(
                    blob
                );

            // Skapa temporär länk.
            const link =
                document.createElement(
                    "a"
                );

            // Sätt Blob-URL.
            link.href =
                blobUrl;

            // Ange filnamn.
            link.download =
                "Website-QA-Report.pdf";

            // Lägg till länken.
            document.body.appendChild(
                link
            );

            // Starta nedladdningen.
            link.click();

            // Ta bort länken.
            link.remove();

            // Frigör Blob-URL.
            URL.revokeObjectURL(
                blobUrl
            );

            // Visa status.
            setStatus(
                "PDF-nedladdning startad."
            );

        } catch (error) {

            // Visa fel.
            setStatus(
                `FEL vid PDF-nedladdning: ${error.message}`
            );
        }
    }
);
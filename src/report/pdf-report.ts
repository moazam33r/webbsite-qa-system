// ============================================================
// WEBSITE QA SYSTEM
// PDF-RAPPORT
// ============================================================
//
// Funktioner:
// - Sammanfattning av QA-resultat.
// - Fynd grupperade efter problem.
// - Prioritering: Kritisk, Viktig och Liten.
// - Förklaring och rekommenderad åtgärd.
// - Textfel med ord, förslag, sida och sammanhang.
// - Prestanda med staplar och målvärde 90.
// - Det som fungerar.
// - AI-analys utan duplicerade avsnitt.
// - Teknisk bilaga med originalresultat.
// - CSV-rapport för flera webbplatser.
//
// PDFKit används utan:
// - bufferPages
// - switchToPage
// - bufferedPageRange
// - pageAdded
//
// ============================================================

import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import os from "os";

import { QACheckResult } from "./qa-report";

// ============================================================
// INSTÄLLNINGAR
// ============================================================

const HIDE_DUPLICATE_AI_SECTIONS = true;
const INCLUDE_TECHNICAL_APPENDIX = true;
const PERFORMANCE_TARGET = 90;

// ============================================================
// DATASTRUKTURER
// ============================================================

export interface PDFReportData {
    websiteUrl: string;
    results: QACheckResult[];
    aiAnalysis?: string;
}

export interface CSVPDFReportItem {
    success: boolean;
    websiteUrl: string;
    results: QACheckResult[];
    error?: string;
    aiAnalysis?: string;
}

type Priority = "Kritisk" | "Viktig" | "Liten";

interface Finding {
    priority: Priority;
    category: string;
    title: string;
    description?: string;
    pages: string[];
    scope?: string;
    action?: string;
    matchedText?: string;
    suggestions?: string;
    context?: string;
}

// ============================================================
// FÄRGER
// ============================================================

const COLORS = {
    dark: "#0f2a26",
    text: "#0f2a26",
    secondaryText: "#3f5651",
    muted: "#3f5651",
    border: "#c5d3cf",
    light: "#eaf0ee",
    white: "#ffffff",

    pass: "#0e7490",
    passBackground: "#ddf0f5",

    warning: "#8a5a00",
    warningBackground: "#fdf1c7",

    fail: "#9d174d",
    failBackground: "#fce7f0",

    low: "#213b36",
    lowBackground: "#d9e4e1",
};

// ============================================================
// SIDLAYOUT
// ============================================================

const PAGE = {
    margin: 50,
    contentWidth: 495,
    bottom: 782,
};

// ============================================================
// ALLMÄNNA HJÄLPFUNKTIONER
// ============================================================

function getResultCounts(results: QACheckResult[]) {
    return {
        pass: results.filter((r) => r.status === "PASS").length,
        warning: results.filter((r) => r.status === "WARNING").length,
        fail: results.filter((r) => r.status === "FAIL").length,
    };
}

function getOverallStatus(
    results: QACheckResult[]
): "PASS" | "WARNING" | "FAIL" {
    const counts = getResultCounts(results);

    if (counts.fail > 0) return "FAIL";
    if (counts.warning > 0) return "WARNING";

    return "PASS";
}

function getStatusColor(status: string): string {
    if (status === "PASS") return COLORS.pass;
    if (status === "WARNING") return COLORS.warning;

    return COLORS.fail;
}

function getStatusBackground(status: string): string {
    if (status === "PASS") return COLORS.passBackground;
    if (status === "WARNING") return COLORS.warningBackground;

    return COLORS.failBackground;
}

function getOverallHeadline(
    status: "PASS" | "WARNING" | "FAIL"
): string {
    if (status === "FAIL") return "Behöver åtgärdas";
    if (status === "WARNING") return "Kan förbättras";

    return "Inga problem";
}

function getReportDate(): string {
    return new Date().toLocaleString("sv-SE");
}

function cleanMessage(message: string): string {
    if (!message) return "";

    return message
        .replace(
            /Initial server response time was short \*\*Root document took 0 ms\*\*/gi,
            ""
        )
        .replace(/Root document took 0 ms/gi, "")
        .replace(/\s+/g, " ")
        .trim();
}

function shortenText(text: string, maxLength: number): string {
    const cleaned = cleanMessage(text);

    if (cleaned.length <= maxLength) {
        return cleaned;
    }

    return cleaned.substring(0, maxLength - 3) + "...";
}

function toPath(url: string): string {
    try {
        const parsed = new URL(url);
        return parsed.pathname || "/";
    } catch {
        return url;
    }
}

function measure(
    document: PDFKit.PDFDocument,
    text: string,
    width: number,
    font = "Helvetica",
    size = 9
): number {
    document.font(font).fontSize(size);

    return document.heightOfString(text || " ", {
        width,
        lineGap: 2,
    });
}

function uniqueUrls(urls: string[]): string[] {
    return [...new Set(urls.filter(Boolean))];
}

function extractUrls(text: string): string[] {
    const matches = text.match(/https?:\/\/[^\s"'<>]+/gi) ?? [];

    return uniqueUrls(
        matches.map((url) => url.replace(/[),.;]+$/, ""))
    );
}

// ============================================================
// ANTAL TESTADE SIDOR
// ============================================================

function getTotalPages(results: QACheckResult[]): number {
    const pageResult = results.find(
        (r) => /^sidor$/i.test(r.name.trim())
    );

    const match = pageResult?.message?.match(/(\d+)\s*\/\s*(\d+)/);

    return match ? Number(match[2]) : 0;
}

// ============================================================
// ÅTGÄRDSREGLER
// ============================================================

const ACTION_RULES: {
    test: RegExp;
    action: string;
}[] = [
    {
        test: /platshållar/i,
        action:
            "Ersätt platshållaren med företagets riktiga uppgifter. Kontrollera sidfot, kontaktuppgifter och återanvända mallar.",
    },
    {
        test: /ogiltigt telefonnummer/i,
        action:
            "Kontrollera telefonnumret och använd en validering som accepterar giltiga svenska nummerformat.",
    },
    {
        test: /cookie|integritet|gdpr/i,
        action:
            "Kontrollera integritetspolicyn, informationen om cookies och att relevant information finns tillgänglig vid formulär.",
    },
    {
        test: /prestanda|performance|mobilprestanda/i,
        action:
            "Undersök LCP, CLS och TBT samt bilder, JavaScript och andra resurser som påverkar laddningstiden.",
    },
    {
        test: /meta description/i,
        action:
            "Lägg till en unik och relevant metabeskrivning för sidan.",
    },
    {
        test: /h1/i,
        action:
            "Kontrollera sidans rubrikhierarki. Använd en tydlig huvudrubrik och ordna underrubriker logiskt.",
    },
    {
        test: /validering|telefonfält/i,
        action:
            "Lägg till lämplig fältvalidering och tydliga felmeddelanden. Kontrollera både ogiltiga och giltiga indata.",
    },
    {
        test: /stavning|textfel|textkontroll/i,
        action:
            "Kontrollera det markerade ordet i sitt sammanhang och rätta det om förslaget är korrekt.",
    },
    {
        test: /google business/i,
        action:
            "Kontrollera att företagets kontaktuppgifter och eventuella Google-företagsprofil är korrekta och överensstämmer.",
    },
    {
        test: /länk/i,
        action:
            "Kontrollera att länken fungerar och leder till innehåll som motsvarar länkens syfte.",
    },
    {
        test: /bild|image/i,
        action:
            "Kontrollera bildens laddning, filadress och alternativa text där det behövs.",
    },
    {
        test: /seo/i,
        action:
            "Granska sidans metadata, rubriker och övriga SEO-resultat i den tekniska bilagan.",
    },
];

function getAction(
    category: string,
    title: string,
    description?: string
): string {
    const combined = `${category} ${title} ${description ?? ""}`;

    const rule = ACTION_RULES.find((item) =>
        item.test.test(combined)
    );

    return (
        rule?.action ??
        "Granska resultatet i den tekniska bilagan och åtgärda det identifierade problemet."
    );
}

// ============================================================
// SEO-FYND
// ============================================================

function describeSeoIssue(issue: string): {
    title: string;
    description?: string;
    priority: Priority;
} {
    if (/meta description/i.test(issue)) {
        return {
            title: "Meta description saknas",
            description:
                "Sökmotorer kan då välja en annan text från sidan som beskrivning i sökresultatet.",
            priority: "Viktig",
        };
    }

    if (/multiple h1/i.test(issue)) {
        const count = issue.match(/\((\d+)\)/)?.[1];

        return {
            title: count
                ? `Flera H1-rubriker (${count})`
                : "Flera H1-rubriker",
            description:
                "Kontrollera rubrikhierarkin så att sidans huvudrubrik och underrubriker har en tydlig struktur.",
            priority: "Liten",
        };
    }

    if (/(missing|no).*h1|h1.*missing/i.test(issue)) {
        return {
            title: "H1-rubrik saknas",
            description:
                "En tydlig huvudrubrik hjälper besökare och sökmotorer att förstå sidans innehåll.",
            priority: "Viktig",
        };
    }

    if (/title.*missing|missing.*title/i.test(issue)) {
        return {
            title: "Sidtitel saknas",
            description:
                "En relevant sidtitel hjälper användare och sökmotorer att förstå sidans innehåll.",
            priority: "Viktig",
        };
    }

    return {
        title: issue,
        priority: "Viktig",
    };
}

function parseSeoFindings(result: QACheckResult): Finding[] {
    const message = cleanMessage(result.message);
    const findings: Finding[] = [];

    // Förväntat format:
    // URL - problem - URL - problem
    const parts = message.split(/\s+-\s+/);

    const groups = new Map<string, string[]>();

    for (let i = 0; i < parts.length - 1; i++) {
        const current = parts[i].trim();

        if (!/^https?:\/\//i.test(current)) {
            continue;
        }

        const next = parts[i + 1]?.trim();

        if (!next || /^https?:\/\//i.test(next)) {
            continue;
        }

        const pages = groups.get(next) ?? [];
        pages.push(current);

        groups.set(next, pages);
        i++;
    }

    for (const [issue, pages] of groups) {
        const described = describeSeoIssue(issue);

        findings.push({
            priority: described.priority,
            category: result.name,
            title: described.title,
            description: described.description,
            pages: uniqueUrls(pages),
        });
    }

    return findings;
}

// ============================================================
// TELEFON- OCH LÄNKFYND
// ============================================================

function parseLinkFindings(result: QACheckResult): Finding[] {
    const message = cleanMessage(result.message);

    if (!/Ogiltiga telefonnummer/i.test(message)) {
        return [];
    }

    const segments = message
        .slice(message.search(/Ogiltiga telefonnummer/i))
        .split(/Telefonnummer:/i)
        .slice(1);

    const findings: Finding[] = [];

    for (const segment of segments) {
        const number = segment
            .match(/^\s*([+\d][\d\s()+-]*?)\s+Fel:/)?.[1]
            ?.trim();

        if (!number) continue;

        const error = segment
            .match(/Fel:\s*(.+?)\s+Förekommer/i)?.[1]
            ?.trim();

        const pages = extractUrls(segment);
        const isPlaceholder = /0{6,}/.test(number);

        findings.push({
            priority: isPlaceholder ? "Kritisk" : "Viktig",
            category: result.name,
            title: isPlaceholder
                ? `Platshållarnummer ${number}`
                : `Ogiltigt telefonnummer ${number}`,
            description:
                error ?? "Telefonnumret behöver kontrolleras.",
            pages,
        });
    }

    return findings;
}

// ============================================================
// TEXTFYND
// ============================================================

function extractField(
    text: string,
    labels: string[]
): string | undefined {
    for (const label of labels) {
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

        const expression = new RegExp(
            `(?:^|\\s)(?:${escaped})\\s*:\\s*([\\s\\S]*?)(?=\\s+(?:${labels
                .filter((item) => item !== label)
                .map((item) =>
                    item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
                )
                .join("|")})\\s*:|$)`,
            "i"
        );

        const match = text.match(expression);

        if (match?.[1]?.trim()) {
            return match[1].trim();
        }
    }

    return undefined;
}

function parseTextFindings(result: QACheckResult): Finding[] {
    const message = cleanMessage(result.message);
    if (!message) return [];

    const findings: Finding[] = [];

    const labels = [
        "Klassificering",
        "Markerad text",
        "Felaktig text",
        "Förslag",
        "Sida",
        "Sammanhang",
        "Förklaring från LanguageTool",
        "Förklaring",
        "AI-bedömning",
        "LanguageTool-regel",
        "Typ",
    ];

    // Dela upp resultatet i separata textfynd.
    const sections = message
        .split(
            /\s+-\s+(?=(?:Klassificering|Markerad text|Felaktig text)\s*:)/i
        )
        .filter((section) =>
            /(?:Klassificering|Markerad text|Felaktig text)\s*:/i.test(
                section
            )
        );

    let parsedSections = 0;

    for (const section of sections) {
        // Hämta själva ordet, inte klassificeringen.
        const rawMatchedText = extractField(section, [
            "Markerad text",
            "Felaktig text",
        ]);

        if (!rawMatchedText) continue;

        parsedSections++;

        const matchedText = rawMatchedText
            .replace(/^[“"']|[”"']$/g, "")
            .trim();

        if (!matchedText) continue;

        const classification =
            extractField(section, ["Klassificering"]) ?? "";

        const aiExplanation =
            extractField(section, [
                "AI-bedömning",
                "LanguageTool-regel",
                "Typ",
            ]) ?? "";

        const classificationText = classification.toLowerCase();
        const aiText = aiExplanation.toLowerCase();

        // AI:ns slutliga klassificering ska styra.
        // Korrekta ord ska inte bli prioriterade PDF-fynd.
        const explicitlyLikelyCorrect =
            /likely_correct|troligen korrekt|sannolikt korrekt/i.test(
                classificationText
            );

        const explicitlySpellingError =
            /likely_spelling_error|sannolikt stavfel|troligt stavfel|needs_review|manuell granskning/i.test(
                classificationText
            );

        const aiSaysCorrect =
            /är korrekt i sammanhanget|ordet .{0,100} är korrekt|korrekt i sammanhanget/i.test(
                aiText
            );

        if (
            explicitlyLikelyCorrect ||
            (!explicitlySpellingError && aiSaysCorrect)
        ) {
            continue;
        }

        const suggestions =
            extractField(section, [
                "Förslag",
                "Sida",
                "Sammanhang",
                "Förklaring från LanguageTool",
                "Förklaring",
                "AI-bedömning",
                "LanguageTool-regel",
                "Typ",
            ]) ?? "";

        const pageField = extractField(section, [
            "Sida",
            "Sammanhang",
            "Förklaring från LanguageTool",
            "Förklaring",
            "AI-bedömning",
            "LanguageTool-regel",
            "Typ",
        ]);

        const pageUrl =
            pageField?.match(/https?:\/\/[^\s]+/i)?.[0] ?? "";

        const context =
            extractField(section, [
                "Sammanhang",
                "Förklaring från LanguageTool",
                "Förklaring",
                "AI-bedömning",
                "LanguageTool-regel",
                "Typ",
            ]) ?? "";

        const languageToolExplanation =
            extractField(section, [
                "Förklaring från LanguageTool",
                "Förklaring",
                "AI-bedömning",
                "LanguageTool-regel",
                "Typ",
            ]) ?? "";

        const descriptionParts: string[] = [];

        if (suggestions) {
            descriptionParts.push(`Föreslagna rättningar: ${suggestions}`);
        }

        if (languageToolExplanation) {
            descriptionParts.push(
                `LanguageTool: ${languageToolExplanation}`
            );
        }

        if (aiExplanation) {
            descriptionParts.push(`AI-bedömning: ${aiExplanation}`);
        }

        const description =
            descriptionParts.join("\n") ||
            "Textträffen behöver granskas manuellt.";

        // Undvik identiska fynd på samma sida och i samma sammanhang.
        const isDuplicate = findings.some(
            (finding) =>
                finding.matchedText === matchedText &&
                finding.pages.includes(pageUrl) &&
                finding.context === context.trim()
        );

        if (isDuplicate) continue;

        findings.push({
            priority: explicitlySpellingError ? "Viktig" : "Liten",
            category: result.name,
            title: explicitlySpellingError
                ? `Möjligt stavfel: "${matchedText}"`
                : `Textträff för granskning: "${matchedText}"`,
            description,
            pages: pageUrl ? [pageUrl] : [],
            matchedText,
            suggestions: suggestions || "Inget förslag",
            context: context.trim(),
        });
    }

    // Om vi lyckades läsa textfynden men alla bedömdes korrekta,
    // returnera inga fynd. Skapa inte ett generiskt falsklarm.
    if (parsedSections > 0 && findings.length === 0) {
        return [];
    }

    // Reservhantering om formatet är okänt eller inte kan läsas.
    if (
        parsedSections === 0 &&
        /textfel|stavfel|möjliga textfel|möjligt textfel|markerad text|klassificering/i.test(
            message
        )
    ) {
        findings.push({
            priority: "Liten",
            category: result.name,
            title: "Textresultatet behöver granskas",
            description:
                "Textresultatet kunde inte delas upp i individuella fynd. Se originalresultatet i den tekniska bilagan.",
            pages: extractUrls(message),
        });
    }

    return findings;
}

// ============================================================
// GENERELLA FYND
// ============================================================

function buildGenericFinding(result: QACheckResult): Finding {
    const message = cleanMessage(result.message);

    if (/prestanda|performance/i.test(result.name)) {
        const desktop = message.match(/Desktop:\s*(\d+)/i)?.[1];
        const mobile = message.match(/(?:Mobile|Mobil):\s*(\d+)/i)?.[1];

        if (mobile) {
            return {
                priority:
                    result.status === "FAIL" ? "Kritisk" : "Viktig",
                category: result.name,
                title: `Mobilprestanda ${mobile}/100`,
                description: desktop
                    ? `Desktop har resultatet ${desktop}/100. Kontrollera vilka delar som påverkar mobilprestandan.`
                    : "Kontrollera vilka delar som påverkar mobilprestandan.",
                pages: [],
            };
        }
    }

    let priority: Priority = "Viktig";

    if (
        result.status === "FAIL" ||
        /cookie|gdpr|säkerhet|security/i.test(result.name)
    ) {
        priority = "Kritisk";
    } else if (/google business/i.test(result.name)) {
        priority = "Liten";
    }

    return {
        priority,
        category: result.name,
        title: shortenText(message, 180) || result.name,
        pages: extractUrls(message),
    };
}

// ============================================================
// SKAPA OCH PRIORITERA FYND
// ============================================================

function deriveFindings(results: QACheckResult[]): Finding[] {
    const findings: Finding[] = [];

    for (const result of results) {
        if (result.status === "PASS") continue;

        let derived: Finding[] = [];

        if (/seo/i.test(result.name)) {
            derived = parseSeoFindings(result);
        } else if (/länk/i.test(result.name)) {
            derived = parseLinkFindings(result);
        } else if (/text|stavning/i.test(result.name)) {
            derived = parseTextFindings(result);
        }

        if (derived.length === 0) {
    // Om textfynd har lästs och alla bedömts som korrekta
    // ska vi inte skapa ett generiskt falsklarm.
    if (
        /text|stavning/i.test(result.name) &&
        /(?:Klassificering:\s*(?:AI bedömer texten som\s*)?(?:troligen korrekt|sannolikt korrekt|LIKELY_CORRECT))/i.test(
            cleanMessage(result.message)
        )
    ) {
        continue;
    }

    derived = [buildGenericFinding(result)];
}

        findings.push(...derived);
    }

    for (const finding of findings) {
        finding.action = getAction(
            finding.category,
            finding.title,
            finding.description
        );

        if (
            finding.pages.length === 0 &&
            /cookie|gdpr|google|prestanda|performance/i.test(
                finding.category
            )
        ) {
            finding.scope = "Hela webbplatsen";
        } else if (finding.pages.length === 0) {
            finding.scope = "Se teknisk bilaga";
        }
    }

    const order: Record<Priority, number> = {
        Kritisk: 0,
        Viktig: 1,
        Liten: 2,
    };

    return findings
        .map((finding, index) => ({ finding, index }))
        .sort(
            (a, b) =>
                order[a.finding.priority] -
                    order[b.finding.priority] ||
                a.index - b.index
        )
        .map((entry) => entry.finding);
}

// ============================================================
// BERÖRDA SIDOR
// ============================================================

function formatPages(
    finding: Finding,
    totalPages: number
): string {
    const pages = uniqueUrls(finding.pages);

    if (pages.length === 0) {
        return finding.scope ?? "";
    }

    if (totalPages > 0 && pages.length >= totalPages) {
        return `Alla ${totalPages} sidor`;
    }

    const isTextFinding =
        /text|stavning/i.test(finding.category);

    const shown = pages
        .slice(0, 6)
        .map((page) => (isTextFinding ? page : toPath(page)))
        .join("\n");

    const remaining = pages.length - 6;

    return remaining > 0
        ? `${shown}\n+${remaining} sidor till`
        : shown;
}

// ============================================================
// SIDHUVUD
// ============================================================

function addReportHeader(
    document: PDFKit.PDFDocument,
    websiteUrl: string,
    reportTitle: string
): void {
    document
        .rect(0, 0, document.page.width, 96)
        .fill(COLORS.dark);

    document
        .fillColor(COLORS.white)
        .font("Helvetica-Bold")
        .fontSize(20)
        .text("Website QA System", 50, 25);

    document
        .fillColor("#d9e4e1")
        .font("Helvetica")
        .fontSize(10)
        .text(reportTitle, 50, 53);

    document
        .fillColor("#d9e4e1")
        .fontSize(9)
        .text(websiteUrl, 50, 70, {
            width: document.page.width - 100,
        });

    document.y = 118;
    document.fillColor(COLORS.text).font("Helvetica");
}

function addContinuationHeader(
    document: PDFKit.PDFDocument,
    title: string
): void {
    document
        .fillColor(COLORS.dark)
        .font("Helvetica-Bold")
        .fontSize(12)
        .text(title, PAGE.margin, 42);

    document
        .strokeColor(COLORS.border)
        .lineWidth(0.8)
        .moveTo(PAGE.margin, 62)
        .lineTo(document.page.width - PAGE.margin, 62)
        .stroke();

    document.y = 82;
    document.font("Helvetica");
}

function startNewPage(
    document: PDFKit.PDFDocument,
    title: string
): void {
    document.addPage();
    addContinuationHeader(document, title);
}

function ensureSpace(
    document: PDFKit.PDFDocument,
    height: number,
    title: string
): void {
    if (document.y + height > PAGE.bottom) {
        startNewPage(document, title);
    }
}

// ============================================================
// SEKTIONSTITEL
// ============================================================

function addSectionTitle(
    document: PDFKit.PDFDocument,
    title: string,
    subtitle?: string
): void {
    const startY = document.y;

    document
        .fillColor(COLORS.dark)
        .font("Helvetica-Bold")
        .fontSize(15)
        .text(title, PAGE.margin, startY);

    let y = document.y + 4;

    if (subtitle) {
        document
            .fillColor(COLORS.secondaryText)
            .font("Helvetica")
            .fontSize(8.5)
            .text(subtitle, PAGE.margin, y, {
                width: PAGE.contentWidth,
            });

        y = document.y + 5;
    }

    document
        .strokeColor(COLORS.border)
        .lineWidth(0.8)
        .moveTo(PAGE.margin, y)
        .lineTo(document.page.width - PAGE.margin, y)
        .stroke();

    document.y = y + 13;
    document.font("Helvetica");
}

// ============================================================
// WEBBPLATSINFORMATION
// ============================================================

function addWebsiteInformation(
    document: PDFKit.PDFDocument,
    websiteUrl: string,
    totalPages: number,
    checkCount: number
): void {
    const startY = document.y;

    document
        .roundedRect(PAGE.margin, startY, PAGE.contentWidth, 58, 8)
        .fill(COLORS.light);

    document
        .fillColor(COLORS.secondaryText)
        .font("Helvetica-Bold")
        .fontSize(8)
        .text("TESTAD WEBBPLATS", 65, startY + 11);

    document
        .fillColor(COLORS.text)
        .font("Helvetica-Bold")
        .fontSize(11)
        .text(websiteUrl, 65, startY + 25, {
            width: PAGE.contentWidth - 30,
        });

    const pagesText = totalPages > 0 ? `${totalPages} sidor testade · ` : "";

    document
        .fillColor(COLORS.secondaryText)
        .font("Helvetica")
        .fontSize(8)
        .text(
            `Skapad ${getReportDate()} · ${pagesText}${checkCount} kontroller`,
            65,
            startY + 42
        );

    document.y = startY + 76;
}

// ============================================================
// SAMMANFATTNING
// ============================================================

function addCountBox(
    document: PDFKit.PDFDocument,
    x: number,
    y: number,
    value: number,
    label: string,
    color: string
): void {
    document
        .roundedRect(x, y, 84, 60, 6)
        .lineWidth(0.6)
        .fillAndStroke(COLORS.white, COLORS.border);

    document
        .fillColor(color)
        .font("Helvetica-Bold")
        .fontSize(22)
        .text(String(value), x + 12, y + 10, {
            width: 60,
            lineBreak: false,
        });

    document
        .fillColor(COLORS.secondaryText)
        .font("Helvetica")
        .fontSize(8)
        .text(label, x + 12, y + 40, {
            width: 66,
            lineBreak: false,
        });
}

function addSummaryCard(
    document: PDFKit.PDFDocument,
    results: QACheckResult[]
): void {
    const counts = getResultCounts(results);
    const status = getOverallStatus(results);
    const startY = document.y;

    document
        .roundedRect(PAGE.margin, startY, PAGE.contentWidth, 96, 8)
        .fill(getStatusBackground(status));

    document
        .fillColor(COLORS.secondaryText)
        .font("Helvetica-Bold")
        .fontSize(8)
        .text("ÖVERGRIPANDE RESULTAT", 66, startY + 16);

    document
        .fillColor(getStatusColor(status))
        .font("Helvetica-Bold")
        .fontSize(18)
        .text(getOverallHeadline(status), 66, startY + 32, {
            width: 190,
        });

    document
        .fillColor(COLORS.secondaryText)
        .font("Helvetica")
        .fontSize(8.5)
        .text(`Status: ${status}`, 66, startY + 62);

    const boxesX = PAGE.margin + PAGE.contentWidth - 14 - 268;
    const boxesY = startY + 18;

    addCountBox(document, boxesX, boxesY, counts.fail, "Misslyckade", COLORS.fail);
    addCountBox(document, boxesX + 92, boxesY, counts.warning, "Varningar", COLORS.warning);
    addCountBox(document, boxesX + 184, boxesY, counts.pass, "Godkända", COLORS.pass);

    document.y = startY + 114;
    document.font("Helvetica");
}

// ============================================================
// GÖR FÖRST
// ============================================================

function addDoFirst(
    document: PDFKit.PDFDocument,
    findings: Finding[]
): void {
    const top = findings.slice(0, 3);

    if (top.length === 0) return;

    const textX = PAGE.margin + 44;
    const textWidth = PAGE.contentWidth - 58;

    const items = top.map((finding) => {
        const sub = finding.description ?? finding.category;

        return {
            finding,
            sub,
            titleH: measure(document, finding.title, textWidth, "Helvetica-Bold", 9.5),
            subH: measure(document, sub, textWidth, "Helvetica", 8.5),
        };
    });

    const cardHeight =
        36 +
        items.reduce(
            (sum, item) => sum + item.titleH + item.subH + 14,
            0
        );

    ensureSpace(document, cardHeight + 10, "Sammanfattning");

    const startY = document.y;

    document
        .roundedRect(PAGE.margin, startY, PAGE.contentWidth, cardHeight, 8)
        .lineWidth(0.6)
        .fillAndStroke(COLORS.white, COLORS.border);

    document
        .fillColor(COLORS.secondaryText)
        .font("Helvetica-Bold")
        .fontSize(8)
        .text("GÖR FÖRST", PAGE.margin + 14, startY + 14);

    let y = startY + 34;

    items.forEach((item, index) => {
        document
            .fillColor(COLORS.dark)
            .font("Helvetica-Bold")
            .fontSize(18)
            .text(String(index + 1), PAGE.margin + 14, y - 2, {
                width: 24,
                lineBreak: false,
            });

        document
            .fillColor(COLORS.text)
            .font("Helvetica-Bold")
            .fontSize(9.5)
            .text(item.finding.title, textX, y, {
                width: textWidth,
                lineGap: 2,
            });

        document
            .fillColor(COLORS.muted)
            .font("Helvetica")
            .fontSize(8.5)
            .text(item.sub, textX, y + item.titleH + 2, {
                width: textWidth,
                lineGap: 2,
            });

        y += item.titleH + item.subH + 14;
    });

    document.y = startY + cardHeight + 18;
    document.font("Helvetica");
}

// ============================================================
// FYNDKORT
// ============================================================

function getPriorityColors(
    priority: Priority
): { background: string; text: string } {
    if (priority === "Kritisk") {
        return { background: COLORS.fail, text: COLORS.white };
    }

    if (priority === "Viktig") {
        return { background: "#fde9a8", text: "#6b3a05" };
    }

    return { background: COLORS.lowBackground, text: COLORS.low };
}

function addFindingCard(
    document: PDFKit.PDFDocument,
    finding: Finding,
    totalPages: number
): void {
    const cardX = PAGE.margin;
    const contentX = cardX + 92;
    const contentWidth = PAGE.contentWidth - 106;

    const pagesText = formatPages(finding, totalPages);
    const isTextFinding = /text|stavning/i.test(finding.category);

    const lines: {
        label?: string;
        value: string;
        font?: string;
        size?: number;
    }[] = [];

    lines.push({
        value: finding.title,
        font: "Helvetica-Bold",
        size: 9.5,
    });

    if (finding.description) {
        lines.push({
            value: finding.description,
            size: 8.5,
        });
    }

    if (isTextFinding && finding.matchedText) {
        lines.push({
            label: "Felaktig text: ",
            value: finding.matchedText,
        });

        lines.push({
            label: "Förslag: ",
            value: finding.suggestions || "Inget förslag",
        });
    }

    if (isTextFinding && finding.context) {
        lines.push({
            label: "Sammanhang: ",
            value: finding.context,
        });
    }

    if (pagesText) {
        lines.push({
            label: "Berörd sida: ",
            value: pagesText,
        });
    }

    if (finding.action) {
        lines.push({
            label: "Åtgärd: ",
            value: finding.action,
        });
    }

    const bodyHeight = lines.reduce((sum, line) => {
        const text = `${line.label ?? ""}${line.value}`;

        return (
            sum +
            measure(
                document,
                text,
                contentWidth,
                line.font ?? "Helvetica",
                line.size ?? 8.5
            ) +
            4
        );
    }, 0);

    const cardHeight = Math.max(66, 28 + bodyHeight);

    ensureSpace(document, cardHeight + 8, "Fynd efter prioritet");

    const startY = document.y;

    document
        .roundedRect(cardX, startY, PAGE.contentWidth, cardHeight, 7)
        .lineWidth(0.6)
        .fillAndStroke(COLORS.white, COLORS.border);

    const priorityColors = getPriorityColors(finding.priority);

    document
        .roundedRect(cardX + 14, startY + 14, 62, 16, 8)
        .fill(priorityColors.background);

    document
        .fillColor(priorityColors.text)
        .font("Helvetica-Bold")
        .fontSize(7.5)
        .text(finding.priority, cardX + 14, startY + 19.5, {
            width: 62,
            align: "center",
            lineBreak: false,
        });

    document
        .fillColor(COLORS.secondaryText)
        .font("Helvetica-Bold")
        .fontSize(7)
        .text(finding.category.toUpperCase(), cardX + 14, startY + 38, {
            width: 72,
        });

    let y = startY + 14;

    for (const line of lines) {
        const font = line.font ?? "Helvetica";
        const size = line.size ?? 8.5;

        document
            .fillColor(COLORS.text)
            .font(font)
            .fontSize(size);

        if (line.label) {
            document.text(line.label, contentX, y, {
                width: contentWidth,
                continued: true,
                lineGap: 2,
            });

            document
                .font("Helvetica")
                .fontSize(size)
                .text(line.value, {
                    width: contentWidth,
                    lineGap: 2,
                });
        } else {
            document.text(line.value, contentX, y, {
                width: contentWidth,
                lineGap: 2,
            });
        }

        y = document.y + 4;
    }

    document.y = startY + cardHeight + 8;
    document.font("Helvetica");
}

// ============================================================
// ALLA FYND
// ============================================================

function addFindings(
    document: PDFKit.PDFDocument,
    findings: Finding[],
    totalPages: number
): void {
    ensureSpace(document, 100, "Fynd efter prioritet");

    addSectionTitle(
        document,
        "Fynd efter prioritet",
        findings.length > 0
            ? `${findings.length} fynd sorterade efter prioritet.`
            : undefined
    );

    if (findings.length === 0) {
        const startY = document.y;

        document
            .roundedRect(PAGE.margin, startY, PAGE.contentWidth, 42, 7)
            .fill(COLORS.passBackground);

        document
            .fillColor(COLORS.pass)
            .font("Helvetica-Bold")
            .fontSize(9)
            .text("Inga problem identifierades.", 65, startY + 14);

        document.y = startY + 58;
        return;
    }

    for (const finding of findings) {
        addFindingCard(document, finding, totalPages);
    }
}

// ============================================================
// PRESTANDA
// ============================================================

function addPerformanceBar(
    document: PDFKit.PDFDocument,
    y: number,
    label: string,
    score: number
): void {
    const safeScore = Math.max(0, Math.min(100, score));
    const trackX = PAGE.margin + 70;
    const trackWidth = PAGE.contentWidth - 120;

    document
        .fillColor(COLORS.text)
        .font("Helvetica")
        .fontSize(9)
        .text(label, PAGE.margin, y + 5, {
            width: 66,
            lineBreak: false,
        });

    document
        .roundedRect(trackX, y, trackWidth, 20, 5)
        .fill(COLORS.lowBackground);

    document
        .roundedRect(
            trackX,
            y,
            Math.max(1, (trackWidth * safeScore) / 100),
            20,
            5
        )
        .fill(
            safeScore >= PERFORMANCE_TARGET
                ? COLORS.pass
                : COLORS.warning
        );

    const targetX = trackX + (trackWidth * PERFORMANCE_TARGET) / 100;

    document
        .rect(targetX - 1, y - 4, 2, 28)
        .fill(COLORS.dark);

    document
        .fillColor(COLORS.text)
        .font("Helvetica-Bold")
        .fontSize(10)
        .text(String(safeScore), trackX + trackWidth + 8, y + 5, {
            width: 36,
            lineBreak: false,
        });
}

function addPerformance(
    document: PDFKit.PDFDocument,
    results: QACheckResult[]
): void {
    const result = results.find((r) =>
        /prestanda|performance/i.test(r.name)
    );

    if (!result) return;

    const message = cleanMessage(result.message);

    const desktopMatch = message.match(/Desktop:\s*(\d+)/i);
    const mobileMatch = message.match(/(?:Mobile|Mobil):\s*(\d+)/i);

    const desktop = desktopMatch ? Number(desktopMatch[1]) : undefined;
    const mobile = mobileMatch ? Number(mobileMatch[1]) : undefined;

    if (desktop === undefined && mobile === undefined) return;

    ensureSpace(document, 140, "Prestanda");
    addSectionTitle(document, "Prestanda");

    const y = document.y + 6;

    if (desktop !== undefined) {
        addPerformanceBar(document, y, "Desktop", desktop);
    }

    if (mobile !== undefined) {
        addPerformanceBar(
            document,
            y + (desktop !== undefined ? 36 : 0),
            "Mobil",
            mobile
        );
    }

    document
        .fillColor(COLORS.secondaryText)
        .font("Helvetica")
        .fontSize(8)
        .text(
            `Den svarta linjen markerar målet ${PERFORMANCE_TARGET}/100.`,
            PAGE.margin,
            y + (desktop !== undefined && mobile !== undefined ? 76 : 40),
            { width: PAGE.contentWidth }
        );

    document.y = y + (desktop !== undefined && mobile !== undefined ? 100 : 64);
}

// ============================================================
// DET SOM FUNGERAR
// ============================================================

function addWhatWorks(
    document: PDFKit.PDFDocument,
    results: QACheckResult[]
): void {
    const passed = results.filter((r) => r.status === "PASS");

    if (passed.length === 0) return;

    ensureSpace(document, 90, "Det som fungerar");
    addSectionTitle(document, "Det som fungerar");

    const nameWidth = 110;
    const messageX = PAGE.margin + 14 + nameWidth + 8;
    const messageWidth = PAGE.contentWidth - 14 - nameWidth - 8;

    for (const result of passed) {
        const message = shortenText(result.message, 160);

        const rowHeight = Math.max(
            16,
            measure(document, message, messageWidth, "Helvetica", 8.5) + 6
        );

        ensureSpace(document, rowHeight, "Det som fungerar");

        const y = document.y;
        const isInfo = /^0\s/.test(message);

        document
            .circle(PAGE.margin + 4, y + 5, 3)
            .fill(isInfo ? COLORS.secondaryText : COLORS.pass);

        document
            .fillColor(COLORS.text)
            .font("Helvetica-Bold")
            .fontSize(8.5)
            .text(result.name, PAGE.margin + 14, y, {
                width: nameWidth,
            });

        document
            .fillColor(COLORS.muted)
            .font("Helvetica")
            .fontSize(8.5)
            .text(isInfo ? `Information: ${message}` : message, messageX, y, {
                width: messageWidth,
                lineGap: 2,
            });

        document.y = y + rowHeight;
    }

    document.y += 6;
    document.font("Helvetica");
}

// ============================================================
// TEKNISK BILAGA
// ============================================================

function addResultCard(
    document: PDFKit.PDFDocument,
    result: QACheckResult,
    continuationTitle = "Teknisk bilaga"
): void {
    const message = shortenText(result.message, 2000);
    const textX = 125;
    const textWidth = document.page.width - 190;

    const messageHeight = message
        ? measure(document, message, textWidth, "Helvetica", 8.5)
        : 0;

    const cardHeight = Math.max(48, 30 + messageHeight + 12);

    ensureSpace(document, cardHeight + 8, continuationTitle);

    const startY = document.y;

    document
        .roundedRect(PAGE.margin, startY, PAGE.contentWidth, cardHeight, 7)
        .fill(getStatusBackground(result.status));

    document
        .fillColor(getStatusColor(result.status))
        .font("Helvetica-Bold")
        .fontSize(8)
        .text(result.status, 65, startY + 10, {
            width: 52,
        });

    document
        .fillColor(COLORS.text)
        .font("Helvetica-Bold")
        .fontSize(10)
        .text(result.name, textX, startY + 8, {
            width: textWidth,
        });

    if (message) {
        document
            .fillColor(COLORS.muted)
            .font("Helvetica")
            .fontSize(8.5)
            .text(message, textX, startY + 25, {
                width: textWidth,
                lineGap: 2,
            });
    }

    document.y = startY + cardHeight + 8;
}

function addTechnicalAppendix(
    document: PDFKit.PDFDocument,
    results: QACheckResult[]
): void {
    startNewPage(document, "Teknisk bilaga");

    addSectionTitle(
        document,
        "Teknisk bilaga",
        `${results.length} automatiserade kontroller med originalresultat.`
    );

    for (const result of results) {
        addResultCard(document, result);
    }

    document.font("Helvetica");
}

// ============================================================
// AI-ANALYS
// ============================================================

function parseAIAnalysis(
    aiAnalysis: string
): { title: string; body: string[] }[] {
    const sections: { title: string; body: string[] }[] = [];
    let current: { title: string; body: string[] } | null = null;

    const lines = aiAnalysis
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    for (const line of lines) {
        const heading = line.replace(/^\d+[.)]\s*/, "");

        const isHeading =
            /^(Vad fungerar bra|Viktigaste problemen|Vad resultaten visar|Rekommendationer)$/i.test(
                heading
            );

        if (isHeading) {
            current = { title: heading, body: [] };
            sections.push(current);
            continue;
        }

        if (!current) {
            current = { title: "AI-analys", body: [] };
            sections.push(current);
        }

        current.body.push(line);
    }

    return sections;
}

function addAISection(
    document: PDFKit.PDFDocument,
    title: string,
    lines: string[]
): void {
    const safeLines = lines.slice(0, 12).map((line) => shortenText(line, 260));

    ensureSpace(document, 90, "AI-analys");

    const color = /problem|rekommend/i.test(title)
        ? COLORS.warning
        : COLORS.dark;

    document
        .fillColor(color)
        .font("Helvetica-Bold")
        .fontSize(11)
        .text(title, PAGE.margin, document.y);

    document.y += 20;

    for (const rawLine of safeLines) {
        const isBullet = /^[-*•]/.test(rawLine);
        const line = rawLine.replace(/^[-*•]\s*/, "");

        const lineHeight = measure(
            document,
            line,
            PAGE.contentWidth - 25,
            "Helvetica",
            8.5
        );

        ensureSpace(document, lineHeight + 10, "AI-analys");

        if (isBullet) {
            document
                .fillColor(color)
                .font("Helvetica-Bold")
                .fontSize(8.5)
                .text("•", PAGE.margin, document.y, {
                    width: 10,
                    lineBreak: false,
                });

            document
                .fillColor(COLORS.muted)
                .font("Helvetica")
                .fontSize(8.5)
                .text(line, PAGE.margin + 15, document.y, {
                    width: PAGE.contentWidth - 15,
                    lineGap: 2,
                });
        } else {
            document
                .fillColor(COLORS.muted)
                .font("Helvetica")
                .fontSize(8.5)
                .text(line, PAGE.margin, document.y, {
                    width: PAGE.contentWidth,
                    lineGap: 2,
                });
        }

        document.y += 5;
    }

    document
        .strokeColor(COLORS.border)
        .lineWidth(0.5)
        .moveTo(PAGE.margin, document.y + 3)
        .lineTo(document.page.width - PAGE.margin, document.y + 3)
        .stroke();

    document.y += 15;
}

function addAIAnalysis(
    document: PDFKit.PDFDocument,
    aiAnalysis: string
): void {
    const sections = parseAIAnalysis(aiAnalysis).filter(
        (section) =>
            !(
                HIDE_DUPLICATE_AI_SECTIONS &&
                /^(Vad fungerar bra|Viktigaste problemen|Vad resultaten visar)$/i.test(
                    section.title
                )
            )
    );

    if (sections.length === 0) return;

    startNewPage(document, "AI-analys");

    document
        .fillColor(COLORS.secondaryText)
        .font("Helvetica")
        .fontSize(8.5)
        .text(
            "Automatiserad analys av QA-resultaten genererad av projektets lokala AI-modell.",
            PAGE.margin,
            document.y,
            { width: PAGE.contentWidth }
        );

    document.y += 25;

    for (const section of sections) {
        addAISection(document, section.title, section.body);
    }
}

// ============================================================
// GEMENSAM RAPPORTDEL
// ============================================================

function addReportBody(
    document: PDFKit.PDFDocument,
    results: QACheckResult[],
    aiAnalysis?: string
): void {
    const totalPages = getTotalPages(results);
    const findings = deriveFindings(results);

    addSummaryCard(document, results);
    addDoFirst(document, findings);
    addFindings(document, findings, totalPages);
    addPerformance(document, results);
    addWhatWorks(document, results);

    if (aiAnalysis?.trim()) {
        addAIAnalysis(document, aiAnalysis);
    }

    if (INCLUDE_TECHNICAL_APPENDIX) {
        addTechnicalAppendix(document, results);
    }
}

// ============================================================
// PDF-SKRIVNING
// ============================================================

async function finishPDF(
    document: PDFKit.PDFDocument,
    stream: fs.WriteStream
): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        stream.once("finish", resolve);
        stream.once("error", reject);
        document.once("error", reject);

        document.end();
    });
}

function createReportsDirectory(): string {
    const reportsDirectory = path.join(
        os.tmpdir(),
        "website-qa-system"
    );

    if (!fs.existsSync(reportsDirectory)) {
        fs.mkdirSync(reportsDirectory, {
            recursive: true,
        });
    }

    return reportsDirectory;
}

// ============================================================
// VANLIG PDF-RAPPORT
// ============================================================

export async function createPDFReport(
    data: PDFReportData
): Promise<string> {
    const reportsDirectory = createReportsDirectory();

    let hostname = "website";

    try {
        hostname = new URL(data.websiteUrl).hostname;
    } catch {
        // Standardnamnet används om URL:en inte kan tolkas.
    }

    hostname = hostname.replace(/[^a-zA-Z0-9.-]/g, "-");

    const filePath = path.join(
        reportsDirectory,
        `QA-Report-${hostname}.pdf`
    );

    const document = new PDFDocument({
        size: "A4",
        margin: PAGE.margin,
        info: {
            Title: `Website QA Report - ${hostname}`,
            Author: "Website QA System",
            Subject: "Automatiserad QA-rapport",
        },
    });

    const stream = fs.createWriteStream(filePath);

    document.pipe(stream);

    addReportHeader(
        document,
        data.websiteUrl,
        "Automatiserad QA-rapport"
    );

    addWebsiteInformation(
        document,
        data.websiteUrl,
        getTotalPages(data.results),
        data.results.length
    );

    addReportBody(
        document,
        data.results,
        data.aiAnalysis
    );

    await finishPDF(document, stream);

    return filePath;
}

// ============================================================
// CSV-PDF
// ============================================================

export async function createCSVPDFReport(
    reports: CSVPDFReportItem[]
): Promise<string> {
    const reportsDirectory = createReportsDirectory();

    const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-");

    const filePath = path.join(
        reportsDirectory,
        `QA-Report-CSV-${timestamp}.pdf`
    );

    const document = new PDFDocument({
        size: "A4",
        margin: PAGE.margin,
        info: {
            Title: "Website QA System - CSV-rapport",
            Author: "Website QA System",
            Subject: "Sammanställd QA-rapport",
        },
    });

    const stream = fs.createWriteStream(filePath);

    document.pipe(stream);

    // --------------------------------------------------------
    // ÖVERSIKT
    // --------------------------------------------------------

    addReportHeader(
        document,
        "CSV-import",
        "Sammanställd QA-rapport"
    );

    const completed = reports.filter((r) => r.success).length;
    const failed = reports.length - completed;

    addSectionTitle(
        document,
        "Översikt",
        "Sammanställning av webbplatser som analyserats via CSV-import."
    );

    const overviewY = document.y;

    document
        .roundedRect(PAGE.margin, overviewY, PAGE.contentWidth, 90, 8)
        .fill(COLORS.light);

    document
        .fillColor(COLORS.secondaryText)
        .font("Helvetica-Bold")
        .fontSize(8)
        .text("WEBBPLATSER", 70, overviewY + 15);

    document
        .fillColor(COLORS.dark)
        .fontSize(20)
        .text(String(reports.length), 70, overviewY + 31);

    document
        .fillColor(COLORS.pass)
        .fontSize(8)
        .text("KLARA", 225, overviewY + 15);

    document
        .fontSize(18)
        .text(String(completed), 225, overviewY + 31);

    document
        .fillColor(COLORS.fail)
        .fontSize(8)
        .text("MISSLYCKADE", 350, overviewY + 15);

    document
        .fontSize(18)
        .text(String(failed), 350, overviewY + 31);

    document
        .fillColor(COLORS.secondaryText)
        .font("Helvetica")
        .fontSize(8)
        .text(`Rapport skapad: ${getReportDate()}`, 70, overviewY + 68);

    document.y = overviewY + 110;

    // --------------------------------------------------------
    // RESULTAT PER WEBBPLATS
    // --------------------------------------------------------

    addSectionTitle(
        document,
        "Resultat per webbplats",
        "Översikt över status och antal kontroller för varje webbplats."
    );

    for (const report of reports) {
        if (!report.success) {
            const errorText = shortenText(
                report.error ?? "Okänt fel",
                500
            );

            const errorHeight = Math.max(
                65,
                measure(
                    document,
                    errorText,
                    PAGE.contentWidth - 125,
                    "Helvetica",
                    8
                ) + 42
            );

            ensureSpace(
                document,
                errorHeight + 10,
                "Resultat per webbplats"
            );

            const startY = document.y;

            document
                .roundedRect(
                    PAGE.margin,
                    startY,
                    PAGE.contentWidth,
                    errorHeight,
                    7
                )
                .fill(COLORS.failBackground);

            document
                .fillColor(COLORS.fail)
                .font("Helvetica-Bold")
                .fontSize(9)
                .text("FAIL", 65, startY + 12);

            document
                .fillColor(COLORS.text)
                .fontSize(9)
                .text(report.websiteUrl, 110, startY + 11, {
                    width: PAGE.contentWidth - 125,
                });

            document
                .fillColor(COLORS.muted)
                .font("Helvetica")
                .fontSize(8)
                .text(errorText, 110, startY + 30, {
                    width: PAGE.contentWidth - 125,
                    lineGap: 2,
                });

            document.y = startY + errorHeight + 10;

            continue;
        }

        const counts = getResultCounts(report.results);
        const overallStatus = getOverallStatus(report.results);
        const cardHeight = 82;

        ensureSpace(
            document,
            cardHeight + 10,
            "Resultat per webbplats"
        );

        const startY = document.y;

        document
            .roundedRect(
                PAGE.margin,
                startY,
                PAGE.contentWidth,
                cardHeight,
                7
            )
            .fill(getStatusBackground(overallStatus));

        document
            .fillColor(getStatusColor(overallStatus))
            .font("Helvetica-Bold")
            .fontSize(9)
            .text(overallStatus, 65, startY + 12);

        document
            .fillColor(COLORS.text)
            .fontSize(9.5)
            .text(report.websiteUrl, 135, startY + 11, {
                width: PAGE.contentWidth - 150,
            });

        document
            .fillColor(COLORS.pass)
            .font("Helvetica")
            .fontSize(8)
            .text(`PASS: ${counts.pass}`, 135, startY + 34);

        document
            .fillColor(COLORS.warning)
            .text(`WARNING: ${counts.warning}`, 220, startY + 34);

        document
            .fillColor(COLORS.fail)
            .text(`FAIL: ${counts.fail}`, 335, startY + 34);

        document
            .fillColor(COLORS.secondaryText)
            .text(
                `Antal kontroller: ${report.results.length}`,
                135,
                startY + 55
            );

        document.y = startY + cardHeight + 10;
    }

    // --------------------------------------------------------
    // DETALJER PER WEBBPLATS
    // --------------------------------------------------------

    for (const report of reports) {
        startNewPage(document, "Detaljerad QA-rapport");

        document
            .fillColor(COLORS.secondaryText)
            .font("Helvetica")
            .fontSize(8.5)
            .text(report.websiteUrl, PAGE.margin, document.y, {
                width: PAGE.contentWidth,
            });

        document.y += 22;

        if (!report.success) {
            addSectionTitle(
                document,
                "Skanningen misslyckades"
            );

            document
                .fillColor(COLORS.fail)
                .font("Helvetica-Bold")
                .fontSize(12)
                .text("FAIL", PAGE.margin, document.y);

            document.y += 22;

            document
                .fillColor(COLORS.muted)
                .font("Helvetica")
                .fontSize(9)
                .text(
                    shortenText(report.error ?? "Okänt fel", 800),
                    PAGE.margin,
                    document.y,
                    {
                        width: PAGE.contentWidth,
                        lineGap: 3,
                    }
                );

            continue;
        }

        addReportBody(
            document,
            report.results,
            report.aiAnalysis
        );
    }

    await finishPDF(document, stream);

    return filePath;
}
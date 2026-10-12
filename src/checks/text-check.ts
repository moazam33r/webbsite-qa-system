
import { URLSearchParams } from "node:url";

// Automatisk kontroll av stavning och grammatik
// med hjälp av LanguageTool.

export interface TextIssue {
  message: string;
  suggestions: string[];
  context: string;
  matchedText: string;
  pageUrl: string;
}

export interface TextCheckResult {
  errors: number;
  issues: TextIssue[];
  status: "PASS" | "WARNING";
}

interface LanguageToolMatch {
  message?: string;
  replacements?: Array<{ value?: string }>;
  context?: {
    text?: string;
    offset?: number;
    length?: number;
  };
  rule?: {
    id?: string;
    issueType?: string;
  };
}

// =========================================================
// TEKNISKA IDENTIFIERARE
// =========================================================

function isTechnicalTerm(value: string): boolean {
  const word = value.trim();

  if (!word) {
    return true;
  }

  // WordPress-inställningar, cookie-namn och andra
  // tekniska identifierare med bindestreck eller understreck.
  if (/^[\p{L}\p{N}_]+(?:[-_][\p{L}\p{N}_]*)+$/u.test(word)) {
    return true;
  }

  // Exempel: version2, api123 och liknande identifierare.
  if (/[\p{L}]/u.test(word) && /\d/.test(word)) {
    return true;
  }

  return false;
}

// =========================================================
// KÄNDA ORD OCH FÖRKORTNINGAR
// =========================================================

const IGNORED_WORDS = new Set([
  "google",
  "wordpress",
  "instagram",
  "facebook",
  "linkedin",
  "youtube",
  "tiktok",
  "seo",
  "ads",
  "api",
  "html",
  "css",
  "javascript",
  "typescript",
  "playwright",
  "pagespeed",
  "digitalkontakt",
]);

// Ord som är kända för en viss webbplats.
// Vanliga svenska ord ska inte läggas här globalt.
function getSiteKnownWords(pageUrl: string): Set<string> {
  const words = new Set<string>();

  try {
    const hostname = new URL(pageUrl).hostname.toLowerCase();

    if (hostname.includes("tmkbetong")) {
      [
        "tmk",
        "betonghåltagning",
        "bilning",
        "husarvägen",
        "karvonen",
        "administrationsdelen",
        "administrationsvyns",
      ].forEach((word) => words.add(word));
    }
  } catch {
    // En ogiltig URL ska inte stoppa textkontrollen.
  }

  return words;
}

// Vissa ord är tekniska endast i vissa sammanhang.
function isTechnicalContext(
  matchedText: string,
  context: string
): boolean {
  const word = matchedText.trim().toLowerCase();
  const normalizedContext = context.toLowerCase();

  const technicalWords = new Set([
    "hash",
    "sec",
    "logged",
  ]);

  if (!technicalWords.has(word)) {
    return false;
  }

  return /wordpress|wp-content|cookie|cookies|session|consent|security|logged.?in|http/i.test(
    normalizedContext
  );
}

// =========================================================
// IDENTIFIERA UPPREPADE ORD
// =========================================================

function isRepeatedWord(value: string): boolean {
  const word = String.raw`([\p{L}][\p{L}'’\-]{2,})`;
  const pattern = new RegExp(`^${word}\\s+\\1$`, "iu");

  return pattern.test(value.trim());
}

// Rubriker kan hamna bredvid varandra i den extraherade texten.
// Två identiska versala ord ska därför inte automatiskt
// klassas som ett stavfel.
function isUppercaseRepeatedWord(value: string): boolean {
  if (!isRepeatedWord(value)) {
    return false;
  }

  return /^[\p{Lu}\s'’\-]+$/u.test(value.trim());
}

// =========================================================
// HÄMTA EXAKT MARKERAD TEXT
// =========================================================

function getMatchedText(match: LanguageToolMatch): string {
  const context = match.context?.text;
  const offset = match.context?.offset;
  const length = match.context?.length;

  if (
    typeof context !== "string" ||
    !Number.isInteger(offset) ||
    !Number.isInteger(length) ||
    offset! < 0 ||
    length! <= 0 ||
    offset! + length! > context.length
  ) {
    return "";
  }

  return context.substring(offset!, offset! + length!);
}

// =========================================================
// HÄMTA FÖRSLAG
// =========================================================

function getSuggestions(match: LanguageToolMatch): string[] {
  return (match.replacements ?? [])
    .slice(0, 3)
    .map((replacement) => replacement.value?.trim() ?? "")
    .filter((suggestion) => suggestion.length > 0);
}

// =========================================================
// KONTROLLERA UPPREPADE ORD
// =========================================================

// Hittar exempelvis:
// "Vi erbjuder erbjuder hjälp"
//
// Versala upprepningar hoppas över eftersom de ofta kan
// komma från två rubriker som hamnat intill varandra.

function findRepeatedWords(
  text: string,
  pageUrl: string
): TextIssue[] {
  const issues: TextIssue[] = [];

  const pattern =
    /\b([\p{L}][\p{L}'’\-]{2,})\s+\1\b/giu;

  for (const match of text.matchAll(pattern)) {
    const repeatedText = match[0];

    if (!repeatedText || isUppercaseRepeatedWord(repeatedText)) {
      continue;
    }

    const start = match.index ?? 0;
    const contextStart = Math.max(0, start - 65);
    const contextEnd = Math.min(
      text.length,
      start + repeatedText.length + 65
    );

    const context = text
      .slice(contextStart, contextEnd)
      .replace(/\s+/g, " ")
      .trim();

    issues.push({
      message: "Samma ord förekommer två gånger i följd.",
      suggestions: [match[1]],
      context,
      matchedText: repeatedText,
      pageUrl,
    });
  }

  return issues;
}

// =========================================================
// SKAPA DUBBLETTNYCKEL
// =========================================================

function normalize(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("sv");
}

function issueKey(issue: TextIssue): string {
  return [
    normalize(issue.matchedText),
    normalize(issue.message),
    normalize(issue.context),
    issue.pageUrl,
  ].join("|");
}

// =========================================================
// TEXTKONTROLL
// =========================================================

export async function checkText(
  text: string,
  language = "sv",
  pageUrl = "",
  siteWordFrequency?: Map<string, number>
): Promise<TextCheckResult> {
  try {
    if (!text.trim()) {
      return {
        errors: 0,
        issues: [],
        status: "PASS",
      };
    }

    // Ta inte bort allt innehåll efter en Google Reviews-markör.
    // Sådana markörer kan förekomma mitt på en sida och texten
    // efter dem kan innehålla viktigt innehåll.
    const cleanedText = text
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+/g, " ")
      .trim();

    const knownWords = getSiteKnownWords(pageUrl);

    // Frekvensdata ska inte automatiskt dölja återkommande
    // felstavningar på flera sidor.
    void siteWordFrequency;

    const body = new URLSearchParams();
    body.append("text", cleanedText);
    body.append("language", language);

    const response = await fetch(
      "https://api.languagetool.org/v2/check",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      }
    );

    if (!response.ok) {
      console.log(
        `⚠ LanguageTool svarade med HTTP ${response.status}.`
      );

      return {
        errors: 0,
        issues: [],
        status: "WARNING",
      };
    }

    const data: { matches?: LanguageToolMatch[] } =
      await response.json();

    if (!Array.isArray(data.matches)) {
      console.log(
        "⚠ LanguageTool returnerade ett oväntat svar."
      );

      return {
        errors: 0,
        issues: [],
        status: "WARNING",
      };
    }

    // =====================================================
    // FILTRERA LANGUAGE TOOL-TRÄFFAR
    // =====================================================

    const issues: TextIssue[] = [];

    for (const match of data.matches) {
      const matchedText = getMatchedText(match).trim();

      if (!matchedText) {
        continue;
      }

      const normalizedText = normalize(matchedText);
      const context = match.context?.text ?? "";
      const ruleId = match.rule?.id?.toLowerCase() ?? "";
      const message = match.message ?? "Okänt textfel";

      if (normalizedText.length <= 2) {
        continue;
      }

      if (isTechnicalTerm(matchedText)) {
        continue;
      }

      if (IGNORED_WORDS.has(normalizedText)) {
        continue;
      }

      if (knownWords.has(normalizedText)) {
        continue;
      }

      // Ignorera korta, helt versala förkortningar,
      // exempelvis IMY.
      if (/^[A-ZÅÄÖ]{2,6}$/.test(matchedText)) {
        continue;
      }

      if (isTechnicalContext(matchedText, context)) {
        continue;
      }

      // LanguageTool kan markera två identiska versala ord
      // som ett korrekturfel när två rubriker ligger intill
      // varandra i textutdraget.
      const isDuplicateWordRule =
        /repeat|duplicate|word_twice|repeated_word/i.test(
          `${ruleId} ${message}`
        );

      if (
        isDuplicateWordRule &&
        isUppercaseRepeatedWord(matchedText)
      ) {
        continue;
      }

      issues.push({
        message,
        suggestions: getSuggestions(match),
        context: context.replace(/\s+/g, " ").trim(),
        matchedText,
        pageUrl,
      });
    }

    // =====================================================
    // KONTROLLERA DUBBLA ORD
    // =====================================================

    issues.push(...findRepeatedWords(cleanedText, pageUrl));

    // =====================================================
    // TA BORT IDENTISKA FYND
    // =====================================================

    const uniqueIssues = issues.filter(
      (issue, index, allIssues) => {
        const key = issueKey(issue);

        return (
          allIssues.findIndex(
            (candidate) => issueKey(candidate) === key
          ) === index
        );
      }
    );

    // =====================================================
    // RESULTAT
    // =====================================================

    if (uniqueIssues.length === 0) {
      console.log(
        `✓ Inga relevanta textfel hittades på ${pageUrl || "sidan"}.`
      );

      return {
        errors: 0,
        issues: [],
        status: "PASS",
      };
    }

    console.log(
      `⚠ ${uniqueIssues.length} möjliga textfel hittades på ${pageUrl || "sidan"}.`
    );

    for (const issue of uniqueIssues) {
      console.log(`- Felaktig text: ${issue.matchedText}`);
      console.log(`  Sida: ${issue.pageUrl}`);
      console.log(`  Sammanhang: ${issue.context}`);
      console.log(`  Förklaring: ${issue.message}`);

      if (issue.suggestions.length > 0) {
        console.log(
          `  Förslag: ${issue.suggestions.join(", ")}`
        );
      }
    }

    return {
      errors: uniqueIssues.length,
      issues: uniqueIssues,
      status: "WARNING",
    };
  } catch (error) {
    console.error(
      "⚠ Textkontrollen kunde inte genomföras:",
      error instanceof Error ? error.message : error
    );

    return {
      errors: 0,
      issues: [],
      status: "WARNING",
    };
  }
}
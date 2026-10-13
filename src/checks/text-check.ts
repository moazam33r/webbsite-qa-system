
import { URLSearchParams } from "node:url";

// Automatisk kontroll av stavning och grammatik
// med hjälp av LanguageTool.

export type TextClassification = "LIKELY_SPELLING" | "REVIEW";

export interface TextIssue {
  message: string;
  suggestions: string[];
  context: string;
  matchedText: string;
  pageUrl: string;
  ruleId: string;
  issueType: string;

  classification: TextClassification;
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



// Identifiera tekniska identifierare.
function isTechnicalTerm(value: string): boolean {
  const word = value.trim();

  if (!word) {
    return true;
  }

  // Exempelvis session_id.

  if (/^[\p{L}\p{N}]+(?:_[\p{L}\p{N}]+)+$/u.test(word)) {
    return true;
  }

  // Identifierare som blandar bokstäver och siffror.

  if (/\p{L}/u.test(word) && /\d/u.test(word)) {
    return true;
  }

  return false;
}


// Hämta exakt markerad text från LanguageTool.
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



// Hämta högst tre förslag.
function getSuggestions(match: LanguageToolMatch): string[] {
  return (match.replacements ?? [])
    .slice(0, 3)
    .map((replacement) => replacement.value?.trim() ?? "")
    .filter((suggestion) => suggestion.length > 0);
}


// Normalisera text för jämförelser.
function normalize(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("sv");
}


// Skapa en nyckel för att identifiera dubbletter.
function issueKey(issue: TextIssue): string {
  return [
    normalize(issue.matchedText),
    normalize(issue.message),
    normalize(issue.context),
    issue.pageUrl,

    issue.ruleId,
  ].join("|");
}



// Textkontroll.
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

    // Normalisera blanksteg utan att ta bort innehåll.
    const cleanedText = text
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+/g, " ")
      .trim();

    // Frekvensdata får inte dölja återkommande stavfel.
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
      console.log("⚠ LanguageTool returnerade ett oväntat svar.");

      return {
        errors: 0,
        issues: [],
        status: "WARNING",
      };
    }

    const issues: TextIssue[] = [];

    for (const match of data.matches) {
      const matchedText = getMatchedText(match).trim();

      if (!matchedText) {
        continue;
      }

      const normalizedText = normalize(matchedText);
      const context = match.context?.text ?? "";
      const message = match.message ?? "Okänt textfel";
      const ruleId = match.rule?.id ?? "UNKNOWN";
      const issueType = match.rule?.issueType ?? "unknown";

      // Hoppa över mycket korta träffar.
      if (normalizedText.length <= 2) {
        continue;
      }

      // Filtrera tydliga tekniska identifierare.
      if (isTechnicalTerm(matchedText)) {
        continue;
      }

      // Filtrera korta förkortningar med enbart versaler.
      if (/^[A-ZÅÄÖ]{2,6}$/.test(matchedText)) {
        continue;
      }

      // Endast LanguageTools uttryckliga stavningsklassning
      // ger en första bedömning som sannolikt stavfel.
      // Övriga träffar behöver granskas försiktigt.
      const classification: TextClassification =
        issueType.toLowerCase() === "misspelling"
          ? "LIKELY_SPELLING"
          : "REVIEW";

      issues.push({
        message,
        suggestions: getSuggestions(match),
        context: context.replace(/\s+/g, " ").trim(),
        matchedText,
        pageUrl,
        ruleId,
        issueType,
        classification,
      });
    }

    // Ta bort identiska fynd.
    const uniqueIssues = issues.filter((issue, index, allIssues) => {
      const key = issueKey(issue);

      return (
        allIssues.findIndex(
          (candidate) => issueKey(candidate) === key
        ) === index
      );
    });

    if (uniqueIssues.length === 0) {
      console.log(
        `✓ Inga textfel hittades på ${pageUrl || "sidan"}.`
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

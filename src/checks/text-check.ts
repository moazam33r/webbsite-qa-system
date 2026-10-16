
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
  completed: boolean;
  failureReason?: string;
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

interface LanguageToolResponse {
  matches?: LanguageToolMatch[];
}

interface ChunkResult {
  matches: LanguageToolMatch[];
  failures: string[];
}

// Börjar med mindre textdelar för att undvika HTTP 413.
const MAX_CHUNK_LENGTH = 6000;

// Om en del fortfarande ger HTTP 413 delas den upp igen.
// Under denna gräns rapporteras felet i stället för att
// fortsätta dela upp texten i mycket små delar.
const MIN_CHUNK_LENGTH = 500;

const LANGUAGETOOL_URL =
  "https://api.languagetool.org/v2/check";

// Identifierar tydliga tekniska identifierare.
function isTechnicalTerm(value: string): boolean {
  const word = value.trim();

  if (!word) {
    return true;
  }

  // Exempelvis session_id eller wordpress_logged_in.
  if (/^[\p{L}\p{N}]+(?:_[\p{L}\p{N}]+)+$/u.test(word)) {
    return true;
  }

  // Identifierare som blandar bokstäver och siffror.
  if (/\p{L}/u.test(word) && /\d/u.test(word)) {
    return true;
  }

  return false;
}

// Delar text vid ett lämpligt blanksteg nära maxgränsen.
// Alla delar behåller sin text i rätt ordning.
function splitText(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + maxLength, text.length);

    if (end < text.length) {
      const section = text.slice(start, end);
      const lastWhitespace = Math.max(
        section.lastIndexOf(" "),
        section.lastIndexOf("\n"),
        section.lastIndexOf("\t")
      );

      // Undvik att skapa onödigt korta delar.
      if (lastWhitespace > maxLength * 0.6) {
        end = start + lastWhitespace + 1;
      }
    }

    const chunk = text.slice(start, end).trim();

    if (chunk) {
      chunks.push(chunk);
    }

    start = end;
  }

  return chunks;
}

// Delar en för stor textdel i två mindre delar.
// Försöker att inte dela ett ord mitt itu.
function splitChunkInHalf(text: string): [string, string] | null {
  if (text.length < 2) {
    return null;
  }

  const midpoint = Math.floor(text.length / 2);

  let splitPoint = text.lastIndexOf(" ", midpoint);

  if (splitPoint < text.length * 0.25) {
    splitPoint = text.indexOf(" ", midpoint);
  }

  if (
    splitPoint <= 0 ||
    splitPoint >= text.length - 1
  ) {
    splitPoint = midpoint;
  }

  const first = text.slice(0, splitPoint).trim();
  const second = text.slice(splitPoint).trim();

  if (!first || !second) {
    return null;
  }

  return [first, second];
}

// Skickar en textdel till LanguageTool.
// Vid HTTP 413 delas textdelen automatiskt upp och provas igen.
async function checkChunk(
  text: string,
  language: string
): Promise<ChunkResult> {
  const body = new URLSearchParams();
  body.append("text", text);
  body.append("language", language);

  let response: Response;

  try {
    response = await fetch(LANGUAGETOOL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : String(error);

    return {
      matches: [],
      failures: [`Anropet till LanguageTool misslyckades: ${reason}`],
    };
  }

  // En för stor förfrågan delas upp och kontrolleras igen.
  if (response.status === 413) {
    if (text.length <= MIN_CHUNK_LENGTH) {
      return {
        matches: [],
        failures: [
          `LanguageTool svarade med HTTP 413 även för en textdel på ${text.length} tecken.`,
        ],
      };
    }

    const parts = splitChunkInHalf(text);

    if (!parts) {
      return {
        matches: [],
        failures: [
          "LanguageTool svarade med HTTP 413 och textdelen kunde inte delas upp.",
        ],
      };
    }

    const [firstResult, secondResult] = await Promise.all([
      checkChunk(parts[0], language),
      checkChunk(parts[1], language),
    ]);

    return {
      matches: [
        ...firstResult.matches,
        ...secondResult.matches,
      ],
      failures: [
        ...firstResult.failures,
        ...secondResult.failures,
      ],
    };
  }

  if (!response.ok) {
    return {
      matches: [],
      failures: [
        `LanguageTool svarade med HTTP ${response.status}.`,
      ],
    };
  }

  try {
    const data: LanguageToolResponse = await response.json();

    if (!Array.isArray(data.matches)) {
      return {
        matches: [],
        failures: [
          "LanguageTool returnerade ett oväntat svar.",
        ],
      };
    }

    return {
      matches: data.matches,
      failures: [],
    };
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : String(error);

    return {
      matches: [],
      failures: [
        `Kunde inte läsa LanguageTools svar: ${reason}`,
      ],
    };
  }
}

// Hämtar exakt markerad text från LanguageTool.
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

// Hämtar högst tre stavningsförslag.
function getSuggestions(match: LanguageToolMatch): string[] {
  return (match.replacements ?? [])
    .slice(0, 3)
    .map((replacement) => replacement.value?.trim() ?? "")
    .filter((suggestion) => suggestion.length > 0);
}

// Normaliserar text för jämförelser.
function normalize(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("sv");
}

// Skapar en nyckel för att identifiera dubbletter.
function issueKey(issue: TextIssue): string {
  return [
    normalize(issue.matchedText),
    normalize(issue.message),
    normalize(issue.context),
    issue.pageUrl,
    issue.ruleId,
  ].join("|");
}

// Kontrollerar text och samlar alla LanguageTool-resultat.
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
        completed: true,
      };
    }

    // Normaliserar blanksteg utan att ta bort textinnehåll.
    const cleanedText = text
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+/g, " ")
      .trim();

    // Frekvensdata får inte dölja återkommande stavfel.
    void siteWordFrequency;

    // Dela upp sidan innan den skickas till LanguageTool.
    const chunks = splitText(cleanedText, MAX_CHUNK_LENGTH);

    console.log(
      `Kontrollerar ${pageUrl || "sidan"}: ` +
      `${cleanedText.length} tecken i ${chunks.length} textdel(ar).`
    );

    // Kontrollerar alla delar. Ett misslyckat anrop stoppar
    // inte kontrollen av sidans övriga delar.
    const results = await Promise.all(
      chunks.map((chunk) => checkChunk(chunk, language))
    );

    const allMatches = results.flatMap((result) => result.matches);
    const failures = results.flatMap((result) => result.failures);

    const issues: TextIssue[] = [];

    for (const match of allMatches) {
      const matchedText = getMatchedText(match).trim();

      if (!matchedText) {
        continue;
      }

      const normalizedText = normalize(matchedText);
      const context = match.context?.text ?? "";
      const message = match.message ?? "Okänt textfel";
      const ruleId = match.rule?.id ?? "UNKNOWN";
      const issueType = match.rule?.issueType ?? "unknown";

      // Hoppar över mycket korta träffar.
      if (normalizedText.length <= 2) {
        continue;
      }

      // Filtrerar tydliga tekniska identifierare.
      if (isTechnicalTerm(matchedText)) {
        continue;
      }

      // Filtrerar korta förkortningar med enbart versaler.
      if (/^[A-ZÅÄÖ]{2,6}$/.test(matchedText)) {
        continue;
      }

      // Behåller den befintliga första klassificeringen.
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

    // Tar bort identiska fynd från alla textdelar.
    const seen = new Set<string>();
    const uniqueIssues = issues.filter((issue) => {
      const key = issueKey(issue);

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });

    // Om någon del misslyckades får sidan inte markeras
    // som fullständigt kontrollerad. Fynd från lyckade delar
    // behålls så att de inte försvinner.
    if (failures.length > 0) {
      const failureReason = [...new Set(failures)].join(" ");

      console.warn(
        `⚠ Textkontrollen blev ofullständig för ${pageUrl || "sidan"}. ` +
        `${failures.length} tekniskt fel uppstod.`
      );

      return {
        errors: uniqueIssues.length,
        issues: uniqueIssues,
        status: "WARNING",
        completed: false,
        failureReason,
      };
    }

    if (uniqueIssues.length === 0) {
      console.log(
        `✓ Inga textfel hittades på ${pageUrl || "sidan"}.`
      );

      return {
        errors: 0,
        issues: [],
        status: "PASS",
        completed: true,
      };
    }

    console.log(
      `⚠ ${uniqueIssues.length} möjliga textfel hittades på ${
        pageUrl || "sidan"
      }.`
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
      completed: true,
    };
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : String(error);

    console.error(
      "⚠ Textkontrollen kunde inte genomföras:",
      reason
    );

    return {
      errors: 0,
      issues: [],
      status: "WARNING",
      completed: false,
      failureReason: reason,
    };
  }
}

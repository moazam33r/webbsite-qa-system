import { askOllama } from "./ollama";
import type { TextIssue } from "../checks/text-check";

export type AITextAssessment =
  | "LIKELY_SPELLING"
  | "LIKELY_CORRECT"
  | "REVIEW";

export interface ReviewedTextIssue extends TextIssue {
  aiAssessment: AITextAssessment;
  aiExplanation: string;
}

export type TextReviewFunction = (prompt: string) => Promise<string>;

const DEFAULT_EXPLANATION =
  "Träffen kunde inte verifieras och behöver vid behov granskas manuellt.";

const VALID_ASSESSMENTS: AITextAssessment[] = [
  "LIKELY_SPELLING",
  "LIKELY_CORRECT",
  "REVIEW",
];

const BATCH_SIZE = 1;
const MAX_ATTEMPTS = 2;

// Skyddar osäkra fynd från att uppgraderas till bekräftade stavfel.
export function applyAssessmentGuard(
  originalIssue: TextIssue,
  assessment: AITextAssessment,
  explanation: string
): { assessment: AITextAssessment; explanation: string } {
  if (
    originalIssue.classification === "REVIEW" &&
    assessment === "LIKELY_SPELLING"
  ) {
    return {
      assessment: "REVIEW",
      explanation:
        "LanguageTool bedömde träffen som osäker. " +
        "AI:n kan inte ensam bekräfta att ordet är felstavat.",
    };
  }

  return {
    assessment,
    explanation: explanation.slice(0, 300),
  };
}

// Tar bort interna resonemang och kodmarkeringar från AI-svaret.
function cleanAIResponse(response: string): string {
  return response
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```(?:json)?/gi, "")
    .trim();
}

interface ParsedAssessment {
  id: number;
  assessment: AITextAssessment;
  explanation: string;
}

interface ParsedAIResponse {
  results: ParsedAssessment[];
}

// Läser JSON och behåller endast bedömningar med rätt datatyper.
function parseAIResponse(
  response: string
): ParsedAssessment[] | null {
  const cleaned = cleanAIResponse(response);
  const jsonStart = cleaned.indexOf("{");
  const jsonEnd = cleaned.lastIndexOf("}");

  if (jsonStart === -1 || jsonEnd <= jsonStart) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(cleaned.slice(jsonStart, jsonEnd + 1));
  } catch {
    return null;
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("results" in parsed) ||
    !Array.isArray((parsed as ParsedAIResponse).results)
  ) {
    return null;
  }

  const validResults: ParsedAssessment[] = [];

  for (const item of (parsed as ParsedAIResponse).results) {
    if (typeof item !== "object" || item === null) {
      continue;
    }

    if (
      !("id" in item) ||
      !("assessment" in item) ||
      !("explanation" in item)
    ) {
      continue;
    }

    const { id, assessment, explanation } = item;

    if (
      typeof id !== "number" ||
      !Number.isInteger(id) ||
      id < 0 ||
      typeof assessment !== "string" ||
      !VALID_ASSESSMENTS.includes(assessment as AITextAssessment) ||
      typeof explanation !== "string"
    ) {
      continue;
    }

    validResults.push({
      id,
      assessment: assessment as AITextAssessment,
      explanation: explanation.slice(0, 300),
    });
  }

  return validResults;
}

// Skapar en prompt som betonar korrekt svenska och försiktiga bedömningar.
function createPrompt(
  candidates: Array<{
    id: number;
    ord: string;
    sammanhang: string;
    regel: string;
    typ: string;
    forslag: string[];
    sida: string;
    ursprungligBedomning: string;
  }>
): string {
  return `
Du är en noggrann svensk korrekturläsare.

Bedöm varje fynd utifrån ordet, sammanhanget och förslagen.
En markering från ett stavningsverktyg är inte ett bevis på stavfel.

Bedömningar:

LIKELY_SPELLING:
Använd endast när det finns tydliga belägg för ett verkligt stavfel.

LIKELY_CORRECT:
Använd när ordet är korrekt svenska eller korrekt i sammanhanget.

REVIEW:
Använd när det inte går att avgöra säkert.
VIKTIGA REGLER:

- Bedöm stavningen separat från om du förstår ordet eller meningen.
- Ett ord kan vara begripligt men ändå felstavat. Kontrollera därför ordets faktiska stavning.
- Använd LanguageTools förslag som ledtrådar, inte som bevis.
- Om originalordet är ett etablerat svenskt ord och passar sammanhanget, välj LIKELY_CORRECT.
- Svenska sammansättningar kan vara korrekta även om de är ovanliga.
- Facktermer inom SEO, webb, marknadsföring och IT kan vara korrekta. Kontrollera ordets uppbyggnad och sammanhang innan du bedömer det.
- Ord som indexerbarhet, sidupplevelse och söktermsanalys ska bedömas utifrån svensk språkbildning och sammanhang.
- Egennamn, ortnamn, företagsnamn och produktnamn ska inte ändras utan tydliga belägg. Om namnet inte kan verifieras, välj REVIEW.
- Engelska tekniska uttryck och identifierare kan vara korrekta i ett tekniskt sammanhang.
- Kontrollera särskilt om ett föreslaget alternativ faktiskt passar sammanhanget. Välj inte ett alternativ enbart för att LanguageTool föreslår det.
- Hitta inte på stavfel och hitta inte på fakta om ord eller namn.
- Välj LIKELY_SPELLING endast när ordet har tydliga stavningsfel och förslaget passar sammanhanget.
- Om stavningen verkar korrekt men du inte kan avgöra det säkert, välj REVIEW.
- Om ursprungligBedomning är REVIEW får du inte välja LIKELY_SPELLING.
- Returnera varje id exakt en gång.
- Förklaringen ska vara kort, saklig och på korrekt svenska.
- Förklaringen får innehålla högst 12 ord.

Returnera ENDAST giltig JSON utan markdown eller annan text.

Format:
{
  "results": [
    {
      "id": 0,
      "assessment": "LIKELY_CORRECT",
      "explanation": "Ordet är korrekt i sammanhanget."
    }
  ]
}

Fynd:
${JSON.stringify(candidates)}
`;
}

// Kontrollerar att svaret innehåller exakt ett giltigt resultat
// för varje förväntat id. Dubbletter godkänns inte.
async function reviewBatch(
  prompt: string,
  reviewWithAI: TextReviewFunction,
  batchNumber: number,
  expectedCount: number
): Promise<ParsedAssessment[]> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const retryPrompt = `
${prompt}

VIKTIGT:
Det föregående svaret var ogiltigt eller ofullständigt.
Returnera exakt ett resultat för varje id från 0 till ${
        expectedCount - 1
      }.
Alla id:n måste finnas med exakt en gång.
Använd endast tillåtna bedömningar.
Håll förklaringarna korta.
Skriv ingen text utanför JSON.
`;

      const response = await reviewWithAI(
        attempt === 1 ? prompt : retryPrompt
      );

      const results = parseAIResponse(response);

      if (results !== null) {
        const ids = results.map((item) => item.id);
        const uniqueIds = new Set(ids);

        const allIdsInRange = ids.every(
          (id) => id >= 0 && id < expectedCount
        );

        const allExpectedIdsPresent =
          uniqueIds.size === expectedCount &&
          Array.from(
            { length: expectedCount },
            (_, index) => index
          ).every((id) => uniqueIds.has(id));

        const exactlyOnePerId =
          results.length === expectedCount &&
          uniqueIds.size === results.length;

        if (
          allIdsInRange &&
          allExpectedIdsPresent &&
          exactlyOnePerId
        ) {
          return results;
        }

        console.warn(
          `AI-batch ${batchNumber}: ogiltiga eller dubblerade id:n. ` +
            `Försök ${attempt}/${MAX_ATTEMPTS}.`
        );
      } else {
        console.warn(
          `AI-batch ${batchNumber}: ogiltigt JSON-svar, ` +
            `försök ${attempt}/${MAX_ATTEMPTS}.`
        );
      }
    } catch (error) {
      console.error(
        `AI-batch ${batchNumber} misslyckades, ` +
          `försök ${attempt}/${MAX_ATTEMPTS}:`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  console.error(
    `AI-batch ${batchNumber} kunde inte granskas. ` +
      "Fynden behåller REVIEW."
  );

  return [];
}

// Granskar möjliga textfel med lokal AI.
export async function reviewTextIssues(
  issues: TextIssue[],
  reviewWithAI: TextReviewFunction = askOllama
): Promise<ReviewedTextIssue[]> {
  // Börja försiktigt: inga fynd bekräftas innan de har granskats.
  const reviewedIssues: ReviewedTextIssue[] = issues.map((issue) => ({
    ...issue,
    aiAssessment: "REVIEW",
    aiExplanation: DEFAULT_EXPLANATION,
  }));

  if (issues.length === 0) {
    return reviewedIssues;
  }

  for (
    let start = 0, batchNumber = 1;
    start < issues.length;
    start += BATCH_SIZE, batchNumber++
  ) {
    const batch = issues.slice(start, start + BATCH_SIZE);

    const candidates = batch.map((issue, index) => ({
      id: index,
      ord: issue.matchedText,
      sammanhang: issue.context,
      regel: issue.ruleId,
      typ: issue.issueType,
      forslag: issue.suggestions,
      sida: issue.pageUrl,
      ursprungligBedomning: issue.classification,
    }));

    const prompt = createPrompt(candidates);

    const results = await reviewBatch(
      prompt,
      reviewWithAI,
      batchNumber,
      batch.length
    );

    const processedIds = new Set<number>();

    for (const item of results) {
      if (
        item.id < 0 ||
        item.id >= batch.length ||
        processedIds.has(item.id)
      ) {
        continue;
      }

      processedIds.add(item.id);

      const originalIssue = batch[item.id];

      const guarded = applyAssessmentGuard(
        originalIssue,
        item.assessment,
        item.explanation
      );

      const targetIndex = start + item.id;

      reviewedIssues[targetIndex] = {
        ...reviewedIssues[targetIndex],
        aiAssessment: guarded.assessment,
        aiExplanation: guarded.explanation,
      };
    }

    const missingIds = batch
      .map((_, index) => index)
      .filter((id) => !processedIds.has(id));

    if (missingIds.length > 0) {
      console.warn(
        `AI-batch ${batchNumber} saknar bedömningar för id:`,
        missingIds
      );
    }
  }

  return reviewedIssues;
}
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

// Gör det möjligt att testa AI-granskningen utan att starta Ollama.
export type TextReviewFunction = (prompt: string) => Promise<string>;

const DEFAULT_EXPLANATION =
  "Träffen kunde inte verifieras och behöver vid behov granskas manuellt.";

const VALID_ASSESSMENTS: AITextAssessment[] = [
  "LIKELY_SPELLING",
  "LIKELY_CORRECT",
  "REVIEW",
];

// Mindre batchar minskar risken att Ollama kapar JSON-svaret.
const BATCH_SIZE = 4;

// Försök igen om AI:n returnerar ett ofullständigt eller ogiltigt svar.
const MAX_ATTEMPTS = 2;

// AI:n får inte ensam uppgradera en osäker träff till ett bekräftat stavfel.
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

// Försöker läsa en fullständig JSON-struktur från AI-svaret.
function parseAIResponse(response: string): ParsedAssessment[] | null {
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

// Skapar en kortare prompt som minskar risken för kapade svar.
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

Granska varje fynd separat utifrån ordet och sammanhanget.

Välj en bedömning per id:

LIKELY_SPELLING:
Tydliga belägg för ett verkligt stavfel.

LIKELY_CORRECT:
Ordet är korrekt i sammanhanget, exempelvis ett fackord,
ett sammansatt ord, ett gatunamn eller en teknisk identifierare.

REVIEW:
Det går inte att avgöra säkert.

REGLER:
- LanguageTools markering bevisar inte att ordet är fel.
- LanguageTools förslag kan vara felaktiga.
- Svenska sammansättningar och fackord kan vara korrekta.
- Gatunamn och andra egennamn ska inte ändras utan belägg.
- WordPress-cookienamn och tekniska identifierare ska bedömas
  som tekniska uttryck när sammanhanget visar det.
- Om ordet passar i sammanhanget, välj LIKELY_CORRECT.
- Om du är osäker, välj REVIEW.
- Bedöm inte samma id mer än en gång.
- Om ursprungligBedomning är REVIEW får du inte välja LIKELY_SPELLING.
- Hitta inte på information som saknas.

Skriv en förklaring på svenska med högst 12 ord.

Returnera ett resultat för varje id.
Skriv ENDAST giltig JSON, utan markdown eller annan text.

Format:
{
  "results": [
    {
      "id": 0,
      "assessment": "LIKELY_CORRECT",
      "explanation": "Ordet passar i sammanhanget."
    }
  ]
}

Fynd:
${JSON.stringify(candidates)}
`;
}

// Granskar en batch och försöker igen om svaret är ogiltigt
// eller saknar en eller flera förväntade bedömningar.
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

VIKTIGT: Föregående svar var ogiltigt eller ofullständigt.
Returnera exakt ett resultat för varje id i fynden.
Alla id:n måste finnas med, utan dubbletter.
Håll varje förklaring mycket kort.
Skriv ingen text utanför JSON.
`;

      const response = await reviewWithAI(
        attempt === 1 ? prompt : retryPrompt
      );

      const results = parseAIResponse(response);

      if (results !== null) {
        const validIds = new Set(
          results
            .filter(
              (item) =>
                item.id >= 0 &&
                item.id < expectedCount
            )
            .map((item) => item.id)
        );

        if (validIds.size === expectedCount) {
          return results;
        }

        console.warn(
          `AI-batch ${batchNumber}: fick ${validIds.size} av ` +
            `${expectedCount} förväntade bedömningar, ` +
            `försök ${attempt}/${MAX_ATTEMPTS}.`
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
  // Alla fynd börjar säkert som REVIEW.
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


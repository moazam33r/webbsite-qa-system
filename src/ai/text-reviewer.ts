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

// Funktionstyp för AI-granskningen.
// Gör det möjligt att simulera AI-svar i tester utan att starta Ollama.
export type TextReviewFunction = (prompt: string) => Promise<string>;

const DEFAULT_EXPLANATION =
  "Träffen kunde inte verifieras och behöver vid behov granskas manuellt.";

// Kontrollerar AI:s bedömning mot LanguageTools ursprungliga klassificering.
export function applyAssessmentGuard(
  originalIssue: TextIssue,
  assessment: AITextAssessment,
  explanation: string
): { assessment: AITextAssessment; explanation: string } {
  // AI får inte uppgradera en osäker träff till ett bekräftat stavfel.
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
    explanation: explanation.slice(0, 500),
  };
}

// Granskar möjliga stavfel från LanguageTool med lokal AI.
// En alternativ granskningsfunktion kan skickas in vid testning.
export async function reviewTextIssues(
  issues: TextIssue[],
  reviewWithAI: TextReviewFunction = askOllama
): Promise<ReviewedTextIssue[]> {
  const reviewIssues: ReviewedTextIssue[] = issues.map((issue) => ({
    ...issue,
    aiAssessment: "REVIEW",
    aiExplanation: DEFAULT_EXPLANATION,
  }));

  if (issues.length === 0) {
    return reviewIssues;
  }

  const batchSize = 10;

  for (let start = 0; start < issues.length; start += batchSize) {
    const batch = issues.slice(start, start + batchSize);

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

    const prompt = `
Du är en erfaren svensk korrekturläsare som granskar möjliga
stavfel på svenska webbplatser.

Granska varje fynd separat och använd hela sammanhanget.

Välj exakt en bedömning:

LIKELY_SPELLING:
Använd endast när det finns tydliga belägg för ett verkligt
stavfel och en rimlig rättelse som passar sammanhanget.

LIKELY_CORRECT:
Använd när ordet är korrekt och passar sammanhanget.

REVIEW:
Använd när du inte kan avgöra frågan med tillräcklig säkerhet.

VIKTIGA REGLER:
1. LanguageTools markering bevisar inte att ordet är fel.
2. Förslag från LanguageTool kan vara felaktiga.
3. Svenska sammansättningar kan vara långa och ovanliga.
4. Fackord och tekniska ord kan vara korrekta även om de är ovanliga.
5. Böjningsformer och genitivformer kan vara korrekta.
6. Ersätt inte ett ord med ett förslag som har en annan betydelse.
7. Hitta inte på rättelser.
8. Om ordet fungerar i sammanhanget ska det inte klassificeras
   som stavfel bara för att ett annat ord föreslås.
9. Bedöm varje förekomst separat.
10. Om du är osäker ska du välja REVIEW.

VIKTIG BEGRÄNSNING:
Fältet ursprungligBedomning visar LanguageTools första bedömning.

Om ursprungligBedomning är REVIEW får du inte välja
LIKELY_SPELLING. Du får endast välja LIKELY_CORRECT eller REVIEW.

Om ursprungligBedomning är LIKELY_SPELLING ska du kontrollera
om träffen verkligen verkar vara ett stavfel.

Returnera exakt ett resultat för varje id.
Behåll samma id och returnera endast giltig JSON.

Format:
{
  "results": [
    {
      "id": 0,
      "assessment": "REVIEW",
      "explanation": "Ordet behöver bedömas utifrån sammanhanget."
    }
  ]
}

Fynd att granska:
${JSON.stringify(candidates)}
`;

    try {
      const response = await reviewWithAI(prompt);
      console.log("RÅTT SVAR FRÅN AI:", response);

      // Tar bort eventuella interna resonemang och kodmarkeringar.
      const cleaned = response
        .replace(/<think>[\s\S]*?<\/think>/gi, "")
        .replace(/```(?:json)?/gi, "")
        .trim();

      const jsonStart = cleaned.indexOf("{");
      const jsonEnd = cleaned.lastIndexOf("}");

      if (jsonStart === -1 || jsonEnd <= jsonStart) {
        console.error("AI RETURNERADE INGEN GILTIG JSON:", cleaned);
        continue;
      }

      let parsed: unknown;

      try {
        parsed = JSON.parse(cleaned.slice(jsonStart, jsonEnd + 1));
      } catch (error) {
        console.error(
          "KUNDE INTE LÄSA AI-SVARETS JSON:",
          error instanceof Error ? error.message : String(error)
        );
        continue;
      }

      if (
        typeof parsed !== "object" ||
        parsed === null ||
        !("results" in parsed) ||
        !Array.isArray(parsed.results)
      ) {
        console.error("AI-SVARET SAKNAR EN GILTIG results-LISTA.");
        continue;
      }

      const processedIds = new Set<number>();

      for (const item of parsed.results) {
        if (
          typeof item !== "object" ||
          item === null ||
          !("id" in item) ||
          !("assessment" in item) ||
          !("explanation" in item)
        ) {
          continue;
        }

        const id = item.id;
        const assessment = item.assessment;
        const explanation = item.explanation;

        if (
          typeof id !== "number" ||
          !Number.isInteger(id) ||
          id < 0 ||
          id >= batch.length ||
          processedIds.has(id) ||
          typeof explanation !== "string" ||
          ![
            "LIKELY_SPELLING",
            "LIKELY_CORRECT",
            "REVIEW",
          ].includes(String(assessment))
        ) {
          continue;
        }

        processedIds.add(id);

        const originalIssue = batch[id];

        const guarded = applyAssessmentGuard(
          originalIssue,
          assessment as AITextAssessment,
          explanation
        );

        const targetIndex = start + id;

        reviewIssues[targetIndex] = {
          ...reviewIssues[targetIndex],
          aiAssessment: guarded.assessment,
          aiExplanation: guarded.explanation,
        };
      }

      const missingIds = batch
        .map((_, index) => index)
        .filter((id) => !processedIds.has(id));

      if (missingIds.length > 0) {
        console.warn(
          "AI SAKNADE GILTIGA BEDÖMNINGAR FÖR ID:",
          missingIds
        );
      }
    } catch (error) {
      console.error(
        "AI-GRANSKNING MISSLYCKADES:",
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  return reviewIssues;
}
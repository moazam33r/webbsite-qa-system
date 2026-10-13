import { test, expect } from "@playwright/test";
import {
  applyAssessmentGuard,
  reviewTextIssues,
  type TextReviewFunction,
} from "../src/ai/text-reviewer";
import type { TextIssue } from "../src/checks/text-check";

// Skapar en LanguageTool-träff för testning.
function createIssue(
  matchedText: string,
  classification: TextIssue["classification"] = "REVIEW"
): TextIssue {
  return {
    message: "Möjligt stavfel",
    suggestions: ["alternativt ord"],
    context: `Vi arbetar med ${matchedText} på webbplatsen.`,
    matchedText,
    pageUrl: "https://example.com/test",
    ruleId: "SPELLING",
    issueType: "misspelling",
    classification,
  };
}

// Skapar en simulerad AI-funktion som returnerar ett bestämt svar.
function mockAI(response: string): TextReviewFunction {
  return async () => response;
}

function createAIResponse(
  assessment: string,
  explanation: string
): string {
  return JSON.stringify({
    results: [
      {
        id: 0,
        assessment,
        explanation,
      },
    ],
  });
}

test("AI kan inte uppgradera putsarbete från REVIEW till stavfel", async () => {
  const result = await reviewTextIssues(
    [createIssue("putsarbete", "REVIEW")],
    mockAI(
      createAIResponse(
        "LIKELY_SPELLING",
        "Ordet bör ersättas med uppsatsarbete."
      )
    )
  );

  expect(result[0].aiAssessment).toBe("REVIEW");
  expect(result[0].aiExplanation).toContain(
    "kan inte ensam bekräfta"
  );
});

test("AI kan inte uppgradera foglinjer från REVIEW till stavfel", async () => {
  const result = await reviewTextIssues(
    [createIssue("foglinjer", "REVIEW")],
    mockAI(
      createAIResponse(
        "LIKELY_SPELLING",
        "Ordet bör ersättas med flyglinjer."
      )
    )
  );

  expect(result[0].aiAssessment).toBe("REVIEW");
  expect(result[0].aiExplanation).toContain(
    "kan inte ensam bekräfta"
  );
});

test("AI kan bekräfta ett stavfel som LanguageTool redan identifierat", async () => {
  const issue: TextIssue = {
    ...createIssue("stavnig", "LIKELY_SPELLING"),
    suggestions: ["stavning"],
    context: "Vi kontrollerar stavnig på webbplatsen.",
  };

  const result = await reviewTextIssues(
    [issue],
    mockAI(
      createAIResponse(
        "LIKELY_SPELLING",
        "Stavnig verkar vara felstavat. Stavning passar sammanhanget."
      )
    )
  );

  expect(result[0].aiAssessment).toBe("LIKELY_SPELLING");
});

test("AI kan bedöma en osäker träff som korrekt", async () => {
  const result = await reviewTextIssues(
    [createIssue("administrationsdelen", "REVIEW")],
    mockAI(
      createAIResponse(
        "LIKELY_CORRECT",
        "Ordet passar sammanhanget."
      )
    )
  );

  expect(result[0].aiAssessment).toBe("LIKELY_CORRECT");
});

test("Ogiltig JSON lämnar träffen som REVIEW", async () => {
  const result = await reviewTextIssues(
    [createIssue("foglinjer", "REVIEW")],
    mockAI("Detta är inte giltig JSON.")
  );

  expect(result[0].aiAssessment).toBe("REVIEW");
});

test("Ett saknat AI-resultat lämnar träffen som REVIEW", async () => {
  const result = await reviewTextIssues(
    [createIssue("putsarbete", "REVIEW")],
    mockAI(JSON.stringify({ results: [] }))
  );

  expect(result[0].aiAssessment).toBe("REVIEW");
});

test("Tom lista ger tomt resultat utan att anropa AI", async () => {
  let aiCalled = false;

  const fakeAI: TextReviewFunction = async () => {
    aiCalled = true;
    return "";
  };

  const result = await reviewTextIssues([], fakeAI);

  expect(result).toEqual([]);
  expect(aiCalled).toBe(false);
});

test("Skyddsregeln behåller REVIEW när AI föreslår ett stavfel", () => {
  const result = applyAssessmentGuard(
    createIssue("putsarbete", "REVIEW"),
    "LIKELY_SPELLING",
    "Ordet verkar felstavat."
  );

  expect(result.assessment).toBe("REVIEW");
  expect(result.explanation).toContain(
    "kan inte ensam bekräfta"
  );
});
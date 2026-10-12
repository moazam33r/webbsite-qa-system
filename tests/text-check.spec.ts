
import { test, expect } from "@playwright/test";
import { checkText } from "../src/checks/text-check";

// Kör testerna separat eftersom de ändrar global fetch.
test.describe.configure({ mode: "serial" });

// Simulerar ett svar från LanguageTool.
function mockLanguageTool(matches: unknown[]) {
  globalThis.fetch = async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({ matches }),
    }) as Response;
}

// Skapar en simulerad LanguageTool-träff.
function createMatch(options: {
  text: string;
  matchedText: string;
  message?: string;
  suggestion?: string;
  offset?: number;
}) {
  const offset =
    options.offset ??
    options.text.indexOf(options.matchedText);

  return {
    message: options.message ?? "Möjligt stavfel",
    context: {
      text: options.text,
      offset,
      length: options.matchedText.length,
    },
    replacements: options.suggestion
      ? [{ value: options.suggestion }]
      : [],
    rule: {
      id: "SPELLING",
      issueType: "misspelling",
    },
  };
}

test("Textkontroll hittar ett riktigt stavfel", async () => {
  const originalFetch = globalThis.fetch;
  const testText = "Detta är en stavnig.";

  mockLanguageTool([
    createMatch({
      text: testText,
      matchedText: "stavnig",
      suggestion: "stavning",
    }),
  ]);

  try {
    const result = await checkText(
      testText,
      "sv",
      "https://example.com/"
    );

    expect(result.errors).toBe(1);
    expect(result.status).toBe("WARNING");
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].matchedText).toBe("stavnig");
    expect(result.issues[0].suggestions).toContain(
      "stavning"
    );
    expect(result.issues[0].pageUrl).toBe(
      "https://example.com/"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Textkontroll godkänner text när LanguageTool inte hittar fel", async () => {
  const originalFetch = globalThis.fetch;

  mockLanguageTool([]);

  try {
    const result = await checkText(
      "Våra tjänster hjälper företag att utvecklas."
    );

    expect(result.errors).toBe(0);
    expect(result.status).toBe("PASS");
    expect(result.issues).toHaveLength(0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Upprepade ord i H1 och H2 skapar inte stavfel utan en LanguageTool-träff", async () => {
  const originalFetch = globalThis.fetch;

  mockLanguageTool([]);

  try {
    const pageText = [
      "Våra tjänster",
      "Våra tjänster för företag",
      "Vi erbjuder flera tjänster.",
    ].join("\n");

    const result = await checkText(pageText);

    expect(result.errors).toBe(0);
    expect(result.issues).toHaveLength(0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Ett stavfel som börjar med stor bokstav filtreras inte automatiskt bort", async () => {
  const originalFetch = globalThis.fetch;

  mockLanguageTool([
    createMatch({
      text: "Stavnig förekommer i texten.",
      matchedText: "Stavnig",
      suggestion: "Stavning",
    }),
  ]);

  try {
    const result = await checkText(
      "Stavnig förekommer i texten."
    );

    expect(result.errors).toBe(1);
    expect(result.issues[0].matchedText).toBe("Stavnig");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Ett orelaterat tekniskt ord i sammanhanget döljer inte ett stavfel", async () => {
  const originalFetch = globalThis.fetch;

  mockLanguageTool([
    createMatch({
      text: "Vi arbetar med SEO och stavnig på webbplatsen.",
      matchedText: "stavnig",
      suggestion: "stavning",
    }),
  ]);

  try {
    const result = await checkText(
      "Vi arbetar med SEO och stavnig på webbplatsen."
    );

    expect(result.errors).toBe(1);
    expect(result.issues[0].matchedText).toBe("stavnig");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("En återkommande felstavning filtreras inte bort automatiskt", async () => {
  const originalFetch = globalThis.fetch;

  mockLanguageTool([
    createMatch({
      text: "Vi erbjuder stavnig och språkgranskning.",
      matchedText: "stavnig",
      suggestion: "stavning",
    }),
  ]);

  try {
    const frequency = new Map<string, number>([
      ["stavnig", 5],
    ]);

    const result = await checkText(
      "Vi erbjuder stavnig och språkgranskning.",
      "sv",
      "https://example.com/tjanster",
      frequency
    );

    expect(result.errors).toBe(1);
    expect(result.issues[0].matchedText).toBe("stavnig");
    expect(result.issues[0].suggestions).toContain(
      "stavning"
    );
    expect(result.issues[0].pageUrl).toBe(
      "https://example.com/tjanster"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
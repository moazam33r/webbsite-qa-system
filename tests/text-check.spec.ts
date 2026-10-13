
import { test, expect } from "@playwright/test";
import { checkText } from "../src/checks/text-check";

// Tester ändrar global fetch och körs därför i serie.
test.describe.configure({ mode: "serial" });

function mockLanguageTool(matches: unknown[]) {
  globalThis.fetch = async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({ matches }),
    }) as Response;
}

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

test("Hittar ett stavfel och visar förslag och sidans URL", async () => {
  const originalFetch = globalThis.fetch;

  mockLanguageTool([
    createMatch({
      text: "Detta är en stavnig.",
      matchedText: "stavnig",
      suggestion: "stavning",
    }),
  ]);

  try {
    const result = await checkText(
      "Detta är en stavnig.",
      "sv",
      "https://example.com/"
    );

    expect(result.errors).toBe(1);
    expect(result.status).toBe("WARNING");
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].matchedText).toBe("stavnig");
    expect(result.issues[0].suggestions).toContain("stavning");
    expect(result.issues[0].pageUrl).toBe("https://example.com/");
    expect(result.issues[0].context).toContain("stavnig");
    expect(result.issues[0].message).toBe("Möjligt stavfel");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Godkänner text när LanguageTool inte hittar några fel", async () => {
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

test("Upprepade rubriker skapar inte egna stavfel utan träffar", async () => {
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

test("Hittar stavfel som börjar med stor bokstav", async () => {
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
    expect(result.issues[0].suggestions).toContain("Stavning");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Ett orelaterat tekniskt ord döljer inte ett stavfel", async () => {
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
    expect(result.issues[0].suggestions).toContain("stavning");
    expect(result.issues[0].pageUrl).toBe(
      "https://example.com/tjanster"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Hämtar rätt förekomst när samma ord förekommer flera gånger", async () => {
  const originalFetch = globalThis.fetch;
  const text = "Stavnig är fel. Rätt stavning är viktigt.";

  mockLanguageTool([
    createMatch({
      text,
      matchedText: "Stavnig",
      suggestion: "Stavning",
      offset: 0,
    }),
  ]);

  try {
    const result = await checkText(text);

    expect(result.errors).toBe(1);
    expect(result.issues[0].matchedText).toBe("Stavnig");
    expect(result.issues[0].context).toContain(
      "Stavnig är fel"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Tar bort identiska träffar på samma sida", async () => {
  const originalFetch = globalThis.fetch;
  const text = "Detta är en stavnig.";

  const match = createMatch({
    text,
    matchedText: "stavnig",
    suggestion: "stavning",
  });

  mockLanguageTool([match, match]);

  try {
    const result = await checkText(
      text,
      "sv",
      "https://example.com/"
    );

    expect(result.errors).toBe(1);
    expect(result.issues).toHaveLength(1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Ignorerar en träff med ogiltigt sammanhang", async () => {
  const originalFetch = globalThis.fetch;

  mockLanguageTool([
    {
      message: "Möjligt stavfel",
      context: {
        text: "Detta är en stavnig.",
        offset: 100,
        length: 7,
      },
      replacements: [{ value: "stavning" }],
    },
  ]);

  try {
    const result = await checkText("Detta är en stavnig.");

    expect(result.errors).toBe(0);
    expect(result.issues).toHaveLength(0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Returnerar WARNING om LanguageTool svarar med HTTP-fel", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    ({
      ok: false,
      status: 503,
      json: async () => ({}),
    }) as Response;

  try {
    const result = await checkText(
      "Detta är en text.",
      "sv",
      "https://example.com/"
    );

    expect(result.status).toBe("WARNING");
    expect(result.errors).toBe(0);
    expect(result.issues).toHaveLength(0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Returnerar WARNING om LanguageTool ger ett oväntat svar", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({ unexpected: true }),
    }) as Response;

  try {
    const result = await checkText("Detta är en text.");

    expect(result.status).toBe("WARNING");
    expect(result.errors).toBe(0);
    expect(result.issues).toHaveLength(0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Returnerar WARNING om API-anropet kastar ett fel", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => {
    throw new Error("Nätverksfel");
  };

  try {
    const result = await checkText("Detta är en text.");

    expect(result.status).toBe("WARNING");
    expect(result.errors).toBe(0);
    expect(result.issues).toHaveLength(0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Tom text kräver inget API-anrop", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => {
    throw new Error("Fetch ska inte anropas för tom text");
  };

  try {
    const result = await checkText("   \n  ");

    expect(result.status).toBe("PASS");
    expect(result.errors).toBe(0);
    expect(result.issues).toHaveLength(0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test.describe("Svenska fackord och sammansatta ord", () => {
  const originalFetch = globalThis.fetch;

  test.afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const examples = [
    {
      word: "putsarbete",
      text: "Ta bilder när du frågar om ett putsarbete.",
    },
    {
      word: "foglinjer",
      text: "Kontrollera att skärningar och foglinjer fungerar.",
    },
    {
      word: "administrationsdelen",
      text: "Användaren öppnar administrationsdelen.",
    },
    {
      word: "administrationsvyns",
      text: "Cookien sparar administrationsvyns inställningar.",
    },
  ];

  for (const example of examples) {
    test(`Bevarar LanguageTool-träffen för ${example.word}`, async () => {
      mockLanguageTool([
        createMatch({
          text: example.text,
          matchedText: example.word,
          suggestion: "alternativt ord",
        }),
      ]);

      const result = await checkText(
        example.text,
        "sv",
        "https://example.com/test"
      );

      expect(result.issues[0].matchedText).toBe(example.word);
      expect(result.issues[0].pageUrl).toBe(
        "https://example.com/test"
      );
    });
  }
});
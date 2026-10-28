import { test, expect } from "@playwright/test";
import { checkDomains } from "../src/checks/domains";

// Testar kontrollen av alternativa domänvarianter
// utan att vara beroende av en riktig webbplats.
test("Alternativa domäner kontroll", async () => {

  // Sparar den riktiga fetch-funktionen så att den kan återställas efter testet.
  const originalFetch = globalThis.fetch;

  // Simulerar att alla fyra domänvarianter fungerar.
  globalThis.fetch = async (input) => {

    // Gör om URL:en till text.
    const requestedUrl = String(input);

    // Simulerar ett lyckat HTTP-svar.
    return {
      status: 200,
      url: requestedUrl,
    } as Response;
  };

  try {

    // Kör kontrollen mot en testdomän.
    const result = await checkDomains(
      "https://example.com"
    );

    // Kontrollerar att fyra domänvarianter testas.
    expect(result.results).toHaveLength(4);

    // Alla fyra ska fungera i vårt simulerade test.
    expect(result.passed).toBe(4);
    expect(result.failed).toBe(0);

    // Totalresultatet ska vara PASS.
    expect(result.status).toBe("PASS");

    // Kontrollerar att alla resultat innehåller rätt information.
    for (const domainResult of result.results) {

      expect(domainResult).toHaveProperty("url");
      expect(domainResult).toHaveProperty("status");
      expect(domainResult).toHaveProperty("finalUrl");
      expect(domainResult).toHaveProperty("working");

      expect(domainResult.status).toBe(200);
      expect(domainResult.working).toBe(true);
    }

  } finally {

    // Återställer den riktiga fetch-funktionen efter testet.
    globalThis.fetch = originalFetch;
  }
});

// En testadress hos webbhotell har inga egna domänvarianter, så en
// saknad www-adress ska inte bli en varning.
test("Testadress hos webbhotell hoppas över", async () => {

  const originalFetch = globalThis.fetch;

  let calls = 0;

  globalThis.fetch = async () => {
    calls++;
    throw new Error("ska inte anropas");
  };

  try {

    const result = await checkDomains(
      "https://kund-hantverk.sg-host.com/"
    );

    expect(result.skipped).toBe(true);
    expect(result.status).toBe("PASS");
    expect(result.failed).toBe(0);
    expect(calls).toBe(0);

  } finally {
    globalThis.fetch = originalFetch;
  }
});
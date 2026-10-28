import { askOllama } from "./ollama";
// Hämtar typen för QA-resultat från rapport-mappen.
// Hämtar typen för QA-resultat från report-mappen.
import { QACheckResult } from "../report/qa-report";

// Analyserar resultaten från QA-skanningen med AI.
export async function analyzeQAResults(
  results: QACheckResult[]
): Promise<string> {

  // Samlar alla PASS-resultat.
  const passed = results
    .filter((result) => result.status === "PASS")
    .map((result) => `- ${result.name}: ${result.message}`);

  // Samlar alla WARNING-resultat.
  const warnings = results
    .filter((result) => result.status === "WARNING")
    .map((result) => `- ${result.name}: ${result.message}`);

  // Samlar alla FAIL-resultat.
  const failures = results
    .filter((result) => result.status === "FAIL")
    .map((result) => `- ${result.name}: ${result.message}`);

  // Räknar resultaten.
  const passCount = passed.length;
  const warningCount = warnings.length;
  const failCount = failures.length;

  // Skapar en lista med alla resultat som AI:n får analysera.
  const allResults = results
    .map(
      (result) =>
        `${result.status} | ${result.name} | ${result.message}`
    )
    .join("\n");

  // Skickar både sammanfattningen och de detaljerade resultaten till AI:n.
  const prompt = `
Du är en QA-analytiker.

Analysera följande resultat från ett automatiserat QA-system för en webbplats.

VIKTIGA REGLER:
- Skriv endast på svenska.
- Skriv aldrig din interna tankeprocess.
- Skriv aldrig på engelska.
- Hitta aldrig på siffror, URL:er eller problem.
- Använd endast information som finns i resultaten nedan.
- Använd konkreta siffror när de finns.
- Om ett WARNING-resultat innehåller specifika URL:er eller detaljer ska dessa nämnas.
- För SEO ska du nämna de konkreta SEO-problemen, inte bara skriva "SEO-varningar".
- Rekommendationerna ska vara direkt kopplade till de identifierade problemen.
- Om det inte finns FAIL-resultat ska du tydligt skriva det.
- Prestanda kan kommenteras som en observation även om kontrollen är PASS.
- Använd exakt dessa fyra rubriker.

1. Vad fungerar bra

Beskriv de viktigaste fungerande delarna.
Använd konkreta siffror.

2. Viktigaste problemen

Lista alla WARNING och FAIL-resultat.
För SEO ska du ta med de konkreta problemen och berörda sidor när informationen finns.

3. Vad resultaten visar

Sammanfatta helhetsresultatet med antal PASS, WARNING och FAIL.

4. Rekommendationer

Ge konkreta rekommendationer baserat på problemen.
Ge även en rekommendation för prestanda om mobil eller desktop har ett lägre resultat än 90/100 (målet är 90 eller högre; ställ inga krav på 100).

PASS:
${passed.join("\n")}

WARNING:
${warnings.join("\n")}

FAIL:
${failures.join("\n")}

DETALJERADE RESULTAT:
${allResults}
`;

  try {
    // Anropar den lokala Ollama-modellen.
    const response = await askOllama(prompt);

    // Tar bort eventuell <think>-text från Qwen.
    let cleanedResponse = response
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .trim();

    // Kontrollerar att AI:n använder rätt struktur.
    const hasCorrectStructure =
      cleanedResponse.includes("1. Vad fungerar bra") &&
      cleanedResponse.includes("2. Viktigaste problemen") &&
      cleanedResponse.includes("3. Vad resultaten visar") &&
      cleanedResponse.includes("4. Rekommendationer");

    // Kontrollerar om AI:n råkat skriva intern reasoning på engelska.
    const containsReasoning =
      /\b(let's|let us|we need to|I need to|I think|analyze|analysis|reasoning)\b/i.test(
        cleanedResponse
      );

    // Kontrollerar om AI:n börjar svara på engelska.
    const containsEnglish =
      /\b(the|this|website|results|problem|recommendation|validation)\b/i.test(
        cleanedResponse
      );

    // Om AI-svaret är användbart returneras det direkt.
    if (
      cleanedResponse &&
      hasCorrectStructure &&
      !containsReasoning &&
      !containsEnglish
    ) {
      return cleanedResponse;
    }

    // Om AI:n ger ett dåligt svar används en svensk fallback.
    return createFallbackAnalysis(
      results,
      passCount,
      warningCount,
      failCount
    );
  } catch (error) {
    // Om AI-anropet misslyckas används fallback-analysen.
    console.log("AI-analys kunde inte genomföras:", error);

    return createFallbackAnalysis(
      results,
      passCount,
      warningCount,
      failCount
    );
  }
}


// Skapar en svensk fallback om AI:n inte ger ett användbart svar.
function createFallbackAnalysis(
  results: QACheckResult[],
  passCount: number,
  warningCount: number,
  failCount: number
): string {

  // Hämtar alla PASS-resultat.
  const passed = results.filter(
    (result) => result.status === "PASS"
  );

  // Hämtar alla WARNING-resultat.
  const warnings = results.filter(
    (result) => result.status === "WARNING"
  );

  // Hämtar alla FAIL-resultat.
  const failures = results.filter(
    (result) => result.status === "FAIL"
  );

  // Bygger listan över fungerande kontroller.
  const workingText = passed
    .map(
      (result) =>
        `- ${result.name}: ${result.message}`
    )
    .join("\n");

  // Bygger listan över problem.
  const problemText = [
    ...warnings,
    ...failures,
  ]
    .map(
      (result) =>
        `- ${result.name}: ${result.message}`
    )
    .join("\n");

  // Letar efter SEO-resultatet.
  const seoResult = results.find(
    (result) => result.name.toLowerCase() === "seo"
  );

  // Letar efter prestandaresultatet.
  const performanceResult = results.find(
    (result) => result.name.toLowerCase() === "prestanda"
  );

  // Letar efter valideringsresultatet.
  const validationResult = results.find(
    (result) => result.name.toLowerCase() === "validering"
  );

  // Skapar rekommendationer.
  const recommendations: string[] = [];

  // Rekommendation för SEO.
  // Visas bara om SEO-kontrollen faktiskt hittade något.
  // Texten pekar på de riktiga fynden i stället för att
  // gissa vilka problem det gäller.
  if (
    seoResult &&
    seoResult.status !== "PASS"
  ) {
    recommendations.push(
      "- Åtgärda de SEO-problem som listas under Viktigaste problemen."
    );
  }

  // Rekommendation för validering.
  // Visas bara om valideringskontrollen hittade något.
  if (
    validationResult &&
    validationResult.status !== "PASS"
  ) {
    recommendations.push(
      "- Förbättra valideringen av telefonnummer i de berörda formulären så att ogiltiga nummer stoppas innan formuläret skickas."
    );
  }

  // Rekommendation för prestanda.
  if (performanceResult) {
    recommendations.push(
      "- Kontrollera mobilprestandan och optimera sidan om mobilresultatet ligger under målet 90/100."
    );
  }

  // Om inga specifika rekommendationer skapades används en generell rekommendation.
  if (recommendations.length === 0) {
    recommendations.push(
      "- Fortsätt följa upp framtida WARNING- och FAIL-resultat."
    );
  }

  // Returnerar fallback-analysen med exakt fyra sektioner.
  return `
1. Vad fungerar bra

${workingText}

2. Viktigaste problemen

${problemText || "- Inga problem hittades."}

3. Vad resultaten visar

- QA-systemet genomförde ${results.length} kontroller.
- ${passCount} fick PASS, ${warningCount} fick WARNING och ${failCount} fick FAIL.

4. Rekommendationer

${recommendations.join("\n")}
`.trim();
}
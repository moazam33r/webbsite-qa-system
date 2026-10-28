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



// Kortar ett resultat till sin sammanfattning (första stycket), så att
// långa detaljlistor inte fyller reservanalysen.
function summarizeMessage(message: string): string {
  const first = (message ?? "")
    .split(/\n\s*\n/)[0]
    .replace(/\s+/g, " ")
    .trim();

  return first.length > 220 ? first.substring(0, 217) + "..." : first;
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
        `- ${result.name}: ${summarizeMessage(result.message)}`
    )
    .join("\n");

  // Bygger listan över problem.
  const problemText = [
    ...warnings,
    ...failures,
  ]
    .map(
      (result) =>
        `- ${result.name}: ${summarizeMessage(result.message)}`
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

  // Letar efter övriga resultat som kan ge rekommendationer.
  const find = (pattern: RegExp) =>
    results.find((result) => pattern.test(result.name));

  const phoneResult = find(/telefonvalidering/i);
  const emailResult = find(/e-postvalidering/i);
  const ctaResult = find(/^cta$/i);
  const navigationResult = find(/^navigation$/i);
  const socialResult = find(/sociala medier/i);
  const mapsResult = find(/google maps|google business/i);

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

  // Rekommendation för telefonvalidering.
  if (phoneResult && phoneResult.status !== "PASS") {
    recommendations.push(
      /SAKNAR VALIDERING/i.test(phoneResult.message) &&
        !/UNDERKÄNDA KONTROLLER/i.test(phoneResult.message)
        ? "- Överväg att lägga till validering av telefonnummer i de valfria telefonfälten (låg prioritet)."
        : "- Förbättra valideringen av telefonnummer i de berörda formulären så att ogiltiga nummer stoppas innan formuläret skickas."
    );
  }

  if (emailResult && emailResult.status !== "PASS") {
    recommendations.push(
      "- Förbättra valideringen av e-postadresser i de berörda formulären."
    );
  }

  // Rekommendation för länkar och knappar som inte kunde verifieras.
  const unverifiedChecks = [ctaResult, navigationResult]
    .filter(
      (result) =>
        result &&
        result.status !== "PASS" &&
        /kunde inte verifieras/i.test(result.message)
    )
    .map((result) => result!.name);

  if (unverifiedChecks.length > 0) {
    recommendations.push(
      `- Kontrollera manuellt de länkar som inte kunde verifieras automatiskt (${unverifiedChecks.join(", ")}).`
    );
  }

  if (
    socialResult &&
    /kräver manuell verifiering/i.test(socialResult.message)
  ) {
    recommendations.push(
      "- Kontrollera manuellt att länkade sociala medier-profiler är företagets officiella konton."
    );
  }

  if (mapsResult && mapsResult.status !== "PASS") {
    recommendations.push(
      "- Överväg att lägga till Google Maps och länka till företagets Google-företagsprofil (rekommendation, inget fel)."
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
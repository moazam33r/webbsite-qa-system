import { Page } from "@playwright/test";
import { checkCTA } from "./checks/cta";
import { checkPages, PageProgress } from "./checks/pages";
import { checkLinks } from "./checks/links";
import { checkSocialMedia } from "./checks/social-media";
import { checkImages } from "./checks/images";
import { checkForms } from "./checks/forms";
import { checkValidation, PHONE_TEST_LABELS } from "./checks/validation";
import { checkNavigation } from "./checks/navigation";
import { checkGoogleMaps } from "./checks/google-maps";
import { checkGoogleBusinessProfile } from "./checks/google-business-profile";
import { checkSEO } from "./checks/seo";
import { checkPerformance } from "./checks/performance";
import { checkResponsive } from "./checks/responsive";
import { checkCookieGdpr } from "./checks/cookie-gdpr";
import { checkSecurity } from "./checks/security";
import { checkDomains } from "./checks/domains";
import { searchSimilarDomains } from "./checks/similar-domains";
import { checkText, TextIssue } from "./checks/text-check";
import { analyzeQAResults } from "./ai/qa-analyzer";
import { reviewTextIssues } from "./ai/text-reviewer";

import {
  printQAReport,
  QACheckResult,
} from "./report/qa-report";

// =========================================================
// PROGRESS-TYP
// =========================================================

// Callback som används för att skicka aktuell progress
// tillbaka till servern och sedan vidare till popupen.
export type ScanProgressCallback = (
  percentage: number,
  message: string
) => void;


// =========================================================
// VAL AV TESTER
// =========================================================

// Alla tester som kan väljas. Crawlern (sidor) körs alltid, eftersom
// alla andra tester behöver veta vilka sidor som finns.
export const QA_TESTS = [
  { id: "seo", label: "SEO" },
  { id: "performance", label: "Prestanda" },
  { id: "responsive", label: "Responsivitet" },
  { id: "cookie", label: "Cookie / GDPR" },
  { id: "security", label: "HTTPS / säkerhet" },
  { id: "domains", label: "Alternativa domäner" },
  { id: "similar", label: "Liknande domäner" },
  { id: "text", label: "Text / stavning" },
  { id: "links", label: "Länkar" },
  { id: "images", label: "Bilder" },
  { id: "forms", label: "Formulär" },
  { id: "email", label: "E-postvalidering" },
  { id: "phone", label: "Telefonvalidering" },
  { id: "navigation", label: "Navigation" },
  { id: "cta", label: "CTA" },
  { id: "social", label: "Sociala medier" },
  { id: "maps", label: "Google Maps" },
  { id: "gbp", label: "Google Business Profile" },
  { id: "ai", label: "AI-analys" },
] as const;

export type QATestId = (typeof QA_TESTS)[number]["id"];

export const ALL_QA_TEST_IDS: QATestId[] = QA_TESTS.map((t) => t.id);

export interface ScanOptions {
  // Vilka tester som ska köras. Utelämnad = hela QA-analysen.
  tests?: string[];
}

// Rensar en inkommande lista: okända id:n tas bort. Tom eller saknad
// lista betyder hela analysen.
export function normalizeTests(input: unknown): QATestId[] {

  if (!Array.isArray(input)) {
    return [...ALL_QA_TEST_IDS];
  }

  const wanted = new Set(
    input.filter((x): x is string => typeof x === "string")
  );

  const valid = ALL_QA_TEST_IDS.filter((id) => wanted.has(id));

  return valid.length > 0 ? valid : [...ALL_QA_TEST_IDS];
}


// =========================================================
// WEBSITE QA SYSTEM
// =========================================================

// Startar en komplett QA-skanning av webbplatsen.
export async function scanWebsite(
  page: Page,
  url: string,
  onProgress?: ScanProgressCallback,
  options: ScanOptions = {}
) {

  // Vilka tester som körs. Sidor/crawling körs alltid.
  const selectedTests = new Set<QATestId>(normalizeTests(options.tests));

  const enabled = (id: QATestId) => selectedTests.has(id);

  console.log("\n=================================");
  console.log("       WEBSITE QA SYSTEM");
  console.log("=================================");
  console.log(`\nStartar skanning av: ${url}`);


  // =======================================================
  // RESULTAT
  // =======================================================

  // Här sparar vi resultaten från alla kontroller.
  const results: QACheckResult[] = [];


  // =======================================================
  // PROGRESS
  // =======================================================

  // Sparar senast skickade procent.
  //
  // Detta är viktigt eftersom crawlern kan upptäcka nya
  // sidor under tiden. Vi vill aldrig att progressbaren
  // går bakåt från exempelvis 20 % till 15 %.
  let lastProgress = 0;

  // Skickar progress till servern.
  const reportProgress = (
    percentage: number,
    message: string
  ) => {

    // Säkerställer att värdet alltid ligger mellan 0 och 100.
    const safePercentage = Math.max(
      0,
      Math.min(100, Math.round(percentage))
    );

    // Progress får aldrig gå bakåt.
    const finalPercentage = Math.max(
      lastProgress,
      safePercentage
    );

    // Sparar senaste värdet.
    lastProgress = finalPercentage;

    // Skickar progress till servern.
    onProgress?.(
      finalPercentage,
      message
    );
  };


  // =======================================================
  // START
  // =======================================================

  reportProgress(
    0,
    "Förbereder QA-skanning..."
  );


  // =======================================================
  // 1. SIDOR / CRAWLING
  // =======================================================

  console.log("\n--- SIDOR ---");

  // Crawlern skickar information varje gång en sida
  // har analyserats.
  //
  // Vi använder inte en timer här.
  // Progressen kommer direkt från det faktiska arbetet
  // som crawlern utför.
  const pageResult = await checkPages(
    page,
    url,
    (progress: PageProgress) => {

      // Om inga sidor har upptäckts ännu visar vi 0 %.
      if (progress.current === 0) {

        reportProgress(
          0,
          progress.message
        );

        return;
      }

      // Antalet upptäckta sidor används som aktuell
      // arbetsmängd för crawlern.
      const discovered = Math.max(
        progress.discovered,
        progress.current,
        1
      );

      // Crawlern använder första delen av den totala
      // progressen.
      //
      // Eftersom nya sidor kan upptäckas under crawling
      // låter vi aldrig värdet gå bakåt.
      const crawlerPercentage =
        Math.round(
          (progress.current / discovered) * 30
        );

      reportProgress(
        crawlerPercentage,
        progress.message
      );
    }
  );


  // Hämtar sidorna som hittades.
  const pages = pageResult.links;


  // Kontrollerar resultatet för sidorna.
  if (
    pageResult.status >= 200 &&
    pageResult.status < 400 &&
    pageResult.failedPages === 0
  ) {

    results.push({
      name: "Sidor",
      status: "PASS",
      message:
        `${pageResult.passedPages}/${pageResult.pages.length} sidor fungerar`,
    });

  } else {

    results.push({
      name: "Sidor",
      status: "FAIL",
      message:
        `${pageResult.failedPages} sidor fungerar inte`,
    });
  }


  // Crawlingen är nu faktiskt färdig.
  reportProgress(
    30,
    `${pageResult.pages.length} sidor hittades. Fortsätter QA-analysen...`
  );


 
  if (enabled("seo")) {

  const seoResult = await checkSEO(
    page,
    pages
  );

  // Skiljer mellan viktiga förbättringar, rekommendationer,
  // manuell granskning och tekniska kontrollfel.
  const seoDetails: string[] = [];

  if (seoResult.warnings.length > 0) {
    seoDetails.push(
      `Viktiga förbättringar (${seoResult.warnings.length}):`,
      ...seoResult.warnings.map((item) => `- ${item}`)
    );
  }

  if (seoResult.recommendations.length > 0) {
    seoDetails.push(
      `Mindre rekommendationer (${seoResult.recommendations.length}):`,
      ...seoResult.recommendations.map((item) => `- ${item}`)
    );
  }

  if (seoResult.manualReview.length > 0) {
    seoDetails.push(
      `Kräver manuell granskning (${seoResult.manualReview.length}):`,
      ...seoResult.manualReview.map((item) => `- ${item}`)
    );
  }

  if (seoResult.failed.length > 0) {
    seoDetails.push(
      `Tekniska kontrollfel (${seoResult.failed.length}):`,
      ...seoResult.failed.map((item) => `- ${item}`)
    );
  }

 
  // Tekniska kontrollfel och viktiga förbättringar ger WARNING.
  if (
    seoResult.failed.length > 0 ||
    seoResult.warnings.length > 0
  ) {
    results.push({
      name: "SEO",
      status: "WARNING",
      message:
        seoResult.failed.length > 0
          ? "SEO-kontrollen kunde inte slutföras på alla sidor.\n" +
            seoDetails.join("\n")
          : `${seoResult.warnings.length} viktiga SEO-förbättringar hittades.\n` +
            seoDetails.join("\n"),
    });
  } else if (
    seoResult.recommendations.length > 0 ||
    seoResult.manualReview.length > 0
  ) {
    results.push({
      name: "SEO",
      status: "PASS",
      message:
        "Inga viktiga SEO-problem identifierades. " +
        "Mindre rekommendationer och fynd för manuell granskning finns nedan.\n" +
        seoDetails.join("\n"),
    });
  } else {
    results.push({
      name: "SEO",
      status: "PASS",
      message:
        `${seoResult.passed.length} SEO-kontroller godkända. ` +
        "Inga ytterligare SEO-fynd.",
    });
  }


  }


  // =======================================================
  // 3. PRESTANDA
  // =======================================================

  if (enabled("performance")) {


  reportProgress(
    35,
    "Analyserar webbplatsens prestanda..."
  );

  const performanceResult =
    await checkPerformance(url);

  if (performanceResult.desktop !== null) {

    results.push({
      name: "Prestanda",
      status: performanceResult.status,
      message:
        `Desktop: ${performanceResult.desktop.score}/100 | ` +
        `Mobile: ${performanceResult.mobile?.score ?? "N/A"}/100`,
    });

  } else {

    results.push({
      name: "Prestanda",
      status: "WARNING",
      message:
        "PageSpeed-kontrollen kunde inte genomföras",
    });
  }


  }


  // =======================================================
  // 4. RESPONSIVITET
  // =======================================================

  if (enabled("responsive")) {


  reportProgress(
    38,
    "Kontrollerar mobil och responsivitet..."
  );

  const responsiveResult =
    await checkResponsive(
      page,
      pages
    );

  if (responsiveResult.failed === 0) {

    results.push({
      name: "Responsivitet",
      status: "PASS",
      message:
        `${responsiveResult.passed} sidor fungerar i mobilvy`,
    });

  } else {

    results.push({
      name: "Responsivitet",
      status: "FAIL",
      message:
        `${responsiveResult.failed} sidor har problem i mobilvy`,
    });
  }


  }


  // =======================================================
  // 5. COOKIE / GDPR
  // =======================================================

  if (enabled("cookie")) {


  reportProgress(
    41,
    "Kontrollerar Cookie / GDPR..."
  );

  const cookieGdprResult =
    await checkCookieGdpr(
      page,
      pages
    );

  if (cookieGdprResult.found > 0) {

    results.push({
      name: "Cookie / GDPR",
      status: "PASS",
      message:
        `${cookieGdprResult.found} relevanta sidor hittades`,
    });

  } else {

    results.push({
      name: "Cookie / GDPR",
      status: "WARNING",
      message:
        "Ingen Cookie- eller Integritetspolicy hittades",
    });
  }


  }


  // =======================================================
  // 6. HTTPS / SECURITY
  // =======================================================

  if (enabled("security")) {


  reportProgress(
    44,
    "Kontrollerar HTTPS och säkerhet..."
  );

  const securityResult =
    await checkSecurity(url);

  results.push({
    name: "HTTPS / Security",
    status: securityResult.status,
    message: securityResult.message,
  });


  }


  // =======================================================
  // 7. ALTERNATIVA DOMÄNER
  // =======================================================

  if (enabled("domains")) {


  reportProgress(
    47,
    "Kontrollerar alternativa domäner..."
  );

  const domainsResult =
    await checkDomains(url);

  // Hämtar de alternativa domäner som inte fungerar.
const failedDomains =
  domainsResult.results.filter(
    (domain) => !domain.working
  );


// Skapar detaljer för varje domän som inte fungerar.
const failedDomainDetails =
  failedDomains
    .map((domain) => {

      const statusText =
        domain.status === 0
          ? "Kunde inte nås"
          : `Status: ${domain.status}`;

      return (
        `- Domän: ${domain.url}\n` +
        `  ${statusText}`
      );
    })
    .join("\n\n");


if (domainsResult.skipped) {

  results.push({
    name: "Alternativa domäner",
    status: "PASS",
    message:
      "Hoppades över: adressen är en testadress hos webbhotell och " +
      "har inga egna domänvarianter att kontrollera.",
  });

} else
results.push({
  name: "Alternativa domäner",
  status: domainsResult.status,

  message:
    `${domainsResult.passed} fungerar, ` +
    `${domainsResult.failed} fungerar inte` +

    (
      failedDomains.length > 0
        ? `\n\n` +
          `Domäner som inte fungerar:\n\n` +
          failedDomainDetails
        : ""
    ),
});


  }


  // =======================================================
  // 8. HÄMTAR FÖRETAGSNAMN
  // =======================================================

  if (enabled("similar")) {


  reportProgress(
    49,
    "Analyserar företagsinformation..."
  );

  let companyName = "";

  try {

    await page.goto(url, {
      waitUntil: "domcontentloaded",
    });

    const jsonLdScripts = await page
      .locator('script[type="application/ld+json"]')
      .allTextContents();

    for (const scriptText of jsonLdScripts) {

      try {

        const data = JSON.parse(scriptText);

        const objects = Array.isArray(data)
          ? data
          : [data];

        for (const object of objects) {

          if (
            object &&
            typeof object === "object" &&
            typeof object.name === "string"
          ) {

            const type =
              object["@type"];

            console.log(
              "JSON-LD:",
              type,
              object.name
            );

            if (
              type === "Organization" ||
              type === "LocalBusiness" ||
              type === "Corporation" ||
              type === "ProfessionalService"
            ) {

              companyName =
                object.name.trim();

              break;
            }
          }

          if (
            object &&
            typeof object === "object" &&
            Array.isArray(object["@graph"])
          ) {

            for (
              const graphObject
              of object["@graph"]
            ) {

              if (
                graphObject &&
                typeof graphObject === "object" &&
                typeof graphObject.name === "string"
              ) {

                const type =
                  graphObject["@type"];

                console.log(
                  "JSON-LD GRAPH:",
                  type,
                  graphObject.name
                );

                if (
                  type === "Organization" ||
                  type === "LocalBusiness" ||
                  type === "Corporation" ||
                  type === "ProfessionalService"
                ) {

                  companyName =
                    graphObject.name.trim();

                  break;
                }
              }
            }
          }

          if (companyName) {
            break;
          }
        }

        if (companyName) {
          break;
        }

      } catch {
        // Ignorerar JSON-LD som inte går att läsa.
      }
    }

  } catch {
    // Fortsätter med fallback nedan.
  }


  // Om JSON-LD inte gav något företagsnamn
  // används sidtiteln som reservlösning.
  if (!companyName) {

    companyName =
      pageResult.title
        ? pageResult.title
            .split("|")
            .pop()
            ?.trim() || ""
        : "";
  }

  console.log(
    `\nFöretagsnamn för liknande domäner: ${
      companyName || "kunde inte hittas"
    }`
  );


  // =======================================================
  // 9. LIKNANDE DOMÄNER / FÖRETAGSNAMN
  // =======================================================

  reportProgress(
    51,
    "Kontrollerar liknande domäner..."
  );

  if (companyName) {

    const similarDomainsResult =
      await searchSimilarDomains(
        url,
        companyName
      );

    if (similarDomainsResult.found > 0) {

      results.push({
        name: "Liknande domäner",
        status: "WARNING",
        message:
          `${similarDomainsResult.found} möjliga liknande domäner hittades`,
      });

    } else {

      results.push({
        name: "Liknande domäner",
        status: "PASS",
        message:
          "Inga andra domäner hittades",
      });
    }

  } else {

    results.push({
      name: "Liknande domäner",
      status: "WARNING",
      message:
        "Företagsnamn kunde inte hittas",
    });

    console.log(
      "\n⚠ Kunde inte hitta ett företagsnamn för kontroll av liknande domäner."
    );
  }


  }


  // =======================================================
  // 10. TEXT / STAVNING
  // =======================================================

  if (enabled("text")) {


  console.log("\n--- TEXT / STAVNING ---");

  reportProgress(
    54,
    "Kontrollerar text och stavning..."
  );

  // =======================================================
  // HÄMTA TEXT FRÅN ALLA SIDOR
  // =======================================================

  const textIssues: TextIssue[] = [];
  const failedTextPages: string[] = [];
  const failedLanguageToolPages: string[] = [];
  const totalTextPages = pages.length;
  const pageTexts = new Map<string, string>();

  for (let i = 0; i < pages.length; i++) {
    const pageUrl = pages[i];

    console.log(
      `\nHämtar text ${i + 1}/${totalTextPages}: ${pageUrl}`
    );

    try {
      await page.goto(pageUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });

      const pageText = await page.evaluate(() => {
        // Ta bort innehåll som normalt inte är sidans brödtext.
        const selectorsToRemove = [
  "script",
  "style",
  "noscript",
  "nav",
  "header",
  "footer",
  "aside",
  "template",

  // Navigations- och sidoinnehåll som inte ska stavningskontrolleras.
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',

  // Formulärens val och listor.
  "select",
  "option",
  '[role="listbox"]',
  '[role="option"]',

  // Telefonfältens landsväljare.
  ".iti__country-container",
  ".iti__country-list",
  ".iti__country",
  ".iti__selected-country",
  ".iti__dropdown-content",
  '[class*="country-list" i]',
  '[class*="country-dropdown" i]',
  '[class*="country-selector" i]',

  // Cookie- och recensionswidgetar.
  '[aria-label*="cookie" i]',
  '[id*="cookie" i]',
  '[class*="cookie" i]',
  '[id*="review" i]',
  '[class*="review" i]',
];

        document
          .querySelectorAll(selectorsToRemove.join(","))
          .forEach((element) => element.remove());

        // Hämta text från huvudområdet om det finns.
       
const mainElement = document.querySelector(
  "main, [role='main'], article"
);

const main: HTMLElement | null =
  mainElement instanceof HTMLElement
    ? mainElement
    : document.body;


        if (!main) {
          return "";
        }

        // Samla text från blockelement i dokumentordning.
        // Ta bort upprepade, direkt intilliggande textblock,
        // men behåll upprepningar som kan vara avsiktliga
        // i olika delar av sidans innehåll.
        const blockSelectors = [
          "h1",
          "h2",
          "h3",
          "h4",
          "p",
          "li",
          "label",
          "button",
          "blockquote",
          "figcaption",
          "td",
          "th",
        ];

        const blocks = Array.from(
          main.querySelectorAll(blockSelectors.join(","))
        );

        const output: string[] = [];
        let previousNormalized = "";

        for (const block of blocks) {
          if (
            block.closest(
              "nav, header, footer, aside, script, style, noscript"
            )
          ) {
            continue;
          }

          const text = (block as HTMLElement).innerText
            ?.replace(/\s+/g, " ")
            .trim();

          if (!text || text.length < 3) {
            continue;
          }

          const normalized = text.toLocaleLowerCase("sv");

          // Undvik endast direkt upprepade textblock.
          if (normalized === previousNormalized) {
            continue;
          }

          output.push(text);
          previousNormalized = normalized;
        }

        // Sidor utan vanliga blockelement ska ändå kontrolleras.
        if (output.length === 0) {
          return main.innerText
            .replace(/\s+/g, " ")
            .trim();
        }

        return output.join("\n");
      });

      pageTexts.set(pageUrl, pageText);

      const textProgress =
        54 +
        Math.round(((i + 1) / Math.max(totalTextPages, 1)) * 1);

      reportProgress(
        textProgress,
        `Hämtar text ${i + 1}/${totalTextPages}...`
      );
    } catch (error) {
      console.log(
        `⚠ Kunde inte hämta text på: ${pageUrl}`
      );
      console.log(error);
      failedTextPages.push(pageUrl);
    }
  }

  // =======================================================
  // RÄKNA ÅTERKOMMANDE ORD
  // =======================================================

  const siteWordFrequency = new Map<string, number>();

  for (const pageText of pageTexts.values()) {
    const words =
      pageText.toLocaleLowerCase("sv").match(/[a-zåäöéü]+/gi) ?? [];

    for (const word of new Set(words)) {
      if (word.length < 5) {
        continue;
      }

      siteWordFrequency.set(
        word,
        (siteWordFrequency.get(word) ?? 0) + 1
      );
    }
  }

  console.log(
    `\n✓ ${siteWordFrequency.size} unika ord analyserades på webbplatsen`
  );

  // =======================================================
  // LANGUAGE TOOL
  // =======================================================

  for (let i = 0; i < pages.length; i++) {
    const pageUrl = pages[i];
    const pageText = pageTexts.get(pageUrl);

    if (pageText === undefined) {
      continue;
    }

    console.log(
      `\nAnalyserar text ${i + 1}/${totalTextPages}: ${pageUrl}`
    );

    try {
      const textCheckResult = await checkText(
        pageText,
        "sv",
        pageUrl,
        siteWordFrequency
      );

      textIssues.push(...textCheckResult.issues);

      if (!textCheckResult.completed) {
        failedLanguageToolPages.push(pageUrl);

        console.warn(
          `LanguageTool kunde inte kontrollera sidan fullt ut: ${pageUrl}` +
            (textCheckResult.failureReason
              ? ` Orsak: ${textCheckResult.failureReason}`
              : "")
        );
      }

      const textProgress =
        55 +
        Math.round(((i + 1) / Math.max(totalTextPages, 1)) * 1);

      reportProgress(
        textProgress,
        `Analyserar text ${i + 1}/${totalTextPages}...`
      );
    } catch (error) {
      console.log(
        `⚠ Kunde inte analysera text på: ${pageUrl}`
      );
      console.log(error);
      failedLanguageToolPages.push(pageUrl);
    }
  }

  // =======================================================
  // AI-GRANSKNING OCH TEXTRESULTAT
  // =======================================================

  const aiReviewedIssues = await reviewTextIssues(textIssues);

  // Felsökningsutskrift för textkontrollen.
  // Visas bara om QA_DEBUG=true finns i .env.
  if (process.env.QA_DEBUG === "true") {
    console.log("\n--- FELSÖKNING TEXTKONTROLL ---");
    console.log(`LanguageTool-träffar: ${textIssues.length}`);
    console.log(`AI-granskade träffar: ${aiReviewedIssues.length}`);

    console.log(
      "AI bedömer som stavfel:",
      aiReviewedIssues.filter(
        (issue) => issue.aiAssessment === "LIKELY_SPELLING"
      ).length
    );

    console.log(
      "AI bedömer som korrekta:",
      aiReviewedIssues.filter(
        (issue) => issue.aiAssessment === "LIKELY_CORRECT"
      ).length
    );

    console.log(
      "AI lämnar osäkra:",
      aiReviewedIssues.filter(
        (issue) => issue.aiAssessment === "REVIEW"
      ).length
    );

    console.table(
      aiReviewedIssues.map((issue) => ({
        text: issue.matchedText,
        LanguageTool: issue.classification,
        Ollama: issue.aiAssessment,
        förklaring: issue.aiExplanation,
        sida: issue.pageUrl,
      }))
    );

    console.log("--- SLUT FELSÖKNING ---\n");
  }

  const formatIssue = (
    issue: (typeof aiReviewedIssues)[number]
  ): string => {
    const classification =
      issue.aiAssessment === "LIKELY_SPELLING"
        ? "AI bedömer texten som sannolikt stavfel"
        : "Osäker träff – behöver granskas";

    return (
      `- Klassificering: ${classification}\n` +
      `  Markerad text: "${issue.matchedText}"\n` +
      `  Förslag: ${
        issue.suggestions.length > 0
          ? issue.suggestions.join(", ")
          : "Inga förslag från LanguageTool"
      }\n` +
      `  Sida: ${issue.pageUrl}\n` +
      `  Sammanhang: ${issue.context}\n` +
      `  Förklaring från LanguageTool: ${issue.message}\n` +
      (issue.aiExplanation
        ? `  AI-bedömning: ${issue.aiExplanation}\n`
        : "") +
      `  LanguageTool-regel: ${issue.ruleId}\n` +
      `  Typ: ${issue.issueType}`
    );
  };

  const reportIssues = aiReviewedIssues.filter(
    (issue) => issue.aiAssessment !== "LIKELY_CORRECT"
  );

  const reportSpellingIssues = reportIssues.filter(
    (issue) => issue.aiAssessment === "LIKELY_SPELLING"
  );

  const reportUncertainIssues = reportIssues.filter(
    (issue) => issue.aiAssessment === "REVIEW"
  );

  const incompletePages = new Set([
    ...failedTextPages,
    ...failedLanguageToolPages,
  ]);

  const sections: string[] = [];

  if (incompletePages.size > 0) {
    sections.push(
      `Textkontrollen blev ofullständig: ${incompletePages.size} av ` +
        `${totalTextPages} sidor kunde inte kontrolleras ` +
        "(LanguageTool svarade inte eller sidans text kunde inte hämtas). " +
        "Kör om textkontrollen senare."
    );
  }

  sections.push(
    `Antal sannolika stavfel: ${reportSpellingIssues.length}` +
      (incompletePages.size > 0 ? " (på de sidor som kontrollerades)" : ""),
    `Antal osäkra träffar: ${reportUncertainIssues.length}`
  );

  if (reportSpellingIssues.length > 0) {
    sections.push(
      "SANNOLIKA STAVFEL – AI-BEDÖMNING\n\n" +
        reportSpellingIssues.map(formatIssue).join("\n\n")
    );
  }

  if (reportUncertainIssues.length > 0) {
    sections.push(
      "OSÄKRA TRÄFFAR – MANUELL GRANSKNING\n\n" +
        reportUncertainIssues.map(formatIssue).join("\n\n")
    );
  }

  const textCheckFailed =
    failedTextPages.length > 0 ||
    failedLanguageToolPages.length > 0;

  if (failedTextPages.length > 0) {
    sections.push(
      "SIDOR DÄR TEXTEN INTE KUNDE HÄMTAS\n\n" +
        failedTextPages.map((pageUrl) => `- ${pageUrl}`).join("\n")
    );
  }

  if (failedLanguageToolPages.length > 0) {
    sections.push(
      "SIDOR DÄR TEXTKONTROLLEN INTE KUNDE GENOMFÖRAS\n\n" +
        [...new Set(failedLanguageToolPages)]
          .map((pageUrl) => `- ${pageUrl}`)
          .join("\n")
    );
  }

  if (reportIssues.length > 0 || textCheckFailed) {
    results.push({
      name: "Text / stavning",
      status: "WARNING",
      message: sections.join("\n\n"),
    });
  } else {
    results.push({
      name: "Text / stavning",
      status: "PASS",
      message:
        "Textkontrollen genomfördes utan sannolika stavfel eller osäkra träffar.",
    });
  }
  }


  // =======================================================
  // 11. LÄNKAR
  // =======================================================

  if (enabled("links")) {


  console.log("\n--- LÄNKAR ---");

  reportProgress(
    57,
    "Kontrollerar interna och externa länkar..."
  );

  // Kör den kompletta länkkontrollen.
  //
  // Den kontrollerar:
  // - interna länkar
  // - externa länkar
  // - tel:-länkar
  // - callto:-länkar
  // - Link Intent
  // - giltigheten på telefonnummer
  const linkResult = await checkLinks(
    page,
    url,
    pages
  );


  // =======================================================
  // SAMMANFATTNING
  // =======================================================

  // Räknar alla HTTP/HTTPS-länkar.
  const totalHttpLinks =
    linkResult.internalPassed +
    linkResult.internalFailed +
    linkResult.externalPassed +
    linkResult.externalFailed;


  // Räknar trasiga HTTP/HTTPS-länkar.
  const totalLinkFailures =
    linkResult.internalFailed +
    linkResult.externalFailed;


  // Räknar alla telefonlänkar.
  const totalPhoneLinks =
    linkResult.phoneLinks.length;


  // Räknar giltiga telefonlänkar.
  const validPhoneLinks =
    linkResult.phoneLinks.filter(
      (phone) => phone.valid
    ).length;


  // Räknar ogiltiga telefonlänkar.
  const invalidPhoneLinks =
    linkResult.phoneLinks.filter(
      (phone) => !phone.valid
    ).length;


  // Räknar möjliga Link Intent-problem.
  const totalIntentFailures =
    linkResult.intentFailed;


  // =======================================================
  // TRASIGA HTTP-LÄNKAR
  // =======================================================

  const linkFailureDetails =
    linkResult.linkFailures
      .map((failure) => {

        const statusText =
          failure.status !== undefined
            ? `\n  Status: ${failure.status}`
            : "";

        return (
          `- Sida: ${failure.sourcePage}\n` +
          `  Länk: ${failure.url}\n` +
          `  Typ: ${failure.type}` +
          `${statusText}\n` +
          `  Fel: ${failure.error}`
        );
      })
      .join("\n\n");


  // =======================================================
  // LINK INTENT-FEL
  // =======================================================

  const intentFailureDetails =
    linkResult.intentFailures
      .map((failure) => {

        return (
          `- Sida: ${failure.sourcePage}\n` +
          `  Länktext: "${failure.linkText}"\n` +
          `  Förväntat syfte: ${failure.expected}\n` +
          `  Destination: ${failure.targetUrl}\n` +
          `  Titel: ${failure.targetTitle || "Saknas"}\n` +
          `  H1: ${failure.targetHeading || "Saknas"}`
        );
      })
      .join("\n\n");


  // =======================================================
  // OGILTIGA TELEFONNUMMER
  // =======================================================

  const invalidPhoneResults =
    linkResult.phoneLinks.filter(
      (phone) => !phone.valid
    );


  // -------------------------------------------------------
  // GRUPPERA SAMMA OGILTIGA NUMMER
  // -------------------------------------------------------

  const groupedInvalidPhones =
    new Map<
      string,
      {
        phoneNumber: string;
        error: string;
        pages: string[];
      }
    >();


  for (const phone of invalidPhoneResults) {

    const existing =
      groupedInvalidPhones.get(
        phone.phoneNumber
      );


    if (existing) {

      if (
        !existing.pages.includes(
          phone.sourcePage
        )
      ) {

        existing.pages.push(
          phone.sourcePage
        );
      }

    } else {

      groupedInvalidPhones.set(
        phone.phoneNumber,
        {
          phoneNumber:
            phone.phoneNumber,

          error:
            phone.error ||
            "Okänt fel",

          pages: [
            phone.sourcePage,
          ],
        }
      );
    }
  }


  // =======================================================
  // FORMATERA OGILTIGA TELEFONNUMMER
  // =======================================================

  const invalidPhoneDetails =
    Array.from(
      groupedInvalidPhones.values()
    )
      .map((phone) => {

        const pageList =
          phone.pages
            .map(
              (pageUrl) =>
                `    - ${pageUrl}`
            )
            .join("\n");

        return (
          `- Telefonnummer: ${phone.phoneNumber}\n` +
          `  Fel: ${phone.error}\n` +
          `  Förekommer på ${phone.pages.length} sida/sidor:\n` +
          `${pageList}`
        );
      })
      .join("\n\n");


  // =======================================================
  // BESTÄM QA-STATUS
  // =======================================================

  // Trasiga HTTP/HTTPS-länkar är FAIL.
  if (totalLinkFailures > 0) {

    results.push({
      name: "Länkar",
      status: "FAIL",

      message:
        `HTTP/HTTPS-länkar: ${totalHttpLinks} kontrollerade\n` +
        `Interna: ${linkResult.internalPassed} godkända, ` +
        `${linkResult.internalFailed} fel\n` +
        `Externa: ${linkResult.externalPassed} godkända, ` +
        `${linkResult.externalFailed} fel\n\n` +

        `Trasiga länkar:\n\n` +
        linkFailureDetails +

        (
          invalidPhoneLinks > 0
            ? `\n\n` +
              `Telefonlänkar: ${totalPhoneLinks} hittade\n` +
              `${validPhoneLinks} giltiga\n` +
              `${invalidPhoneLinks} ogiltiga\n\n` +
              `Ogiltiga telefonnummer:\n\n` +
              invalidPhoneDetails
            : ""
        ),
    });


  // =======================================================
  // LINK INTENT WARNING
  // =======================================================

  } else if (totalIntentFailures > 0) {

    results.push({
      name: "Länkar",
      status: "WARNING",

      message:
        `HTTP/HTTPS-länkar: ${totalHttpLinks} kontrollerade\n` +
        `Interna: ${linkResult.internalPassed} godkända\n` +
        `Externa: ${linkResult.externalPassed} godkända\n\n` +

        `⚠ ${totalIntentFailures} länkar verkar kunna ` +
        `leda till fel typ av sida.\n\n` +

        `Link Intent-detaljer:\n\n` +
        intentFailureDetails +

        (
          invalidPhoneLinks > 0
            ? `\n\n` +
              `Telefonlänkar: ${totalPhoneLinks} hittade\n` +
              `${validPhoneLinks} giltiga\n` +
              `${invalidPhoneLinks} ogiltiga\n\n` +
              `Ogiltiga telefonnummer:\n\n` +
              invalidPhoneDetails
            : ""
        ),
    });


  // =======================================================
  // OGILTIGA TELEFONNUMMER
  // =======================================================

  } else if (invalidPhoneLinks > 0) {

    results.push({
      name: "Länkar",
      status: "WARNING",

      message:
        `HTTP/HTTPS-länkar: ${totalHttpLinks} kontrollerade\n` +
        `Interna: ${linkResult.internalPassed} godkända\n` +
        `Externa: ${linkResult.externalPassed} godkända\n\n` +

        `Telefonlänkar: ${totalPhoneLinks} hittade\n` +
        `${validPhoneLinks} giltiga\n` +
        `${invalidPhoneLinks} ogiltiga\n\n` +

        `Ogiltiga telefonnummer:\n\n` +
        invalidPhoneDetails,
    });


  // =======================================================
  // ALLT GODKÄNT
  // =======================================================

  } else {

    results.push({
      name: "Länkar",
      status: "PASS",

      message:
        `HTTP/HTTPS-länkar: ${totalHttpLinks} kontrollerade\n` +
        `Interna: ${linkResult.internalPassed} godkända\n` +
        `Externa: ${linkResult.externalPassed} godkända\n\n` +

        `Telefonlänkar: ${totalPhoneLinks} hittade\n` +
        `${validPhoneLinks} giltiga\n\n` +

        `Alla kontrollerade länkar fungerar och ` +
        `inga tydliga felaktiga destinationer hittades`,
    });
  }


  // Lägger till en notering om externa länkar som inte kunde
  // kontrolleras automatiskt (t.ex. Facebook, som blockerar
  // automatiska förfrågningar). Dessa räknas inte som trasiga.
  if (linkResult.externalSkipped > 0) {

    const linksEntry = results[results.length - 1];

    linksEntry.message +=
      `\n\nObs: ${linkResult.externalSkipped} externa länkar ` +
      `(t.ex. sociala medier) kunde inte kontrolleras automatiskt ` +
      `eftersom de blockerar automatiska förfrågningar. ` +
      `De räknas inte som trasiga.`;
  }


  }


  // =======================================================
  // 12. BILDER
  // =======================================================

  if (enabled("images")) {


  console.log("\n--- BILDER ---");

  reportProgress(
    60,
    "Kontrollerar bilder..."
  );

  const imageResult = await checkImages(
    page,
    pages
  );

  if (imageResult.failed === 0) {

    results.push({
      name: "Bilder",
      status: "PASS",
      message:
        `${imageResult.passed} bilder fungerar`,
    });

  } else {

    results.push({
      name: "Bilder",
      status: "FAIL",
      message:
        `${imageResult.failed} bilder fungerar inte`,
    });
  }


  }


  // =======================================================
  // 13. FORMULÄR
  // =======================================================

  if (enabled("forms")) {


  console.log("\n--- FORMULÄR ---");

  reportProgress(
    63,
    "Kontrollerar formulär..."
  );

  const formResult = await checkForms(
    page,
    pages
  );

  results.push({
    name: "Formulär",
    status: "PASS",
    message:
      `${formResult.formCount} formulär, ` +
      `${formResult.fieldCount} fält, ` +
      `${formResult.requiredCount} obligatoriska fält`,
  });


  }


  // =======================================================
  // 14. FORMULÄRVALIDERING
  // =======================================================

  console.log("\n--- VALIDERING ---");

  reportProgress(
    65,
    "Kontrollerar formulärvalidering..."
  );

  if (enabled("email") || enabled("phone")) {

  const validationResult = await checkValidation(
    page,
    pages,
    (percentage, message) => {

      const mappedPercentage =
        65 +
        Math.round(
          (percentage / 100) * 7
        );

      reportProgress(
        mappedPercentage,
        message
      );
    },
    {
      email: enabled("email"),
      phone: enabled("phone"),
    }
  );

  // Rapporterar e-postvalidering separat.
if (!enabled("email")) {
  // E-postvalidering är inte vald.
} else if (validationResult.emailFailed > 0) {
  results.push({
    name: "E-postvalidering",
    status: "FAIL",
    message: `${validationResult.emailFailed} e-postfält accepterar ogiltig e-post.`,
  });
} else {
  results.push({
    name: "E-postvalidering",
    status: "PASS",
    message: "Ingen ogiltig e-post accepterades av den kontrollerade HTML-valideringen.",
  });
}

// Rapporterar telefonvalidering separat.
if (enabled("phone")) {
  const tests = validationResult.phoneTests;

  const failed = tests.filter((t) => t.status === "failed");
  const inconclusive = tests.filter((t) => t.status === "inconclusive");
  const passed = tests.filter((t) => t.status === "passed");

  // Kort och läsbar beskrivning av en underkänd kontroll.
  const failedPhrase = (t: (typeof tests)[number]) =>
    t.test === "typing"
      ? `Bokstäver accepteras när man skriver (${t.testValue})`
      : t.test === "short"
        ? `För kort nummer accepteras (${t.testValue})`
        : `Bokstäver accepteras vid inskick (${t.testValue})`;

  const shortDetail = (text: string) =>
    text.length > 160 ? text.substring(0, 157) + "..." : text;

  // Grupperar per sida och fält så att varje fält beskrivs en gång.
  const describeGroups = (
    items: typeof tests,
    phrase: (t: (typeof tests)[number]) => string
  ) => {
    const groups = new Map<string, typeof tests>();

    for (const t of items) {
      const key = `${t.pageUrl}|${t.fieldName}`;
      groups.set(key, [...(groups.get(key) ?? []), t]);
    }

    return [...groups.values()]
      .map(
        (group) =>
          `- Sida: ${group[0].pageUrl}\n` +
          `  Fält: ${group[0].fieldName}\n` +
          `  Fältet är: ${group[0].required ? "obligatoriskt" : "valfritt"}\n` +
          `  Kontroll: ${group.map(phrase).join("; ")}`
      )
      .join("\n\n");
  };

  if (tests.length === 0) {
    results.push({
      name: "Telefonvalidering",
      status: "PASS",
      message: "Inga telefonfält hittades att testa.",
    });
  } else {
    const sections: string[] = [
      failed.length === 0 && inconclusive.length === 0
        ? `Alla ${passed.length} kontroller godkända`
        : `${passed.length} godkända, ${failed.length} underkända, ` +
          `${inconclusive.length} kunde inte avgöras`,
    ];

    if (failed.length > 0) {
      sections.push(
        (failed.some((t) => t.required)
          ? "UNDERKÄNDA KONTROLLER"
          : "SAKNAR VALIDERING (VALFRITT FÄLT – LÅG PRIORITET)") +
          "\n\n" +
          describeGroups(failed, failedPhrase) +
          "\n\nTestet skickar inget formulär. Servern kan ändå avvisa numret."
      );
    }

    if (inconclusive.length > 0) {
      sections.push(
        "KUNDE INTE AVGÖRAS – KONTROLLERA MANUELLT\n\n" +
          describeGroups(
            inconclusive,
            (t) => `${PHONE_TEST_LABELS[t.test]} – ${shortDetail(t.detail)}`
          )
      );
    }

    // Godkända kontroller listas inte i rapporten. Det är bara det som
    // underkänns eller inte kan avgöras som behöver förklaras.

    results.push({
      name: "Telefonvalidering",
      // Underkänt eller oavgjort ska aldrig se ut som godkänt, även om
      // fältet är valfritt. Prioriteten (låg för valfria fält) sätts
      // i rapporten, inte här.
      status:
        failed.length > 0 || inconclusive.length > 0
          ? "WARNING"
          : "PASS",
      message: sections.join("\n\n"),
    });
  }
}



  }

  // =======================================================
  // 15. NAVIGATION
  // =======================================================

  if (enabled("navigation")) {


  console.log("\n--- NAVIGATION ---");

  reportProgress(
    73,
    "Kontrollerar navigation..."
  );

  const navigationResult = await checkNavigation(
    page,
    url,
    pages
  );

  const navigationLines = (
    items: {
      url: string;
      reason: string;
      pages: string[];
    }[]
  ) =>
    items
      .map(
        (item) =>
          `- Länk: ${item.url}\n` +
          `  Orsak: ${item.reason}\n` +
          `  Finns på: ${item.pages.slice(0, 3).join(", ")}` +
          (item.pages.length > 3
            ? ` och ${item.pages.length - 3} sidor till`
            : "")
      )
      .join("\n\n");

  if (navigationResult.failed > 0) {

    results.push({
      name: "Navigation",
      status: "FAIL",
      message:
        `${navigationResult.failed} interna navigationer är bekräftat trasiga. ` +
        `${navigationResult.passed} fungerar` +
        (navigationResult.unverified > 0
          ? `, ${navigationResult.unverified} kunde inte verifieras automatiskt.`
          : ".") +
        "\n\nTRASIGA\n\n" +
        navigationLines(navigationResult.failures) +
        (navigationResult.unverified > 0
          ? "\n\nKUNDE INTE VERIFIERAS – KONTROLLERA MANUELLT\n\n" +
            navigationLines(navigationResult.unverifiedLinks)
          : ""),
    });

  } else if (navigationResult.unverified > 0) {

    results.push({
      name: "Navigation",
      status: "WARNING",
      message:
        `${navigationResult.passed} interna navigationer fungerar. ` +
        `${navigationResult.unverified} kunde inte verifieras automatiskt ` +
        "och bör kontrolleras manuellt. Inga bekräftat trasiga länkar.\n\n" +
        "KUNDE INTE VERIFIERAS – KONTROLLERA MANUELLT\n\n" +
        navigationLines(navigationResult.unverifiedLinks),
    });

  } else {

    results.push({
      name: "Navigation",
      status: "PASS",
      message:
        `${navigationResult.passed} interna navigationer fungerar`,
    });
  }

  }


  // =======================================================
  // 16. CTA
  // =======================================================

  if (enabled("cta")) {


  console.log("\n--- CTA ---");

  reportProgress(
    76,
    "Kontrollerar CTA-knappar och länkar..."
  );

  const ctaResult = await checkCTA(
    page,
    pages
  );

  const ctaLines = (
    items: {
      text: string;
      url: string;
      reason: string;
      pages: string[];
    }[]
  ) =>
    items
      .map(
        (item) =>
          `- Knapp/länk: "${item.text || "utan text"}"\n` +
          `  Destination: ${item.url}\n` +
          `  Orsak: ${item.reason}\n` +
          `  Finns på: ${item.pages.slice(0, 3).join(", ")}` +
          (item.pages.length > 3
            ? ` och ${item.pages.length - 3} sidor till`
            : "")
      )
      .join("\n\n");

  if (ctaResult.failed > 0) {

    results.push({
      name: "CTA",
      status: "FAIL",
      message:
        `${ctaResult.failed} CTA-destinationer är bekräftat trasiga. ` +
        `${ctaResult.passed} fungerar` +
        (ctaResult.unverified > 0
          ? `, ${ctaResult.unverified} kunde inte verifieras automatiskt`
          : "") +
        `.\n\nTRASIGA CTA-LÄNKAR\n\n` +
        ctaLines(ctaResult.failures) +
        (ctaResult.unverified > 0
          ? `\n\nKUNDE INTE VERIFIERAS – KONTROLLERA MANUELLT\n\n` +
            ctaLines(ctaResult.unverifiedLinks)
          : ""),
    });

  } else if (ctaResult.unverified > 0) {

    results.push({
      name: "CTA",
      status: "WARNING",
      message:
        `${ctaResult.passed} CTA-destinationer fungerar. ` +
        `${ctaResult.unverified} kunde inte verifieras automatiskt och bör ` +
        `kontrolleras manuellt. Inga bekräftat trasiga CTA-länkar.\n\n` +
        `KUNDE INTE VERIFIERAS – KONTROLLERA MANUELLT\n\n` +
        ctaLines(ctaResult.unverifiedLinks),
    });

  } else {

    results.push({
      name: "CTA",
      status: "PASS",
      message:
        `${ctaResult.passed} CTA-destinationer fungerar`,
    });
  }


  }


  // =======================================================
  // 17. SOCIALA MEDIER
  // =======================================================

  if (enabled("social")) {


  console.log("\n--- SOCIALA MEDIER ---");

  reportProgress(
    79,
    "Kontrollerar sociala medier..."
  );

  const socialMediaResult =
    await checkSocialMedia(
      page,
      pages,
      url
    );

  // Samla länkar från matchande, saknade och overifierade profiler.
  const socialMediaLinks = [
    ...socialMediaResult.found.map((item) => ({
      url: item.url,
      label: "Matchande profil",
    })),
    ...socialMediaResult.failed.map((item) => ({
      url: item.url,
      label: "Profil som inte finns",
    })),
    ...socialMediaResult.unverified.map((item) => ({
      url: item.url,
      label: "Profil som kräver manuell verifiering",
    })),
  ].filter((item) => item.url);

  results.push({
    name: "Sociala medier",
    status:
      socialMediaResult.failed.length > 0
        ? "FAIL"
        : socialMediaResult.unverified.length > 0
          ? "WARNING"
          : "PASS",
    message: [
      socialMediaResult.found.length +
        socialMediaResult.failed.length +
        socialMediaResult.unverified.length ===
      0
        ? "Inga sociala medier hittades på webbplatsen"
        : `${socialMediaResult.found.length} sociala medier matchar webbplatsen`,
      ...(socialMediaResult.failed.length > 0
        ? [
            `${socialMediaResult.failed.length} sociala medier finns inte (profilen gav 404)`,
          ]
        : []),
      ...(socialMediaResult.unverified.length > 0
        ? [
            `${socialMediaResult.unverified.length} sociala medier kräver manuell verifiering`,
          ]
        : []),
      ...socialMediaLinks.map(
        (item) => `${item.label}: ${item.url}`
      ),
      ...socialMediaResult.found.map(
        (item) => `Kopplingen för ${item.platform}: ${item.reason}`
      ),
      ...socialMediaResult.unverified.map(
        (item) => `Kräver manuell verifiering – ${item.platform}: ${item.message}`
      ),
      ...socialMediaResult.failed.map(
        (item) => `Profil som inte finns – ${item.platform}: ${item.message}`
      ),
    ].join("\n"),
  });


  }


  // =======================================================
  // 18. GOOGLE MAPS
  // =======================================================

  if (enabled("maps")) {


  console.log("\n--- GOOGLE MAPS ---");

  reportProgress(
    82,
    "Kontrollerar Google Maps..."
  );

  const googleMapsResult =
    await checkGoogleMaps(
      page,
      pages
    );

  // Ta endast med faktiska, icke-tomma URL:er.
  const googleMapsLinks = [
    ...new Set(
      googleMapsResult.found.filter(
        (item) =>
          typeof item === "string" &&
          item.trim().length > 0
      )
    ),
  ];

  results.push({
    name: "Google Maps",
    status:
      googleMapsLinks.length > 0
        ? "PASS"
        : "WARNING",
    message: [
      googleMapsLinks.length > 0
        ? `${googleMapsLinks.length} Google Maps-länkar hittades`
        : "Ingen Google Maps-förekomst hittades",
      ...googleMapsLinks,
    ].join("\n"),
  });


  }


  // =======================================================
  // 19. GOOGLE BUSINESS PROFILE
  // =======================================================

  if (enabled("gbp")) {


  console.log("\n--- GOOGLE BUSINESS PROFILE ---");

  reportProgress(
    85,
    "Kontrollerar Google Business Profile..."
  );

  const googleBusinessProfileResult =
    await checkGoogleBusinessProfile(
      page,
      pages
    );

  // Samla hittade profiler och matchningar via Google Maps.
  const businessProfileLinks = [
    ...googleBusinessProfileResult.found,
    ...googleBusinessProfileResult.mapsMatches.map(
      (item) => item.url
    ),
  ].filter(
    (item) =>
      typeof item === "string" &&
      item.trim().length > 0
  );

  const uniqueBusinessProfileLinks = [
    ...new Set(businessProfileLinks),
  ];

  if (
    googleBusinessProfileResult.failed.length > 0
  ) {
    results.push({
      name: "Google Business Profile",
      status: "FAIL",
      message: [
        `${googleBusinessProfileResult.failed.length} Google-profiler kunde inte bekräftas`,
        ...googleBusinessProfileResult.failed.map(
          (item) =>
            `Profil som inte kunde bekräftas: ${item.url}`
        ),
        ...uniqueBusinessProfileLinks,
      ].join("\n"),
    });
  } else if (
    uniqueBusinessProfileLinks.length > 0
  ) {
    results.push({
      name: "Google Business Profile",
      status: "PASS",
      message: [
        `${uniqueBusinessProfileLinks.length} Google Business Profile- eller Maps-länkar hittades`,
        ...uniqueBusinessProfileLinks,
      ].join("\n"),
    });
  } else {
    results.push({
      name: "Google Business Profile",
      status: "WARNING",
      message:
        "Ingen direkt Google Business Profile-länk kunde verifieras",
    });
  }


  }


  // =======================================================
  // 20. AI-ANALYS
  // =======================================================

  console.log("\n--- AI-ANALYS ---");

  reportProgress(
    88,
    "Analyserar QA-resultatet med AI..."
  );

  let aiAnalysis = enabled("ai")
    ? "AI-analys kunde inte genomföras."
    : "";

  if (enabled("ai")) {

  try {

    aiAnalysis =
      await analyzeQAResults(results);

    console.log(aiAnalysis);

  } catch (error) {

    console.log(
      "⚠ AI-analysen kunde inte genomföras."
    );

    results.push({
      name: "AI-analys",
      status: "WARNING",
      message:
        "AI-analysen kunde inte genomföras",
    });
  }
  }



  // =======================================================
  // 21. QA-RAPPORT
  // =======================================================

  reportProgress(
    94,
    "Sammanställer QA-rapport..."
  );

  printQAReport(
    url,
    results
  );


  // =======================================================
  // KLAR
  // =======================================================

  reportProgress(
    100,
    "QA-analysen är klar."
  );


  // =======================================================
  // RETURNERA RESULTAT
  // =======================================================

  return {
    url: pageResult.url,
    status: pageResult.status,
    title: pageResult.title,
    links: pageResult.links,
    pages: pageResult.pages,
    results,
    aiAnalysis,

    // Vilka tester som valdes för den här körningen.
    selectedTests: [...selectedTests],
    allTestsSelected: selectedTests.size === ALL_QA_TEST_IDS.length,
  };
}
import { Page } from "@playwright/test";
import { checkCTA } from "./checks/cta";
import { checkPages, PageProgress } from "./checks/pages";
import { checkLinks } from "./checks/links";
import { checkSocialMedia } from "./checks/social-media";
import { checkImages } from "./checks/images";
import { checkForms } from "./checks/forms";
import { checkValidation } from "./checks/validation";
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
// WEBSITE QA SYSTEM
// =========================================================

// Startar en komplett QA-skanning av webbplatsen.
export async function scanWebsite(
  page: Page,
  url: string,
  onProgress?: ScanProgressCallback
) {

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


  // =======================================================
  // 2. SEO
  // =======================================================

  console.log("\n--- SEO ---");

  reportProgress(
    32,
    "Analyserar SEO..."
  );

  const seoResult = await checkSEO(
    page,
    pages
  );

  if (seoResult.failed.length > 0) {

    const seoDetails =
      seoResult.failed
        .map((error) => `- ${error}`)
        .join("\n");

    results.push({
      name: "SEO",
      status: "FAIL",
      message:
        `${seoResult.failed.length} tekniska SEO-fel hittades\n` +
        seoDetails,
    });

  } else if (seoResult.warnings.length > 0) {

    const seoDetails =
      seoResult.warnings
        .map((warning) => `- ${warning}`)
        .join("\n");

    results.push({
      name: "SEO",
      status: "WARNING",
      message:
        `${seoResult.warnings.length} SEO-varningar hittades\n` +
        seoDetails,
    });

  } else {

    results.push({
      name: "SEO",
      status: "PASS",
      message:
        `${seoResult.passed.length} SEO-kontroller godkända`,
    });
  }


  // =======================================================
  // 3. PRESTANDA
  // =======================================================

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


  // =======================================================
  // 4. RESPONSIVITET
  // =======================================================

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


  // =======================================================
  // 5. COOKIE / GDPR
  // =======================================================

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


  // =======================================================
  // 6. HTTPS / SECURITY
  // =======================================================

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


  // =======================================================
  // 7. ALTERNATIVA DOMÄNER
  // =======================================================

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


  // =======================================================
  // 8. HÄMTAR FÖRETAGSNAMN
  // =======================================================

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


  // =======================================================
  // 10. TEXT / STAVNING
  // =======================================================

  console.log("\n--- TEXT / STAVNING ---");

  reportProgress(
    54,
    "Kontrollerar text och stavning..."
  );


  // =======================================================
  // HÄMTA TEXT FRÅN ALLA SIDOR
  // =======================================================

  // Sparar alla textfel från alla crawlade sidor.
  const textIssues: TextIssue[] = [];
  // Sparar sidor där texten inte kunde hämtas.
const failedTextPages: string[] = [];

// Sparar sidor där LanguageTool-kontrollen misslyckades.
const failedLanguageToolPages: string[] = [];


  // Räknar hur många sidor som faktiskt kontrolleras.
  const totalTextPages = pages.length;


  // Sparar den hämtade texten från varje sida.
  //
  // Vi behöver texten först för att kunna
  // analysera hela webbplatsen tillsammans.
  const pageTexts =
    new Map<string, string>();



  // Går igenom alla sidor som crawlern hittade.
  for (
    let i = 0;
    i < pages.length;
    i++
  ) {
    const pageUrl = pages[i];

    console.log(
      `\nHämtar text ${i + 1}/${totalTextPages}: ${pageUrl}`
    );

    try {
      // Öppnar sidan som ska kontrolleras.
      await page.goto(pageUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });

      // Tar bort Google-recensioner från textkontrollen.
      await page.evaluate(() => {
        const elements = Array.from(
          document.querySelectorAll("body *")
        );

        for (const element of elements) {
          const text =
            element.textContent?.trim() || "";

          if (
            text.includes("Publicerat på Google") &&
            text.length < 5000
          ) {
            let parent = element.parentElement;

            for (
              let i = 0;
              i < 6 && parent;
              i++
            ) {
              const parentText =
                parent.textContent?.trim() || "";

              if (
                parentText.includes("Publicerat på Google") &&
                parentText.length < 10000
              ) {
                parent.remove();
                break;
              }

              parent = parent.parentElement;
            }
          }
        }
      });

      // Tar bort element som inte ska textkontrolleras.
      const pageText = await page.evaluate(() => {
        const selectorsToRemove = [
          "script",
          "style",
          "noscript",
          "nav",
          "header",
          "footer",
          '[role="navigation"]',
          '[aria-label*="cookie" i]',
          '[id*="cookie" i]',
          '[class*="cookie" i]',
          '[id*="review" i]',
          '[class*="review" i]',
        ];

        document
          .querySelectorAll(selectorsToRemove.join(","))
          .forEach((element) => element.remove());

        return document.body?.innerText ?? "";
      });

      // Sparar texten från sidan.
      pageTexts.set(pageUrl, pageText);

      // Uppdaterar progress.
      const textProgress =
        54 +
        Math.round(
          ((i + 1) / totalTextPages) * 1
        );

      reportProgress(
        textProgress,
        `Hämtar text ${i + 1}/${totalTextPages}...`
      );
    } catch (error) {
      // Ett fel på en sida ska inte stoppa hela skanningen.
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

  // Räknar hur många olika sidor varje ord
  // förekommer på.
  //
  // Vi räknar sidor och inte antal förekomster
  // på samma sida. Det gör kontrollen mer stabil.
  const siteWordFrequency =
    new Map<string, number>();


  for (
    const pageText
    of pageTexts.values()
  ) {

    // Hämtar ord från sidan.
    //
    // Svenska bokstäver inkluderas så att exempelvis
    // branschord med å, ä och ö behandlas korrekt.
    const words =
      pageText
        .toLowerCase()
        .match(/[a-zåäöéü]+/gi) || [];


    // Ett ord räknas endast en gång per sida.
    const uniqueWords =
      new Set(words);


    for (const word of uniqueWords) {

      // Ignorerar mycket korta ord.
      if (
        word.length < 5
      ) {
        continue;
      }


      const currentCount =
        siteWordFrequency.get(word) || 0;


      siteWordFrequency.set(
        word,
        currentCount + 1
      );
    }
  }


  // Visar några grundläggande uppgifter
  // om frekvenskontrollen i terminalen.
  console.log(
    `\n✓ ${siteWordFrequency.size} unika ord analyserades på webbplatsen`
  );


  // =======================================================
  // LANGUAGE TOOL
  // =======================================================

  // Nu när vi vet vilka ord som återkommer
  // på webbplatsen kan vi köra LanguageTool.
  for (
    let i = 0;
    i < pages.length;
    i++
  ) {

    const pageUrl = pages[i];


    // Hämtar tidigare sparad text.
    const pageText =
      pageTexts.get(pageUrl) || "";


    console.log(
      `\nAnalyserar text ${i + 1}/${totalTextPages}: ${pageUrl}`
    );


    try {

      // Skickar texten till LanguageTool.
      //
      // Vi skickar även med:
      // - URL
      // - frekvensdata från hela webbplatsen
      const textCheckResult =
        await checkText(
          pageText,
          "sv",
          pageUrl,
          siteWordFrequency
        );


      // Lägger till alla hittade fel i den
      // gemensamma listan.
      textIssues.push(
        ...textCheckResult.issues
      );


      // ---------------------------------------------------
      // PROGRESS
      // ---------------------------------------------------

      // Den andra delen av textkontrollen använder
      // området 55-56 %.
      const textProgress =
        55 +
        Math.round(
          ((i + 1) / totalTextPages) * 1
        );


      reportProgress(
        textProgress,
        `Analyserar text ${i + 1}/${totalTextPages}...`
      );


    } catch (error) {

      // Ett problem med en enskild sida ska inte
      // stoppa hela QA-skanningen.
      console.log(
        `⚠ Kunde inte analysera text på: ${pageUrl}`
      );

      console.log(
        error
      );
    }
  }
 // -------------------------------------------------------
// TEXTRESULTAT
// -------------------------------------------------------

// AI:n granskar LanguageTools träffar.
const aiReviewedIssues = await reviewTextIssues(textIssues);

// Formaterar ett textfynd för PDF-rapporten.
const formatIssue = (
issue: (typeof aiReviewedIssues)[number]
): string => {
let classification: string;

if (issue.aiAssessment === "LIKELY_SPELLING") {
classification = "AI bedömer texten som sannolikt stavfel";
} else {
classification = "Osäker träff – behöver granskas";
}

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
(
issue.aiExplanation
? `  AI-bedömning: ${issue.aiExplanation}\n`
: ""
) +
`  LanguageTool-regel: ${issue.ruleId}\n` +
`  Typ: ${issue.issueType}`
);
};

// Ta endast med sannolika stavfel och osäkra träffar.
// LIKELY_CORRECT ska inte visas i PDF-rapporten.
const reportIssues = aiReviewedIssues.filter(
(issue) => issue.aiAssessment !== "LIKELY_CORRECT"
);

const reportSpellingIssues = reportIssues.filter(
(issue) => issue.aiAssessment === "LIKELY_SPELLING"
);

const reportUncertainIssues = reportIssues.filter(
(issue) => issue.aiAssessment === "REVIEW"
);

const sections: string[] = [
`Antal sannolika stavfel: ${reportSpellingIssues.length}`,
`Antal osäkra träffar: ${reportUncertainIssues.length}`,
];

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

if (reportIssues.length > 0) {
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
"AI-granskningen hittade inga sannolika stavfel eller osäkra träffar.",
});
}

  // =======================================================
  // 11. LÄNKAR
  // =======================================================

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


  // =======================================================
  // 12. BILDER
  // =======================================================

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


  // =======================================================
  // 13. FORMULÄR
  // =======================================================

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


  // =======================================================
  // 14. FORMULÄRVALIDERING
  // =======================================================

  console.log("\n--- VALIDERING ---");

  reportProgress(
    65,
    "Kontrollerar formulärvalidering..."
  );

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
    }
  );

  if (validationResult.emailFailed > 0) {

    results.push({
      name: "Validering",
      status: "FAIL",
      message:
        `${validationResult.emailFailed} e-postfält accepterar ogiltig e-post`,
    });

  } else if (validationResult.phoneFailed > 0) {

    results.push({
      name: "Validering",
      status: "WARNING",
      message:
        `${validationResult.phoneFailed} telefonfält saknar client-side validering`,
    });

  } else {

    results.push({
      name: "Validering",
      status: "PASS",
      message:
        "Formulärvalidering fungerar",
    });
  }


  // =======================================================
  // 15. NAVIGATION
  // =======================================================

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

  if (navigationResult.failed === 0) {

    results.push({
      name: "Navigation",
      status: "PASS",
      message:
        `${navigationResult.passed} interna navigationer fungerar`,
    });

  } else {

    results.push({
      name: "Navigation",
      status: "FAIL",
      message:
        `${navigationResult.failed} interna navigationer fungerar inte`,
    });
  }


  // =======================================================
  // 16. CTA
  // =======================================================

  console.log("\n--- CTA ---");

  reportProgress(
    76,
    "Kontrollerar CTA-knappar och länkar..."
  );

  const ctaResult = await checkCTA(
    page,
    pages
  );

  if (ctaResult.failed === 0) {

    results.push({
      name: "CTA",
      status: "PASS",
      message:
        `${ctaResult.passed} CTA-länkar fungerar`,
    });

  } else {

    results.push({
      name: "CTA",
      status: "FAIL",
      message:
        `${ctaResult.failed} CTA-länkar fungerar inte`,
    });
  }


  // =======================================================
  // 17. SOCIALA MEDIER
  // =======================================================

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

  if (socialMediaResult.failed.length > 0) {

    results.push({
      name: "Sociala medier",
      status: "FAIL",
      message:
        `${socialMediaResult.failed.length} sociala medier verkar inte tillhöra företaget`,
    });

  } else {

    results.push({
      name: "Sociala medier",
      status: "PASS",
      message:
        `${socialMediaResult.found.length} sociala medier hittades och matchar webbplatsen`,
    });
  }


  // =======================================================
  // 18. GOOGLE MAPS
  // =======================================================

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

  if (googleMapsResult.found.length > 0) {

    results.push({
      name: "Google Maps",
      status: "PASS",
      message:
        `${googleMapsResult.found.length} Google Maps-förekomster hittades`,
    });

  } else {

    results.push({
      name: "Google Maps",
      status: "WARNING",
      message:
        "Ingen Google Maps-förekomst hittades",
    });
  }


  // =======================================================
  // 19. GOOGLE BUSINESS PROFILE
  // =======================================================

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

  if (
    googleBusinessProfileResult.failed.length > 0
  ) {

    results.push({
      name: "Google Business Profile",
      status: "FAIL",
      message:
        `${googleBusinessProfileResult.failed.length} Google-profiler kunde inte bekräftas`,
    });

  } else if (
    googleBusinessProfileResult.found.length > 0
  ) {

    results.push({
      name: "Google Business Profile",
      status: "PASS",
      message:
        `${googleBusinessProfileResult.found.length} Google-profiler hittades och matchar företaget`,
    });

  } else if (
    googleBusinessProfileResult.mapsMatches.length > 0
  ) {

    results.push({
      name: "Google Business Profile",
      status: "PASS",
      message:
        "Google Business Profile matchar företaget via Google Maps",
    });

  } else {

    results.push({
      name: "Google Business Profile",
      status: "WARNING",
      message:
        "Ingen direkt Google Business Profile-länk kunde verifieras",
    });
  }


  // =======================================================
  // 20. AI-ANALYS
  // =======================================================

  console.log("\n--- AI-ANALYS ---");

  reportProgress(
    88,
    "Analyserar QA-resultatet med AI..."
  );

  let aiAnalysis =
    "AI-analys kunde inte genomföras.";

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
  };
}
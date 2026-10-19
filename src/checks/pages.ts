import { Page, Response as PlaywrightResponse } from "@playwright/test";

// =========================================================
// TYPES
// =========================================================

// Information som skickas tillbaka medan crawlern arbetar.
export interface PageProgress {
  // Antal sidor som redan har analyserats.
  current: number;

  // Antal sidor som hittills har upptäckts.
  discovered: number;

  // Text som kan visas i popupen.
  message: string;
}


// Filändelser som inte är webbsidor. Dessa ska inte crawlas
// som sidor eftersom de saknar H1, meta description, canonical
// osv. och annars ger falska SEO-varningar.
const NON_PAGE_EXTENSIONS = new Set([
  // Bilder
  "png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "ico", "bmp", "tif", "tiff",
  // Dokument
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "csv", "txt", "rtf",
  // Arkiv
  "zip", "rar", "7z", "gz", "tar",
  // Media
  "mp3", "wav", "ogg", "mp4", "webm", "mov", "avi", "mkv",
  // Webbresurser
  "css", "js", "mjs", "json", "xml", "map",
  // Typsnitt
  "woff", "woff2", "ttf", "otf", "eot",
]);

// Returnerar true om HTTP-statusen räknas som en fungerande sida.
// 202 räknas inte: det betyder oftast en challenge-/anti-bot-sida
// (t.ex. SiteGround) och inte den riktiga sidan.
function isWorkingStatus(status: number): boolean {
  return (
    status >= 200 &&
    status < 400 &&
    status !== 202
  );
}

// Returnerar true om URL:en pekar på en fil i stället för en sida.
function isNonPageUrl(rawUrl: string): boolean {
  try {
    const pathname = new URL(rawUrl).pathname.toLowerCase();
    const lastSegment = pathname.split("/").pop() ?? "";
    const dotIndex = lastSegment.lastIndexOf(".");

    if (dotIndex === -1) {
      return false;
    }

    return NON_PAGE_EXTENSIONS.has(
      lastSegment.slice(dotIndex + 1)
    );
  } catch {
    return false;
  }
}


// Väntar tills sidan har slutat navigera (t.ex. SiteGrounds
// anti-bot-sida som svarar 202 och sedan laddar om sig själv).
async function waitForStablePage(page: Page) {
  try {
    await page.waitForLoadState("load", { timeout: 15000 });
    await page.waitForLoadState("networkidle", { timeout: 10000 });
  } catch {
    // Går vidare även om sidan aldrig blir helt "idle".
  }
}


// =========================================================
// CRAWLER
// =========================================================

// Kontrollerar och crawlar webbplatsens sidor.
//
// onProgress används för att skicka riktig progress
// vidare till website-scanner -> API -> extension.
export async function checkPages(
  page: Page,
  url: string,
  onProgress?: (progress: PageProgress) => void
) {

  // Hämtar webbplatsens domän.
  const origin = new URL(url).origin;


  // =========================================================
  // URL-NORMALISERING
  // =========================================================

  // Normaliserar URL:er så att exempelvis
  // / och /#section räknas som samma sida.
  function normalizeUrl(rawUrl: string): string {

    // Skapar ett URL-objekt.
    const parsedUrl = new URL(rawUrl);

    // Tar bort anchors.
    parsedUrl.hash = "";

    // Startsidan ska inte ha ett extra /.
    if (parsedUrl.pathname === "/") {
      parsedUrl.pathname = "";
    }

    // Returnerar den normaliserade URL:en.
    return parsedUrl.toString();
  }


  // =========================================================
  // CRAWLER-KÖ
  // =========================================================

  // Kö med sidor som ska besökas.
  const pagesToVisit: string[] = [
    normalizeUrl(url),
  ];

  // Håller koll på sidor som redan har besökts.
  const visitedPages = new Set<string>();

  // Sparar resultatet för varje sida.
  const pageResults: {
    url: string;
    status: number;
    working: boolean;
  }[] = [];


  // Visar information i terminalen.
  console.log("\nWebsite:", url);


  // Skickar första progress-eventet direkt.
  onProgress?.({
    current: 0,
    discovered: pagesToVisit.length,
    message: "Förbereder crawling...",
  });


  // =========================================================
  // CRAWLING
  // =========================================================

  // Sparar status för den senaste navigeringen i huvudframen.
  // Används när en challenge-sida (202) laddar om sig själv och
  // den riktiga sidan svarar efteråt med t.ex. 200.
  let lastNavigationStatus = 0;

  const onNavigationResponse = (
    navResponse: PlaywrightResponse
  ) => {
    if (
      navResponse.request().isNavigationRequest() &&
      navResponse.frame() === page.mainFrame()
    ) {
      lastNavigationStatus = navResponse.status();
    }
  };

  page.on("response", onNavigationResponse);


  // Fortsätter så länge det finns sidor kvar att besöka.
  while (pagesToVisit.length > 0) {

    // Tar nästa sida från kön.
    const currentUrl = pagesToVisit.shift();

    // Hoppar över om URL saknas.
    if (!currentUrl) {
      continue;
    }

    // Hoppar över sidor som redan har besökts.
    if (visitedPages.has(currentUrl)) {
      continue;
    }

    // Markerar sidan som besökt.
    visitedPages.add(currentUrl);


    // =========================================================
    // ÖPPNA SIDAN
    // =========================================================

    let responseStatus = 0;
    let pageLoaded = false;
    let skippedNonHtml = false;

    // Försöker öppna sidan upp till tre gånger.
    for (let attempt = 1; attempt <= 3; attempt++) {

      try {

        lastNavigationStatus = 0;

        // Försöker öppna sidan.
        const response = await page.goto(
          currentUrl,
          {
            waitUntil: "domcontentloaded",
            timeout: 30000,
          }
        );

        // Hämtar HTTP-status.
        responseStatus =
          response?.status() ?? 0;

        // Om svaret inte är HTML (t.ex. en PDF eller bild utan
        // filändelse i URL:en) räknas det inte som en sida.
        const contentType =
          response?.headers()["content-type"] ?? "";

        if (
          contentType &&
          !contentType.includes("text/html") &&
          !contentType.includes("application/xhtml")
        ) {
          skippedNonHtml = true;
          break;
        }

        // 202 betyder oftast en challenge-sida som navigerar
        // vidare av sig själv. Vänta (max ~12 s) och använd
        // statusen från den riktiga sidan när den har laddats.
        // Om challengen aldrig löses förblir statusen 202 och
        // sidan räknas som att den inte fungerar.
        if (responseStatus === 202) {

          for (let wait = 0; wait < 6; wait++) {

            await page.waitForTimeout(2000);

            const onChallengePage =
              page.url().includes("/.well-known/sgcaptcha");

            if (
              lastNavigationStatus !== 0 &&
              lastNavigationStatus !== 202 &&
              !onChallengePage
            ) {
              responseStatus = lastNavigationStatus;
              break;
            }
          }
        }

        await waitForStablePage(page);

        // Sidan kunde öppnas.
        pageLoaded = true;

        break;

      } catch {

        // Visar att försöket misslyckades.
        console.log(
          `⚠ Kunde inte öppna ${currentUrl} - försök ${attempt}/3`
        );

        // Väntar lite innan nästa försök.
        if (attempt < 3) {
          await page.waitForTimeout(1000);
        }
      }
    }


    // Filer som inte är HTML ska inte med i resultatet.
    if (skippedNonHtml) {
      console.log(`↷ Hoppar över fil (inte HTML): ${currentUrl}`);
      continue;
    }


    // =========================================================
    // SPARA RESULTAT
    // =========================================================

    // Sparar resultatet för den aktuella sidan.
    pageResults.push({
      url: currentUrl,
      status: responseStatus,
      working:
        pageLoaded &&
        isWorkingStatus(responseStatus),
    });


    // =========================================================
    // LOGGA RESULTAT
    // =========================================================

    if (
      pageLoaded &&
      isWorkingStatus(responseStatus)
    ) {

      console.log(
        `✓ ${currentUrl} - ${responseStatus}`
      );

    } else {

      console.log(
        `✗ ${currentUrl} - ${
          responseStatus === 202
            ? "202 (challenge/anti-bot-sida, inte den riktiga sidan)"
            : responseStatus || "Request failed"
        }`
      );
    }


    // =========================================================
    // HÄMTA NYA LÄNKAR
    // =========================================================

    // Om sidan inte kunde öppnas efter tre försök
    // finns det inga länkar att hämta från sidan.
    if (pageLoaded) {

      // Hämtar alla interna länkar från sidan.
      // Försöker flera gånger om sidan navigerar under tiden.
      let links: string[] = [];

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await waitForStablePage(page);

          links =
            await page.locator("a[href]").evaluateAll(
          (elements, origin) =>
            elements
              .map((element) => {

                // Hämtar länken.
                const href = (
                  element as HTMLAnchorElement
                ).href;

                try {

                  // Gör om länken till en URL.
                  const linkUrl = new URL(href);

                  // Tar bort # från URL:en.
                  linkUrl.hash = "";

                  return linkUrl.toString();

                } catch {

                  // Hoppar över URL:er som inte kan läsas.
                  return null;
                }
              })

              // Behåller bara giltiga URL:er.
              .filter(
                (href): href is string =>
                  href !== null
              )

              // Behåller bara länkar från samma webbplats.
// HTTP och HTTPS ska räknas som samma webbplats.
.filter((href) => {
  try {
    return (
      new URL(href).hostname ===
      new URL(origin).hostname
    );
  } catch {
    return false;
  }
}),

          // Skickar med webbplatsens domän.
          origin
        );

          break;

        } catch {
          if (attempt === 3) {
            console.log(
              `⚠ Kunde inte läsa länkar från ${currentUrl}`
            );
          } else {
            await page.waitForTimeout(1500);
          }
        }
      }


      // Normaliserar URL:er.
      const normalizedLinks =
        links.map((link) =>
          normalizeUrl(link)
        );


      // Tar bort duplicerade länkar.
      const uniqueLinks = [
        ...new Set(normalizedLinks),
      ];


      // Lägger till nya sidor i kön.
      for (const link of uniqueLinks) {

        // Lägg bara till sidan om den inte redan
        // har besökts eller ligger i kön.
        // Hoppar över bilder, PDF:er och andra filer.
        if (isNonPageUrl(link)) {
          continue;
        }

        if (
          !visitedPages.has(link) &&
          !pagesToVisit.includes(link)
        ) {

          pagesToVisit.push(link);
        }
      }
    }


    // =========================================================
    // RIKTIG PROGRESS
    // =========================================================

    // Antalet sidor som faktiskt har analyserats.
    const current =
      pageResults.length;

    // Antalet sidor som crawlern hittills känner till.
    const discovered =
      visitedPages.size +
      pagesToVisit.length;

    // Skickar riktig progress vidare.
    //
    // Vi använder INGEN timer och INGEN slumpmässig
    // procent. Informationen kommer direkt från crawlern.
    onProgress?.({
      current,
      discovered,
      message:
        `${current} av ${discovered} sidor analyserade`,
    });


    // Visar även progress i terminalen.
    console.log(
      `Crawling progress: ${current}/${discovered}`
    );
  }


  // Slutar lyssna på navigeringar.
  page.off("response", onNavigationResponse);


  // =========================================================
  // CRAWLING KLAR
  // =========================================================

  // När kön är tom vet vi att crawlern har hittat
  // och analyserat alla sidor den kan nå.
  const totalPages =
    pageResults.length;


  // Skickar 100 % för själva crawling-fasen.
  onProgress?.({
    current: totalPages,
    discovered: totalPages,
    message:
      `${totalPages} av ${totalPages} sidor analyserade`,
  });


  // =========================================================
  // HÄMTA STARTSIDANS TITEL
  // =========================================================

  // Öppnar startsidan igen för att hämta dess titel.
  await page.goto(url);

  // Hämtar sidans titel.
  const title = await page.title();


  // =========================================================
  // PAGE SUMMARY
  // =========================================================

  // Räknar fungerande sidor.
  const passedPages =
    pageResults.filter(
      (result) => result.working
    ).length;


  // Räknar sidor som inte fungerar.
  const failedPages =
    pageResults.filter(
      (result) => !result.working
    ).length;


  // Visar alla hittade sidor.
  console.log("\nPages found:");

  pageResults.forEach((result) => {
    console.log("-", result.url);
  });


  // Visar sammanfattning.
  console.log("\nPage summary:");

  console.log(
    `Pages: ${passedPages} passed, ${failedPages} failed`
  );


  // =========================================================
  // RETURNERA RESULTAT
  // =========================================================

  // Returnerar resultatet till QA-systemet.
  return {
    url,
    status:
      pageResults[0]?.status ?? 0,
    title,

    // Lista över alla hittade URL:er.
    links:
      pageResults.map(
        (result) => result.url
      ),

    // Fullständiga resultat för varje sida.
    pages: pageResults,

    // Antal fungerande sidor.
    passedPages,

    // Antal sidor som inte fungerar.
    failedPages,
  };
}
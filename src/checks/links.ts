import { Page } from "@playwright/test";
import { parsePhoneNumberFromString } from "libphonenumber-js";

/**
 * Beskriver ett länkningsfel.
 */
export interface LinkFailure {
  sourcePage: string;
  url: string;
  type: "intern" | "extern" | "telefon";
  status?: number;
  error: string;
}

/**
 * Beskriver ett möjligt fel i länkens syfte.
 */
export interface LinkIntentFailure {
  sourcePage: string;
  linkText: string;
  expected: string;
  targetUrl: string;
  targetTitle: string;
  targetHeading: string;
}

/**
 * Resultat för en telefonlänk.
 */
export interface PhoneLinkResult {
  sourcePage: string;
  url: string;
  phoneNumber: string;
  type: "tel" | "callto";
  valid: boolean;
  error?: string;
}

/**
 * Samlat resultat från länkkontrollen.
 */
export interface LinkCheckResult {
  internalPassed: number;
  internalFailed: number;

  externalPassed: number;
  externalFailed: number;

  linkFailures: LinkFailure[];

  phoneLinks: PhoneLinkResult[];

  intentFailures: LinkIntentFailure[];
  intentFailed: number;
}

/**
 * Kontrollerar om ett telefonnummer är giltigt.
 *
 * Vi använder Sverige som standard eftersom systemet
 * främst används för svenska webbplatser.
 *
 * Kontrollen verifierar:
 * - att numret kan tolkas
 * - att numret följer en giltig nummerplan
 * - att formatet är giltigt
 *
 * Kontrollen verifierar INTE att numret faktiskt
 * tillhör en aktiv abonnent.
 */
function validatePhoneNumber(phoneNumber: string): {
  valid: boolean;
  error?: string;
} {
  try {
    // Tar bort whitespace runt numret.
    let cleaned = phoneNumber.trim();

    // Om numret använder internationellt format med 00,
    // konverterar vi det till +.
    if (cleaned.startsWith("00")) {
      cleaned = `+${cleaned.substring(2)}`;
    }

    // Försöker tolka numret som ett svenskt nummer.
    const parsed = parsePhoneNumberFromString(cleaned, "SE");

    // Om numret inte kunde tolkas är formatet felaktigt.
    if (!parsed) {
      return {
        valid: false,
        error: "Telefonnumret kunde inte tolkas",
      };
    }

    // Kontrollerar om numret följer en giltig nummerplan.
    if (!parsed.isValid()) {
      return {
        valid: false,
        error: "Telefonnumret följer inte en giltig svensk nummerplan",
      };
    }

    // Numret är giltigt.
    return {
      valid: true,
    };
  } catch {
    // Om något oväntat händer behandlas numret som ogiltigt.
    return {
      valid: false,
      error: "Telefonnumret kunde inte valideras",
    };
  }
}

/**
 * Kontrollerar en tel:- eller callto:-länk.
 *
 * Exempel:
 * tel:0701234567
 * tel:+46701234567
 * callto:0701234567
 */
function checkPhoneLink(
  sourcePage: string,
  url: string
): PhoneLinkResult {
  // Bestämmer vilken typ av telefonlänk det är.
  const type = url.toLowerCase().startsWith("callto:")
    ? "callto"
    : "tel";

  // Tar bort tel: eller callto: från länken.
  let phoneNumber = url
    .replace(/^tel:/i, "")
    .replace(/^callto:/i, "")
    .trim();

  // Tar bort eventuella parametrar efter telefonnumret.
  phoneNumber = phoneNumber.split("?")[0].split(";")[0];

  // Validerar själva telefonnumret.
  const validation = validatePhoneNumber(phoneNumber);

  return {
    sourcePage,
    url,
    phoneNumber,
    type,
    valid: validation.valid,
    error: validation.error,
  };
}

/**
 * Försöker avgöra vilket syfte en länk har baserat på länktexten.
 */
function detectLinkIntent(linkText: string): string | null {
  const text = linkText.toLowerCase().trim();

  // Offertrelaterade länkar.
  if (
    text.includes("offert") ||
    text.includes("prisförslag") ||
    text.includes("kostnadsförslag")
  ) {
    return "offert";
  }

  // Kontaktrelaterade länkar.
  if (
    text.includes("kontakt") ||
    text.includes("kontakta") ||
    text.includes("hör av dig")
  ) {
    return "kontakt";
  }

  // Om oss-relaterade länkar.
  if (
    text.includes("om oss") ||
    text.includes("om företaget") ||
    text.includes("vilka är vi")
  ) {
    return "om-oss";
  }

  // Tjänsterelaterade länkar.
  if (
    text.includes("tjänst") ||
    text.includes("tjänster") ||
    text.includes("vad vi gör") ||
    text.includes("våra tjänster")
  ) {
    return "tjanster";
  }

  // Referensrelaterade länkar.
  if (
    text.includes("referens") ||
    text.includes("referenser") ||
    text.includes("projekt") ||
    text.includes("tidigare arbeten")
  ) {
    return "referenser";
  }

  // Ingen tydlig intention hittades.
  return null;
}

/**
 * Kontrollerar om en URL verkar passa det förväntade syftet.
 *
 * Vi använder URL, title, H1 och en begränsad mängd
 * text från sidan för att minska risken för falska varningar.
 */
function destinationMatchesIntent(
  expectedIntent: string,
  targetUrl: string,
  targetTitle: string,
  targetHeading: string,
  bodyText: string
): boolean {
  const combinedText = `
    ${targetUrl}
    ${targetTitle}
    ${targetHeading}
    ${bodyText}
  `.toLowerCase();

  switch (expectedIntent) {
    case "offert":
      return (
        combinedText.includes("offert") ||
        combinedText.includes("prisförslag") ||
        combinedText.includes("kostnadsförslag")
      );

    case "kontakt":
      return (
        combinedText.includes("kontakt") ||
        combinedText.includes("kontakta") ||
        combinedText.includes("telefon") ||
        combinedText.includes("e-post") ||
        combinedText.includes("email")
      );

    case "om-oss":
      return (
        combinedText.includes("om oss") ||
        combinedText.includes("om företaget") ||
        combinedText.includes("vilka är vi")
      );

    case "tjanster":
      return (
        combinedText.includes("tjänst") ||
        combinedText.includes("tjänster") ||
        combinedText.includes("vad vi gör")
      );

    case "referenser":
      return (
        combinedText.includes("referens") ||
        combinedText.includes("referenser") ||
        combinedText.includes("projekt") ||
        combinedText.includes("tidigare arbeten")
      );

    default:
      return true;
  }
}
/**
 * Tar bort ANSI-koder från terminalutdata.
 * Förhindrar att kontrollkoder visas i felmeddelanden
 * och rapporter.
 */
function cleanTerminalCodes(value: string): string {
  return value
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\u009B[0-?]*[ -/]*[@-~]/g, "");
}

/**
 * Kontrollerar länkar på webbplatsen.
 */
export async function checkLinks(
  page: Page,
  url: string,
  pages: string[]
): Promise<LinkCheckResult> {
  let internalPassed = 0;
  let internalFailed = 0;

  let externalPassed = 0;
  let externalFailed = 0;

  const linkFailures: LinkFailure[] = [];
  const phoneLinks: PhoneLinkResult[] = [];
  const intentFailures: LinkIntentFailure[] = [];

  // Hämtar grunddomänen för webbplatsen.
  const baseUrl = new URL(url);

  /**
   * Kontrollerar om en URL är intern.
   */
  function isInternalLink(linkUrl: string): boolean {
    try {
      const parsedUrl = new URL(linkUrl);

      return parsedUrl.hostname === baseUrl.hostname;
    } catch {
      return false;
    }
  }

  /**
   * Går igenom alla sidor som crawlern hittat.
   */
  for (const sourcePage of pages) {
    try {
      // Öppnar sidan.
      await page.goto(sourcePage, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });

      
const links = await page.locator("a").evaluateAll((anchors) =>
  anchors.map((anchor) => ({
    href: (anchor as HTMLAnchorElement).href,
    text: (anchor.textContent || "").trim(),
  }))
);

      // Undviker att kontrollera exakt samma URL flera gånger
      // på samma sida.
      const checkedUrls = new Set<string>();

      for (const link of links) {
        const href = link.href;
        const linkText = link.text;

        // Hoppa över tomma länkar.
        if (!href) {
          continue;
        }

        // Hoppa över anchors på samma sida.
        if (href.startsWith("#")) {
          continue;
        }

        // Hoppa över JavaScript-länkar.
        if (href.toLowerCase().startsWith("javascript:")) {
          continue;
        }

        // ---------------------------------------------------------
        // TELEFONLÄNK
        // ---------------------------------------------------------

        if (
          href.toLowerCase().startsWith("tel:") ||
          href.toLowerCase().startsWith("callto:")
        ) {
          const phoneResult = checkPhoneLink(sourcePage, href);

          phoneLinks.push(phoneResult);

          if (phoneResult.valid) {
            console.log(
              `✓ Telefon: ${phoneResult.phoneNumber} (${sourcePage})`
            );
          } else {
            console.log(
              `✗ Ogiltig telefon: ${phoneResult.phoneNumber} (${sourcePage})`
            );
          }

          continue;
        }

        // ---------------------------------------------------------
        // E-POSTLÄNK
        // ---------------------------------------------------------

        // Mailto-länkar behöver inte HTTP-kontrolleras.
        if (href.toLowerCase().startsWith("mailto:")) {
          continue;
        }

        // ---------------------------------------------------------
        // HTTP / HTTPS
        // ---------------------------------------------------------

        if (
          !href.toLowerCase().startsWith("http://") &&
          !href.toLowerCase().startsWith("https://")
        ) {
          continue;
        }

        // Undvik samma URL flera gånger på samma sida.
        if (checkedUrls.has(href)) {
          continue;
        }

        checkedUrls.add(href);

        // Bestämmer om länken är intern eller extern.
        const internal = isInternalLink(href);

        let lastError: unknown;
        let linkChecked = false;

        // Försöker kontrollera länken högst två gånger.
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const response = await page.request.get(href, {
              timeout: 15000,
              failOnStatusCode: false,
            });

            const status = response.status();

            // HTTP-status 200-399 räknas som fungerande.
            if (status >= 200 && status < 400) {
              if (internal) {
                internalPassed++;
              } else {
                externalPassed++;
              }
            } else {
              // Länken svarar men med felaktig HTTP-status.
              if (internal) {
                internalFailed++;
              } else {
                externalFailed++;
              }

              linkFailures.push({
                sourcePage,
                url: href,
                type: internal ? "intern" : "extern",
                status,
                error: `HTTP ${status}`,
              });
            }

            linkChecked = true;
            break;
          } catch (error) {
            lastError = error;

            // Gör ett nytt försök efter det första misslyckandet.
            if (attempt === 1) {
              console.warn(`Nytt försök för länken: ${href}`);
            }
          }
        }

        // Registrerar felet om båda försöken misslyckades.
        if (!linkChecked) {
          const errorMessage =
            lastError instanceof Error
              ? lastError.message.replace(
                  /\u001B\[[0-?]*[ -/]*[@-~]/g,
                  ""
                )
              : "Okänt anslutningsfel";

          if (internal) {
            internalFailed++;
          } else {
            externalFailed++;
          }

          linkFailures.push({
            sourcePage,
            url: href,
            type: internal ? "intern" : "extern",
            error: errorMessage,
          });
        }

        // ---------------------------------------------------------
        // LINK INTENT
        // ---------------------------------------------------------

        // Link Intent används endast för interna länkar.
        if (!internal) {
          continue;
        }

        // Försök hitta länkens avsedda syfte.
        const expectedIntent = detectLinkIntent(linkText);

        // Om länktexten inte har en tydlig intention
        // behöver vi inte göra någon Intent-kontroll.
        if (!expectedIntent) {
          continue;
        }

        try {
          // Öppnar destinationen.
          const targetPage = await page.context().newPage();

          try {
            await targetPage.goto(href, {
              waitUntil: "domcontentloaded",
              timeout: 20000,
            });

            // Hämtar title.
            const targetTitle = await targetPage.title();

            // Hämtar första H1.
            const targetHeading = await targetPage
              .locator("h1")
              .first()
              .textContent()
              .catch(() => "");

            // Hämtar en begränsad mängd synlig text.
            const bodyText = await targetPage.locator("body").innerText();

            // Begränsar mängden text för att hålla kontrollen snabb.
            const limitedBodyText = bodyText.substring(0, 5000);

            // Kontrollerar om destinationen verkar passa länkens syfte.
            const matches = destinationMatchesIntent(
              expectedIntent,
              href,
              targetTitle,
              targetHeading || "",
              limitedBodyText
            );

            // Om destinationen inte verkar passa skapas en WARNING.
            if (!matches) {
              intentFailures.push({
                sourcePage,
                linkText,
                expected: expectedIntent,
                targetUrl: href,
                targetTitle,
                targetHeading: (targetHeading || "").trim(),
              });
            }
          } finally {
            // Stänger den tillfälliga sidan.
            await targetPage.close();
          }
        } catch {
          // Om destinationen inte kan öppnas har HTTP-kontrollen
          // redan registrerat ett eventuellt länkningsfel.
        }
      }
    } catch (error) {
      // Om själva källsidan inte kunde öppnas loggar vi felet.
      console.log(
        `✗ Kunde inte kontrollera länkar på ${sourcePage}:`,
        error
      );
    }
  }

  // Räknar antal giltiga och ogiltiga telefonlänkar.
  const validPhoneLinks = phoneLinks.filter(
    (phone) => phone.valid
  ).length;

  const invalidPhoneLinks = phoneLinks.filter(
    (phone) => !phone.valid
  ).length;

  // ---------------------------------------------------------
  // RESULTAT I TERMINALEN
  // ---------------------------------------------------------

  console.log("");
  console.log(
    `Internal links: ${internalPassed} passed, ${internalFailed} failed`
  );

  console.log(
    `External links: ${externalPassed} passed, ${externalFailed} failed`
  );

  console.log(
    `Phone links: ${validPhoneLinks} valid, ${invalidPhoneLinks} invalid`
  );

  console.log("");
  console.log("Link Intent summary:");

  if (intentFailures.length === 0) {
    console.log(
      "✓ Alla tydliga länkar verkar leda till rätt typ av sida."
    );
  } else {
    console.log(
      `⚠ ${intentFailures.length} möjliga felaktiga destinationer hittades.`
    );

    for (const failure of intentFailures) {
      console.log(
        `- "${failure.linkText}" → ${failure.expected}`
      );
      console.log(`  Destination: ${failure.targetUrl}`);
    }
  }

  // Visar detaljer för HTTP-fel.
  if (linkFailures.length > 0) {
    console.log("");
    console.log("Link failures:");

    for (const failure of linkFailures) {
      console.log(`- Sida: ${failure.sourcePage}`);
      console.log(`  Länk: ${failure.url}`);
      console.log(`  Typ: ${failure.type}`);

      if (failure.status) {
        console.log(`  Status: ${failure.status}`);
      }

      console.log(`  Fel: ${failure.error}`);
    }
  }

  // Visar detaljer för ogiltiga telefonnummer.
  if (invalidPhoneLinks > 0) {
    console.log("");
    console.log("Invalid phone links:");

    for (const phone of phoneLinks) {
      if (!phone.valid) {
        console.log(`- Sida: ${phone.sourcePage}`);
        console.log(`  Länk: ${phone.url}`);
        console.log(`  Nummer: ${phone.phoneNumber}`);
        console.log(`  Fel: ${phone.error || "Okänt fel"}`);
      }
    }
  }

  return {
    internalPassed,
    internalFailed,

    externalPassed,
    externalFailed,

    linkFailures,

    phoneLinks,

    intentFailures,
    intentFailed: intentFailures.length,
  };
}
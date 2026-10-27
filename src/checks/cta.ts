import { Page } from "@playwright/test";

// =========================================================
// GEMENSAM LÄNKVERIFIERING
// =========================================================
// Används av navigations- och CTA-kontrollerna.
//
// Ett enda misslyckat anrop räknas aldrig som ett trasigt mål.
// Många sajter svarar 403, 429 eller 503 på automatiska anrop
// även när sidan fungerar för besökare. Därför:
//
//   1. Anropet görs med en vanlig webbläsares headers.
//   2. 404/410 bekräftas med ett andra anrop innan länken
//      räknas som trasig.
//   3. Övriga fel provas om med paus (och Retry-After).
//   4. Fungerar det fortfarande inte öppnas länken i en riktig
//      webbläsarflik, som en besökare skulle göra.
//   5. Kan inget av detta avgöra saken blir resultatet
//      "unverified" (kräver manuell kontroll), aldrig "broken".
//
// Samma adress kontrolleras bara en gång per körning, så att
// sajten inte får tiotals anrop till samma länk (som i sig kan
// utlösa 429).

export type UrlVerdict =
  | "ok"          // fungerar
  | "broken"      // bekräftat trasig
  | "unverified"  // kunde inte avgöras automatiskt
  | "skipped";    // anropas inte (kan ha sidoeffekter)

export interface UrlCheckResult {
  url: string;
  verdict: UrlVerdict;
  status?: number;
  reason: string;
}

export interface UrlVerifierOptions {
  // Paus mellan försök. Kortare i tester.
  retryDelayMs?: number;

  // Tidsgräns för ett HTTP-anrop.
  requestTimeoutMs?: number;

  // Tidsgräns för kontroll i webbläsare.
  browserTimeoutMs?: number;

  // Minsta tid mellan anrop till samma värd.
  minIntervalMs?: number;
}

// Statuskoder som oftast betyder "bekräftat borta".
const GONE_STATUSES = [404, 410];

// Länkar som aldrig ska anropas automatiskt eftersom en GET kan
// ändra något (logga ut, lägga i varukorg, avprenumerera) eller
// inte är en sida (administration, flöden, stora filer).
const UNSAFE_URL_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /\/wp-admin(\/|$|\?)/i, reason: "administrationsgränssnitt" },
  { pattern: /\/wp-login\.php/i, reason: "inloggningssida" },
  { pattern: /xmlrpc\.php/i, reason: "API-fil" },
  {
    pattern: /[?&](add-to-cart|add_to_cart|remove_item|_wpnonce|unsubscribe)=/i,
    reason: "länk som kan ändra data",
  },
  {
    pattern: /[?&]action=(logout|delete|remove|unsubscribe)/i,
    reason: "länk som kan ändra data",
  },
  {
    pattern: /\/(logout|log-out|signout|sign-out|unsubscribe|avprenumerera)(\/|$|\?)/i,
    reason: "länk som kan ändra data",
  },
  { pattern: /\/feed\/?(\?|$)/i, reason: "flöde, inte en sida" },
  {
    pattern: /\.(zip|rar|7z|iso|exe|dmg|mp4|mov|avi|mkv)(\?|$)/i,
    reason: "stor fil",
  },
];

// Avgör om en adress får anropas automatiskt.
export function isSafeToRequest(url: string): {
  safe: boolean;
  reason?: string;
} {

  for (const rule of UNSAFE_URL_PATTERNS) {
    if (rule.pattern.test(url)) {
      return { safe: false, reason: rule.reason };
    }
  }

  return { safe: true };
}

// Förklarar en statuskod som inte är bekräftat trasig.
export function describeUnverifiedStatus(status: number): string {

  if (status === 401 || status === 403) {
    return `HTTP ${status} – sajten nekar automatiska förfrågningar`;
  }

  if (status === 429) {
    return "HTTP 429 – sajten begränsar antalet förfrågningar";
  }

  if (status === 999) {
    return "HTTP 999 – sajten blockerar automatiska förfrågningar";
  }

  if (status >= 500) {
    return `HTTP ${status} – serverfel som kan vara tillfälligt`;
  }

  return `HTTP ${status} – kunde inte bekräftas automatiskt`;
}

const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

interface RawResponse {
  status?: number;
  error?: string;
  retryAfterMs?: number;
}

export class UrlVerifier {

  private readonly cache = new Map<string, Promise<UrlCheckResult>>();

  private readonly lastRequestAt = new Map<string, number>();

  private readonly retryDelayMs: number;
  private readonly requestTimeoutMs: number;
  private readonly browserTimeoutMs: number;
  private readonly minIntervalMs: number;

  constructor(
    private readonly page: Page,
    options: UrlVerifierOptions = {}
  ) {
    this.retryDelayMs = options.retryDelayMs ?? 1500;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 20000;
    this.browserTimeoutMs = options.browserTimeoutMs ?? 25000;
    this.minIntervalMs = options.minIntervalMs ?? 250;
  }

  // Kontrollerar en adress. Samma adress kontrolleras bara en gång.
  verify(url: string): Promise<UrlCheckResult> {

    let key = url;

    try {
      const parsed = new URL(url);
      parsed.hash = "";
      key = parsed.toString();
    } catch {
      // Ogiltig adress hanteras i run().
    }

    let result = this.cache.get(key);

    if (!result) {
      result = this.run(key);
      this.cache.set(key, result);
    }

    return result;
  }

  private async run(url: string): Promise<UrlCheckResult> {

    const safety = isSafeToRequest(url);

    if (!safety.safe) {
      return {
        url,
        verdict: "skipped",
        reason: `anropas inte automatiskt (${safety.reason})`,
      };
    }

    try {
      new URL(url);
    } catch {
      return {
        url,
        verdict: "broken",
        reason: "ogiltig adress",
      };
    }

    // Försök 1.
    let last = await this.get(url);

    if (this.isOk(last)) {
      return { url, verdict: "ok", status: last.status, reason: "fungerar" };
    }

    // 404/410 bekräftas med ett andra anrop.
    if (last.status !== undefined && GONE_STATUSES.includes(last.status)) {

      await sleep(this.retryDelayMs);

      const second = await this.get(url);

      if (this.isOk(second)) {
        return { url, verdict: "ok", status: second.status, reason: "fungerar" };
      }

      if (
        second.status !== undefined &&
        GONE_STATUSES.includes(second.status)
      ) {
        return {
          url,
          verdict: "broken",
          status: second.status,
          reason: `HTTP ${second.status} – sidan finns inte (bekräftat vid andra försöket)`,
        };
      }

      last = second;
    }

    // Övriga fel: prova om med växande paus.
    for (let attempt = 1; attempt <= 2; attempt++) {

      const wait = Math.min(
        last.retryAfterMs ?? this.retryDelayMs * attempt,
        5000
      );

      await sleep(wait);

      last = await this.get(url);

      if (this.isOk(last)) {
        return {
          url,
          verdict: "ok",
          status: last.status,
          reason: "fungerar (vid nytt försök)",
        };
      }
    }

    // Domänen finns inte: bekräftat fel, ingen anledning att fråga
    // webbläsaren.
    if (last.error && /ENOTFOUND|ERR_NAME_NOT_RESOLVED/i.test(last.error)) {
      return {
        url,
        verdict: "broken",
        reason: "domänen finns inte",
      };
    }

    // Sista kontrollen: öppna länken som en besökare.
    return this.verifyInBrowser(url, last);
  }

  private isOk(response: RawResponse): boolean {
    return (
      response.status !== undefined &&
      response.status >= 200 &&
      response.status < 400
    );
  }

  // Ett HTTP-anrop med webbläsarens headers.
  private async get(url: string): Promise<RawResponse> {

    await this.throttle(url);

    try {

      // Standardvärden används medvetet. En egen User-Agent som inte
      // stämmer med webbläsarens övriga uppgifter får många sajters
      // skydd att blockera anropet.
      const response = await this.page.request.get(url, {
        timeout: this.requestTimeoutMs,
      });

      let retryAfterMs: number | undefined;

      const retryAfter = response.headers?.()["retry-after"];

      if (retryAfter && /^\d+$/.test(retryAfter)) {
        retryAfterMs = Number(retryAfter) * 1000;
      }

      return { status: response.status(), retryAfterMs };

    } catch (error) {

      return {
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Håller en liten paus mellan anrop till samma värd.
  private async throttle(url: string): Promise<void> {

    let host = "";

    try {
      host = new URL(url).host;
    } catch {
      return;
    }

    const last = this.lastRequestAt.get(host) ?? 0;
    const wait = last + this.minIntervalMs - Date.now();

    if (wait > 0) {
      await sleep(wait);
    }

    this.lastRequestAt.set(host, Date.now());
  }

  // Öppnar länken som en besökare. Körs sidan i en kontext som skapats
  // med browser.newPage() går det inte att öppna fler flikar
  // ("Please use browser.newContext()"). Då används den ordinarie sidan
  // i stället. Det är säkert, eftersom CTA-länkarna redan är inlästa.
  private async verifyInBrowser(
    url: string,
    last: RawResponse
  ): Promise<UrlCheckResult> {

    let verifyPage: Page = this.page;
    let isExtraTab = false;

    try {
      verifyPage = await this.page.context().newPage();
      isExtraTab = true;
    } catch {
      verifyPage = this.page;
    }

    try {

      const response = await verifyPage.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: this.browserTimeoutMs,
      });

      const status = response?.status();

      if (status !== undefined && status < 400) {
        return {
          url,
          verdict: "ok",
          status,
          reason: "fungerar (bekräftat i webbläsare)",
        };
      }

      if (status !== undefined && GONE_STATUSES.includes(status)) {
        return {
          url,
          verdict: "broken",
          status,
          reason: `HTTP ${status} – sidan finns inte (bekräftat i webbläsare)`,
        };
      }

      const shown = status ?? last.status;

      return {
        url,
        verdict: "unverified",
        status: shown,
        reason:
          shown !== undefined
            ? describeUnverifiedStatus(shown)
            : "kunde inte bekräftas automatiskt",
      };

    } catch (error) {

      const message =
        error instanceof Error ? error.message : String(error);

      if (/ERR_NAME_NOT_RESOLVED|ENOTFOUND/i.test(message)) {
        return { url, verdict: "broken", reason: "domänen finns inte" };
      }

      if (/ERR_CERT|SSL|certificate/i.test(message)) {
        return {
          url,
          verdict: "broken",
          reason: "certifikatfel – besökare får en varning",
        };
      }

      // Visar det verkliga felet, så att det går att se varför.
      const shortError = (last.error ?? message)
        .split("\n")[0]
        .slice(0, 140);

      return {
        url,
        verdict: "unverified",
        status: last.status,
        reason:
          last.status !== undefined
            ? describeUnverifiedStatus(last.status)
            : `kunde inte nås automatiskt (${shortError})`,
      };

    } finally {

      if (isExtraTab) {
        await verifyPage.close().catch(() => undefined);
      }
    }
  }
}

// En CTA som inte fungerar eller inte kunde verifieras.
export interface CtaIssue {
  text: string;
  url: string;
  status?: number;
  reason: string;
  pages: string[];
}

// Vanliga klasser som används för knappar/CTA
const BUTTON_CLASSES = [
  "btn",
  "button",
  "cta",
  "wp-block-button__link",
  "elementor-button",
  "et_pb_button",
];

// Kontrollerar CTA-knappar och tydliga CTA-länkar.
//
// Varje unik destination kontrolleras en gång, även om samma
// knapp finns på alla sidor (t.ex. i headern). Det ger rättvisande
// siffror och undviker att sajten får många anrop till samma
// adress.
//
// Resultatet har tre nivåer:
//   passed     = destinationen fungerar
//   failed     = destinationen är bekräftat trasig
//   unverified = destinationen kunde inte verifieras automatiskt
//                (t.ex. skydd mot automatiska förfrågningar) och
//                ska kontrolleras manuellt. Inget fel.
export async function checkCTA(
  page: Page,
  pages: string[],
  verifier: UrlVerifier = new UrlVerifier(page)
) {

  let passed = 0;
  let failed = 0;
  let unverified = 0;

  const failures: CtaIssue[] = [];
  const unverifiedLinks: CtaIssue[] = [];

  // Destinationer som redan har kontrollerats och räknats.
  const counted = new Map<string, CtaIssue | null>();

  console.log("\nCTA check:");

  // Går igenom alla sidor
  for (const pageUrl of pages) {

    let candidates: { text: string; href: string }[] = [];

    try {

      await page.goto(pageUrl, {
        waitUntil: "domcontentloaded",
        timeout: 20000,
      });

      // Hämtar alla synliga CTA-länkar i ett enda anrop. En CTA är
      // en knapp, ett element med role="button" eller en länk med
      // en vanlig knappklass. Vanliga textlänkar hoppas över.
      candidates = await page
        .locator('a[href], button, input[type="submit"]')
        .evaluateAll((elements, buttonClasses) =>
          elements
            .map((element) => {

              const rect = element.getClientRects();
              const style = window.getComputedStyle(element);

              if (
                rect.length === 0 ||
                style.visibility === "hidden" ||
                style.display === "none"
              ) {
                return null;
              }

              const tagName = element.tagName.toLowerCase();
              const className = (
                element.getAttribute("class") ?? ""
              ).toLowerCase();
              const role = (
                element.getAttribute("role") ?? ""
              ).toLowerCase();

              const isCTA =
                tagName === "button" ||
                tagName === "input" ||
                role === "button" ||
                buttonClasses.some((name) => className.includes(name));

              const href = element.getAttribute("href");

              // Utan href går destinationen inte att kontrollera.
              if (!isCTA || !href) {
                return null;
              }

              return {
                text: (
                  (element as HTMLElement).innerText ||
                  element.getAttribute("aria-label") ||
                  ""
                )
                  .replace(/\s+/g, " ")
                  .trim(),
                href,
              };
            })
            .filter(
              (item): item is { text: string; href: string } =>
                item !== null
            ),
          BUTTON_CLASSES
        );

    } catch {

      // Om en sida inte kan laddas fortsätter CTA-testet med nästa sida
      console.log(
        `⚠ CTA kunde inte kontrolleras på: ${pageUrl}`
      );

      continue;
    }

    for (const candidate of candidates) {

      const href = candidate.href;

      // Ignorera länkar som inte leder till en sida
      if (
        href.startsWith("#") ||
        href.startsWith("mailto:") ||
        href.startsWith("tel:") ||
        href.startsWith("javascript:")
      ) {
        continue;
      }

      let targetUrl: string;

      try {
        const parsed = new URL(href, pageUrl);

        if (!/^https?:$/.test(parsed.protocol)) {
          continue;
        }

        parsed.hash = "";
        targetUrl = parsed.toString();

      } catch {
        continue;
      }

      // Samma destination räknas och kontrolleras en gång. Fler
      // sidor som har samma knapp läggs till i listan.
      if (counted.has(targetUrl)) {

        const known = counted.get(targetUrl);

        if (known && !known.pages.includes(pageUrl)) {
          known.pages.push(pageUrl);
        }

        continue;
      }

      const result = await verifier.verify(targetUrl);

      if (result.verdict === "ok") {

        passed++;
        counted.set(targetUrl, null);

      } else if (result.verdict === "broken") {

        failed++;

        const issue: CtaIssue = {
          text: candidate.text,
          url: targetUrl,
          status: result.status,
          reason: result.reason,
          pages: [pageUrl],
        };

        failures.push(issue);
        counted.set(targetUrl, issue);

        console.log(
          `✗ CTA fungerar inte: "${candidate.text}" - ${targetUrl} - ${result.reason}`
        );

      } else if (result.verdict === "unverified") {

        unverified++;

        const issue: CtaIssue = {
          text: candidate.text,
          url: targetUrl,
          status: result.status,
          reason: result.reason,
          pages: [pageUrl],
        };

        unverifiedLinks.push(issue);
        counted.set(targetUrl, issue);

        console.log(
          `⚠ CTA kunde inte verifieras: "${candidate.text}" - ${targetUrl} - ${result.reason}`
        );

      } else {

        // Anropas inte automatiskt (kan ha sidoeffekter).
        counted.set(targetUrl, null);
      }
    }
  }

  console.log("\nCTA summary:");

  console.log(
    `CTA: ${passed} passed, ${failed} failed, ` +
      `${unverified} could not be verified`
  );

  return {
    passed,
    failed,
    unverified,
    failures,
    unverifiedLinks,
  };
}
import { Page } from "@playwright/test";
import { UrlVerifier } from "./cta";

// En navigationslänk som inte fungerar eller inte kunde verifieras.
export interface NavigationIssue {
  url: string;
  status?: number;
  reason: string;
  pages: string[];
}

// Kontrollerar att interna navigationslänkar fungerar.
//
// Varje unik intern adress kontrolleras en gång med samma verifiering
// som CTA-kontrollen. Ett enskilt misslyckat anrop räknas aldrig som
// trasig länk: 404/410 bekräftas med ett andra anrop, övriga fel
// provas om och öppnas till sist i webbläsaren. Kan det inte avgöras
// blir resultatet "unverified" (kontrolleras manuellt), inte ett fel.
export async function checkNavigation(
  page: Page,
  url: string,
  pages: string[],
  verifier: UrlVerifier = new UrlVerifier(page)
) {

  let passed = 0;
  let failed = 0;
  let unverified = 0;

  const failures: NavigationIssue[] = [];
  const unverifiedLinks: NavigationIssue[] = [];

  // Adresser som redan kontrollerats. Värdet är felet (om det finns),
  // så att fler sidor med samma länk kan läggas till i listan.
  const checked = new Map<string, NavigationIssue | null>();

  let origin = "";

  try {
    origin = new URL(url).origin;
  } catch {
    // Utan giltig adress finns inget att kontrollera.
  }

  console.log("\nNavigation check:");

  for (const pageUrl of pages) {

    let links: string[] = [];

    try {

      await page.goto(pageUrl, {
        waitUntil: "domcontentloaded",
        timeout: 20000,
      });

      // Hämtar alla länkar på sidan. Ogiltiga adresser och länkar som
      // inte är webbadresser hoppas över.
      links = await page.locator("a[href]").evaluateAll((elements) =>
        elements
          .map((element) => {

            const href = (element as HTMLAnchorElement).href;

            if (!/^https?:/i.test(href)) {
              return null;
            }

            try {
              const linkUrl = new URL(href);
              linkUrl.hash = "";
              return linkUrl.toString();
            } catch {
              return null;
            }
          })
          .filter((href): href is string => href !== null)
      );

    } catch {

      console.log(`⚠ Navigation kunde inte kontrolleras på: ${pageUrl}`);

      continue;
    }

    for (const link of [...new Set(links)]) {

      // Bara interna länkar kontrolleras här.
      if (!origin || !link.startsWith(origin)) continue;

      if (checked.has(link)) {

        const known = checked.get(link);

        if (known && !known.pages.includes(pageUrl)) {
          known.pages.push(pageUrl);
        }

        continue;
      }

      const result = await verifier.verify(link);

      if (result.verdict === "ok") {

        passed++;
        checked.set(link, null);

      } else if (result.verdict === "broken") {

        failed++;

        const issue: NavigationIssue = {
          url: link,
          status: result.status,
          reason: result.reason,
          pages: [pageUrl],
        };

        failures.push(issue);
        checked.set(link, issue);

        console.log(`✗ Navigation - ${link} - ${result.reason}`);

      } else if (result.verdict === "unverified") {

        unverified++;

        const issue: NavigationIssue = {
          url: link,
          status: result.status,
          reason: result.reason,
          pages: [pageUrl],
        };

        unverifiedLinks.push(issue);
        checked.set(link, issue);

        console.log(
          `⚠ Navigation kunde inte verifieras - ${link} - ${result.reason}`
        );

      } else {

        // Anropas inte automatiskt (kan ha sidoeffekter).
        checked.set(link, null);
      }
    }
  }

  console.log("\nNavigation summary:");

  console.log(
    `Navigation: ${passed} passed, ${failed} failed, ` +
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
// Testadresser hos webbhotell och hostingtjänster. Där finns inga egna
// domänvarianter (www, http) att kontrollera, så en saknad www-adress
// är inte ett fel hos kunden.
const HOSTING_TEST_DOMAINS = [
  "sg-host.com",
  "wpengine.com",
  "wpenginepowered.com",
  "kinsta.cloud",
  "netlify.app",
  "vercel.app",
  "pages.dev",
  "github.io",
  "herokuapp.com",
  "azurewebsites.net",
  "localhost",
];

export function isHostingTestDomain(hostname: string): boolean {

  const host = hostname.toLowerCase();

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.endsWith(".local")) {
    return true;
  }

  return HOSTING_TEST_DOMAINS.some(
    (domain) => host === domain || host.endsWith(`.${domain}`)
  );
}

// Kontrollerar alternativa versioner av webbplatsens domän
export async function checkDomains(
  url: string
) {

  console.log("\n--- ALTERNATIVA DOMÄNER ---");

  try {

    // Hämtar domänen från webbplatsens URL
    const parsedUrl = new URL(url);

    const hostname =
      parsedUrl.hostname.replace(
        /^www\./,
        ""
      );

    // En testadress hos webbhotellet har inga egna domänvarianter.
    if (isHostingTestDomain(parsedUrl.hostname)) {

      console.log(
        `- ${parsedUrl.hostname} är en testadress hos webbhotell. ` +
          "Domänvarianter kontrolleras inte."
      );

      return {
        results: [],
        passed: 0,
        failed: 0,
        skipped: true,
        status: "PASS" as const,
      };
    }

    // Skapar möjliga versioner av domänen
    const domainVariants = [
      `https://${hostname}`,
      `https://www.${hostname}`,
      `http://${hostname}`,
      `http://www.${hostname}`,
    ];

    // Tar bort eventuella duplicerade URL:er
    const uniqueVariants = [
      ...new Set(domainVariants),
    ];

    const results: {
      url: string;
      status: number;
      finalUrl: string;
      working: boolean;
    }[] = [];

    // Testar varje domänvariant
    for (const domain of uniqueVariants) {

      try {

        // Skickar en HEAD-förfrågan
        const response = await fetch(
          domain,
          {
            method: "HEAD",
            redirect: "follow",
            signal: AbortSignal.timeout(15000),
          }
        );

        // Hämtar den slutliga URL:en efter eventuell redirect
        const finalUrl =
          response.url || domain;

        // 202 räknas inte som fungerande. Det är oftast en
        // challenge-/anti-bot-sida (t.ex. SiteGround) som inte
        // går att verifiera med en vanlig förfrågan.
        const working =
          response.status >= 200 &&
          response.status < 400 &&
          response.status !== 202;

        results.push({
          url: domain,
          status: response.status,
          finalUrl,
          working,
        });

        // Visar resultatet
        if (working) {

          if (finalUrl !== domain) {

            console.log(
              `✓ ${domain} → ${finalUrl} (${response.status})`
            );

          } else {

            console.log(
              `✓ ${domain} (${response.status})`
            );
          }

        } else {

          console.log(
            response.status === 202
              ? `⚠ ${domain} (202 – challenge/anti-bot, kunde inte verifieras)`
              : `✗ ${domain} (${response.status})`
          );
        }

      } catch {

        // Om domänen inte kan nås
        results.push({
          url: domain,
          status: 0,
          finalUrl: domain,
          working: false,
        });

        console.log(
          `✗ ${domain} - kunde inte nås`
        );
      }
    }

    // Räknar fungerande domänvarianter
    const passed =
      results.filter(
        (result) => result.working
      ).length;

    // Räknar domänvarianter som inte fungerar
    const failed =
      results.filter(
        (result) => !result.working
      ).length;

    console.log(
      `\nDomäner: ${passed} fungerar, ${failed} fungerar inte`
    );

    // Returnerar resultatet till QA-systemet
    return {
      results,
      passed,
      failed,
      skipped: false,
      status:
        failed === 0
          ? "PASS" as const
          : "WARNING" as const,
    };

  } catch {

    // Hanterar ogiltig URL
    console.log(
      "⚠ Kunde inte kontrollera alternativa domäner"
    );

    return {
      results: [],
      passed: 0,
      failed: 0,
      skipped: false,
      status: "WARNING" as const,
    };
  }
}
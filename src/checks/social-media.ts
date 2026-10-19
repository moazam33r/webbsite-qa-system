import { Page } from "@playwright/test";

// Kontrollerar länkar till sociala medier.
export async function checkSocialMedia(
  page: Page,
  pages: string[],
  websiteUrl: string
) {

  // Plattformar som systemet letar efter.
  const platforms = [
    {
      name: "Facebook",
      keywords: ["facebook.com", "fb.com"],
    },
    {
      name: "Instagram",
      keywords: ["instagram.com"],
    },
    {
      name: "LinkedIn",
      keywords: ["linkedin.com"],
    },
    {
      name: "YouTube",
      keywords: ["youtube.com", "youtu.be"],
    },
    {
      name: "TikTok",
      keywords: ["tiktok.com"],
    },
    {
      name: "X/Twitter",
      keywords: ["twitter.com", "x.com"],
    },
  ];

  // Sparar hittade sociala medier.
  const found = new Map<string, string>();

  // Sparar sociala medier som har verifierats och
  // verkar tillhöra företaget.
  // (found ovan innehåller ALLA hittade profiler,
  // även de som inte matchar.)
  const matched: {
    platform: string;
    url: string;
  }[] = [];

  // Sparar sociala medier som inte kan verifieras
  // eller som inte verkar tillhöra företaget.
  const failed: {
    platform: string;
    url: string;
    message: string;
  }[] = [];

  console.log("\nSocial media check:");

  // Hämtar webbplatsens domän.
  const websiteDomain =
    new URL(websiteUrl).hostname
      .replace(/^www\./, "")
      .toLowerCase();

  // Hämtar själva domännamnet.
  const domainName =
    websiteDomain
      .split(".")[0]
      .toLowerCase();

  // Hämtar startsidans titel.
  // Detta görs innan vi börjar gå igenom alla sidor,
  // så att vi inte råkar använda titeln från den sista sidan.
  let websiteTitle = "";

  try {

    await page.goto(websiteUrl, {
      waitUntil: "domcontentloaded",
    });

    websiteTitle = await page.title();

  } catch {

    // Om startsidans titel inte kan hämtas
    // fortsätter systemet ändå.
  }

  // Försöker hitta företagsnamnet från startsidans titel.
  const companyName =
    websiteTitle
      .split("|")[0]
      .trim()
      .toLowerCase();

  // Hittar sociala medier i text eller HTML.
  const findSocialMedia = (
    content: string
  ) => {

    for (const platform of platforms) {

      for (const keyword of platform.keywords) {

        // Kontrollerar om plattformens domän finns.
        if (
          content
            .toLowerCase()
            .includes(keyword) &&
          !found.has(platform.name)
        ) {

          // Försöker hitta en komplett URL.
          const urlMatch = content.match(
            new RegExp(
              `https?://[^"'\\s<>]*${keyword.replace(".", "\\.")}[^"'\\s<>]*`,
              "i"
            )
          );

          // Vi sparar bara en riktig URL.
          // Tidigare användes själva keywordet som fallback,
          // exempelvis "instagram.com", vilket sedan gjorde
          // att new URL() misslyckades.
          if (urlMatch?.[0]) {

            found.set(
              platform.name,
              urlMatch[0]
            );
          }

          break;
        }
      }
    }
  };

  // Lyssnar efter Trustindex-data.
  page.on("response", async (response) => {

    const responseUrl = response.url();

    if (
      responseUrl.includes("trustindex.io/widgets/") &&
      responseUrl.includes("data.json")
    ) {

      try {

        const content =
          await response.text();

        const data =
          JSON.parse(content);

        if (data.sources) {

          for (
            const sourceKey of Object.keys(
              data.sources
            )
          ) {

            const source =
              data.sources[sourceKey];

            const profileUrl =
              source?.user?.profile_url;

            // Hoppar över poster utan profil-URL.
            if (!profileUrl) {
              continue;
            }

            for (const platform of platforms) {

              const matches =
                platform.keywords.some(
                  (keyword) =>
                    profileUrl
                      .toLowerCase()
                      .includes(keyword)
                );

              if (
                matches &&
                !found.has(platform.name)
              ) {

                // Sparar den riktiga profil-URL:en.
                found.set(
                  platform.name,
                  profileUrl
                );
              }
            }
          }
        }

      } catch {

        // Ignorerar JSON som inte går att läsa.
      }
    }
  });

  // Går igenom alla sidor på webbplatsen.
  for (const pageUrl of pages) {

    await page.goto(pageUrl, {
      waitUntil: "domcontentloaded",
    });

    // Hämtar vanliga länkar.
    const links =
      await page.locator("a").evaluateAll(
        (elements) =>
          elements.map(
            (element) => ({
              href:
                (element as HTMLAnchorElement).href || "",

              text:
                element.textContent || "",

              className:
                element.getAttribute("class") || "",

              ariaLabel:
                element.getAttribute("aria-label") || "",

              title:
                element.getAttribute("title") || "",
            })
          )
      );

    // Kontrollerar vanliga länkar.
    for (const link of links) {

      const searchableText = [
        link.href,
        link.text,
        link.className,
        link.ariaLabel,
        link.title,
      ].join(" ");

      findSocialMedia(
        searchableText
      );
    }

    // Kontrollerar hela HTML-koden.
    const html =
      await page.content();

    findSocialMedia(html);

    // Väntar på dynamiskt innehåll,
    // exempelvis Trustindex-widgeten.
    await page.waitForTimeout(1500);
  }

  // Kontrollerar alla hittade sociala medier.
  for (const [
    platform,
    socialUrl,
  ] of found) {

    try {

      // Kontrollerar att URL:en verkligen är en komplett URL.
      const socialUrlObject =
        new URL(socialUrl);

      // Hämtar användarnamnet från URL:en.
      const username =
        socialUrlObject.pathname
          .replace(/^\/+/, "")
          .split("/")
          .filter(Boolean)
          .pop()
          ?.toLowerCase() ?? "";

      // Normaliserar företagsnamnet.
      const normalizedCompanyName =
        companyName
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]/g, "");

      // Normaliserar användarnamnet.
      const normalizedUsername =
        username
          .replace(/[^a-z0-9]/g, "");

      // Normaliserar domännamnet.
      const normalizedDomain =
        domainName
          .replace(/[^a-z0-9]/g, "");

      // Kontrollerar om användarnamnet
      // matchar företagsnamnet.
      const matchesCompany =
        normalizedCompanyName.length > 0 &&
        (
          normalizedUsername.includes(
            normalizedCompanyName
          ) ||
          normalizedCompanyName.includes(
            normalizedUsername
          )
        );

      // Kontrollerar om användarnamnet
      // matchar domännamnet.
      const matchesDomain =
        normalizedDomain.length > 0 &&
        (
          normalizedUsername.includes(
            normalizedDomain
          ) ||
          normalizedDomain.includes(
            normalizedUsername
          )
        );

      const matches =
        matchesCompany ||
        matchesDomain;

      if (!matches) {

        failed.push({
          platform,
          url: socialUrl,
          message:
            `Kontot verkar inte matcha företaget ${companyName}`,
        });

        console.log(
          `✗ ${platform}: ${socialUrl}`
        );

        console.log(
          `  Kontot verkar inte tillhöra företaget ${companyName}`
        );

      } else {

        matched.push({
          platform,
          url: socialUrl,
        });

        console.log(
          `✓ ${platform}: ${socialUrl}`
        );

        console.log(
          `  ✓ Kontot matchar företaget`
        );
      }

    } catch {

      failed.push({
        platform,
        url: socialUrl,
        message:
          `Kunde inte kontrollera sociala mediet: ${socialUrl}`,
      });

      console.log(
        `✗ ${platform}: kunde inte verifieras`
      );
    }
  }

  // Visar om inga sociala medier hittades.
  if (found.size === 0) {

    console.log(
      "Inga sociala medier hittades."
    );
  }

  console.log(
    `\nSociala medier: ${found.size} hittades`
  );

  console.log(
    `Sociala medier som inte matchar: ${failed.length}`
  );

  // Returnerar resultaten.
  //
  // found = profiler som matchar företaget.
  // failed = profiler som inte matchar eller inte kunde
  // verifieras. En profil finns alltså aldrig i båda.
  return {
    found: matched,

    failed,
  };
}
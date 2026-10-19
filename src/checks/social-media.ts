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

  // Sparar sociala medier som inte går att verifiera automatiskt,
  // t.ex. Facebook-profiler som bara har ett ID i URL:en och där
  // profilens namn inte kan läsas.
  const unverified: {
    platform: string;
    url: string;
    message: string;
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

  // Extra företagsnamn som hittas på startsidan.
  let pageCompanyNames: string[] = [];

  try {

    await page.goto(websiteUrl, {
      waitUntil: "domcontentloaded",
    });

    websiteTitle = await page.title();

    // Hämtar företagsnamn från og:site_name, JSON-LD och
    // copyright-raden i sidfoten. Sidtiteln innehåller ofta
    // sökordstext (t.ex. "Målare i Skåne") och inte själva
    // företagsnamnet.
    pageCompanyNames = await page.evaluate(() => {

      const names: string[] = [];

      const ogSiteName =
        document
          .querySelector('meta[property="og:site_name"]')
          ?.getAttribute("content");

      if (ogSiteName) {
        names.push(ogSiteName);
      }

      const businessTypes = [
        "Organization",
        "LocalBusiness",
        "Corporation",
        "ProfessionalService",
        "WebSite",
      ];

      const collect = (node: unknown): void => {

        if (!node || typeof node !== "object") {
          return;
        }

        if (Array.isArray(node)) {
          node.forEach(collect);
          return;
        }

        const object = node as Record<string, unknown>;

        const rawType = object["@type"];

        const types = Array.isArray(rawType)
          ? rawType
          : [rawType];

        if (
          typeof object.name === "string" &&
          types.some((type) =>
            businessTypes.includes(String(type))
          )
        ) {
          names.push(object.name);
        }

        Object.values(object).forEach(collect);
      };

      document
        .querySelectorAll('script[type="application/ld+json"]')
        .forEach((script) => {
          try {
            collect(JSON.parse(script.textContent || ""));
          } catch {
            // Ignorerar JSON-LD som inte går att läsa.
          }
        });

      const bodyText = document.body?.innerText ?? "";

      const copyrightMatch = bodyText.match(
        /(?:©|copyright)\s*(?:©\s*)?\d{4}\s+([^\n.|–—-]{3,60})/i
      );

      if (copyrightMatch?.[1]) {
        names.push(copyrightMatch[1].trim());
      }

      return names;
    });

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

  // Normaliserar text så att "Måleri", "maleri" och "M-å-l-e-r-i"
  // jämförs lika: tar bort accenter/prickar och allt utom a-z/0-9.
  const normalizeName = (value: string): string =>
    value
      .replace(/&amp;/gi, "&")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");

  // Namn som en profil kan jämföras mot.
  const companyNameCandidates = [
    ...new Set(
      [
        companyName,
        ...pageCompanyNames,
        domainName,
      ]
        .map(normalizeName)
        .filter((name) => name.length >= 4)
    ),
  ];

  // Namnet som visas i rapporten om en profil inte matchar.
  // Föredrar riktiga företagsnamn framför sidtiteln.
  const displayCompanyName =
    pageCompanyNames[pageCompanyNames.length - 1] ||
    pageCompanyNames[0] ||
    companyName ||
    domainName;

  // Två namn matchar om det ena innehåller det andra.
  // Kortare än 5 tecken ignoreras för att undvika slumpträffar.
  const namesMatch = (a: string, b: string): boolean => {

    if (a.length < 5 || b.length < 5) {
      return a.length >= 4 && a === b;
    }

    return a.includes(b) || b.includes(a);
  };

  // Räknar hur många tecken som skiljer två texter åt
  // (Levenshtein-avstånd).
  const editDistance = (a: string, b: string): number => {

    const previous = Array.from(
      { length: b.length + 1 },
      (_, index) => index
    );

    for (let i = 1; i <= a.length; i++) {

      let diagonal = previous[0];
      previous[0] = i;

      for (let j = 1; j <= b.length; j++) {

        const temp = previous[j];

        previous[j] =
          a[i - 1] === b[j - 1]
            ? diagonal
            : Math.min(
                diagonal,
                previous[j],
                previous[j - 1]
              ) + 1;

        diagonal = temp;
      }
    }

    return previous[b.length];
  };

  // Luddig matchning för namn som nästan är lika, t.ex.
  // "fjohnssonsmur" mot "fjohnssonmurhantverk".
  //
  // Det kortare namnet jämförs mot alla delar av det längre
  // namnet. Minst 8 tecken krävs och högst ~20 % av tecknen
  // får skilja, så att helt olika namn inte matchar.
  const namesFuzzyMatch = (a: string, b: string): boolean => {

    const shorter = a.length <= b.length ? a : b;
    const longer = a.length <= b.length ? b : a;

    if (shorter.length < 8) {
      return false;
    }

    const allowed = Math.floor(shorter.length * 0.2);

    for (
      let size = shorter.length - allowed;
      size <= shorter.length + allowed;
      size++
    ) {

      if (size > longer.length) {
        break;
      }

      for (let start = 0; start + size <= longer.length; start++) {

        if (
          editDistance(
            shorter,
            longer.slice(start, start + size)
          ) <= allowed
        ) {
          return true;
        }
      }
    }

    return false;
  };

  // Försöker läsa profilens namn genom att öppna profilsidan.
  // Används när URL:en bara innehåller ett ID (t.ex. Facebook
  // profile.php?id=...). Returnerar tom text om namnet inte
  // går att läsa (inloggningsvägg, blockering, fel).
  const readProfileName = async (
    profileUrl: string
  ): Promise<string> => {

    try {

      await page.goto(profileUrl, {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      });

      const rawTitle = await page.evaluate(() =>
        document
          .querySelector('meta[property="og:title"]')
          ?.getAttribute("content") ||
        document.title ||
        ""
      );

      // Tar bort plattformsnamnet i slutet, t.ex. " | Facebook".
      const name = rawTitle
        .replace(
          /\s*[|\-–—]\s*(facebook|instagram|linkedin|youtube|tiktok)\b.*$/i,
          ""
        )
        .trim();

      // Inloggningssidor och felsidor räknas inte som profilnamn.
      if (
        !name ||
        /log ?in|logga in|sign ?up|registrera|facebook|instagram|linkedin|youtube|tiktok|error|fel/i.test(
          name
        )
      ) {
        return "";
      }

      return name;

    } catch {

      return "";
    }
  };

  // Delar av en profil-URL som inte är ett namn.
  const genericPathSegments = new Set([
    "people",
    "pages",
    "page",
    "profile.php",
    "p",
    "groups",
    "pg",
    "public",
    "company",
    "in",
    "user",
    "c",
    "channel",
    "sharer",
    "sharer.php",
  ]);

  // Kontrollerar alla hittade sociala medier.
  for (const [
    platform,
    socialUrl,
  ] of found) {

    try {

      // Kontrollerar att URL:en verkligen är en komplett URL.
      const socialUrlObject =
        new URL(socialUrl);

      // Hämtar alla delar av sökvägen som kan innehålla ett namn.
      //
      // Exempel Facebook:
      //   /people/Henkes-Måleri-Ab/61557009826851/
      //   -> "Henkes-Måleri-Ab" (siffer-ID:t hoppas över)
      const nameSegments =
        socialUrlObject.pathname
          .split("/")
          .filter(Boolean)
          .map((segment) => {
            try {
              return decodeURIComponent(segment);
            } catch {
              return segment;
            }
          })
          .map((segment) => segment.replace(/^@/, ""))
          .filter(
            (segment) =>
              !genericPathSegments.has(segment.toLowerCase()) &&
              !/^\d+$/.test(segment)
          );

      // Matchar om något namn i URL:en liknar något
      // av företagets namn eller domännamnet.
      let matches = nameSegments.some((segment) => {

        const normalizedSegment =
          normalizeName(segment);

        return companyNameCandidates.some(
          (candidate) =>
            namesMatch(normalizedSegment, candidate) ||
            namesFuzzyMatch(normalizedSegment, candidate)
        );
      });

      // Om URL:en inte innehåller något namn (bara ett ID)
      // försöker vi läsa profilens namn från själva profilsidan.
      let profileNameNotReadable = false;

      if (!matches && nameSegments.length === 0) {

        const profileName =
          await readProfileName(socialUrl);

        if (profileName) {

          const normalizedProfileName =
            normalizeName(profileName);

          matches = companyNameCandidates.some(
            (candidate) =>
              namesMatch(normalizedProfileName, candidate) ||
              namesFuzzyMatch(normalizedProfileName, candidate)
          );

        } else {

          profileNameNotReadable = true;
        }
      }

      if (!matches && profileNameNotReadable) {

        unverified.push({
          platform,
          url: socialUrl,
          message:
            "Profilens namn står inte i URL:en och kunde inte läsas från sidan",
        });

        console.log(
          `⚠ ${platform}: ${socialUrl}`
        );

        console.log(
          "  Kunde inte verifieras automatiskt (kontrollera profilen manuellt)"
        );

      } else if (!matches) {

        failed.push({
          platform,
          url: socialUrl,
          message:
            `Kontot verkar inte matcha företaget ${displayCompanyName}`,
        });

        console.log(
          `✗ ${platform}: ${socialUrl}`
        );

        console.log(
          `  Kontot verkar inte tillhöra företaget ${displayCompanyName}`
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

  console.log(
    `Sociala medier som inte kunde verifieras: ${unverified.length}`
  );

  // Returnerar resultaten.
  //
  // found = profiler som matchar företaget.
  // failed = profiler som inte matchar eller inte kunde
  // verifieras. En profil finns alltså aldrig i båda.
  //
  // unverified = profiler som inte gick att kontrollera
  // automatiskt och som bör granskas manuellt.
  return {
    found: matched,

    failed,

    unverified,
  };
}
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
    reason: string;
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

  // Telefonnummer och e-postadresser som webbplatsen själv visar.
  // Används för att styrka kopplingen till en profil.
  let siteContacts: { phones: string[]; emails: string[] } = {
    phones: [],
    emails: [],
  };

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

    siteContacts = await page.evaluate(() => ({
      phones: Array.from(
        document.querySelectorAll('a[href^="tel:"]')
      ).map((a) => a.getAttribute("href") || ""),
      emails: Array.from(
        document.querySelectorAll('a[href^="mailto:"]')
      ).map((a) => a.getAttribute("href") || ""),
    }));

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

  // Sista 8 siffrorna i ett telefonnummer. Gör att "0763 48 87 32",
  // "+46 76 348 87 32" och "0763488732" jämförs lika.
  const phoneKey = (value: string): string =>
    value.replace(/\D/g, "").slice(-8);

  const sitePhoneKeys = [
    ...new Set(
      siteContacts.phones
        .map((phone) => phoneKey(decodeURIComponent(phone)))
        .filter((key) => key.length === 8)
    ),
  ];

  const siteEmails = [
    ...new Set(
      siteContacts.emails
        .map((mail) =>
          decodeURIComponent(mail)
            .replace(/^mailto:/i, "")
            .split("?")[0]
            .trim()
            .toLowerCase()
        )
        .filter((mail) => mail.includes("@"))
    ),
  ];

  // Länkar för att dela en sida eller visa ett inbäddat flöde är inga
  // företagsprofiler.
  const isShareOrWidgetUrl = (value: string): boolean =>
    /\/(sharer|share|intent|dialog|plugins|embed|tr)(\/|\.php|\?|$)/i.test(
      new URL(value).pathname + new URL(value).search
    );

  // Vad vi kunde läsa ut från profilsidan.
  interface ProfileEvidence {
    // Profilen gick att läsa (ingen inloggningsvägg eller blockering).
    readable: boolean;
    // HTTP-status för profilsidan (0 = ingen kontakt).
    httpStatus: number;
    // Profilens namn, om det gick att läsa.
    name: string;
    // Profilen länkar tillbaka till webbplatsen.
    backlink: boolean;
    // Webbplatsens telefonnummer eller e-post finns på profilen.
    contact: string;
    // Företagets namn nämns på profilen.
    nameMentioned: boolean;
  }

  // Öppnar profilsidan och letar efter bevis för att den hör till
  // företaget: länk tillbaka, samma telefonnummer eller e-post, eller
  // företagsnamnet.
  const readProfile = async (
    profileUrl: string
  ): Promise<ProfileEvidence> => {

    const empty: ProfileEvidence = {
      readable: false,
      httpStatus: 0,
      name: "",
      backlink: false,
      contact: "",
      nameMentioned: false,
    };

    try {

      const response = await page.goto(profileUrl, {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      });

      const httpStatus = response?.status() ?? 0;

      // Ger sidan en chans att rita ut innehållet.
      await page.waitForTimeout(1000);

      const data = await page.evaluate(() => ({
        title:
          document
            .querySelector('meta[property="og:title"]')
            ?.getAttribute("content") ||
          document.title ||
          "",
        description:
          document
            .querySelector('meta[property="og:description"]')
            ?.getAttribute("content") ||
          document
            .querySelector('meta[name="description"]')
            ?.getAttribute("content") ||
          "",
        text: (document.body?.innerText ?? "").slice(0, 8000),
        hrefs: Array.from(document.querySelectorAll("a[href]")).map(
          (a) => (a as HTMLAnchorElement).href
        ),
        finalUrl: location.href,
      }));

      const loginWall =
        /\/(login|accounts\/login|signin|checkpoint)/i.test(
          data.finalUrl
        ) ||
        /^(log ?in|logga in|sign ?in|facebook|instagram|linkedin)\b/i.test(
          data.title.trim()
        );

      const name = data.title
        .replace(
          /\s*[|\-–—•]\s*(facebook|instagram|linkedin|youtube|tiktok|x|twitter)\b.*$/i,
          ""
        )
        .trim();

      const combined = [data.title, data.description, data.text].join(
        "\n"
      );

      const readable =
        httpStatus >= 200 &&
        httpStatus < 400 &&
        !loginWall &&
        (name.length > 0 || data.description.length > 0);

      if (!readable) {
        return { ...empty, httpStatus };
      }

      // Profilen länkar tillbaka till webbplatsen. Sociala medier
      // slussar ofta länkar via en omdirigering (u=… / q=…).
      const backlink = data.hrefs.some((href) => {

        try {

          const parsed = new URL(href);

          const candidates = [
            parsed.hostname,
            parsed.searchParams.get("u") ?? "",
            parsed.searchParams.get("q") ?? "",
            parsed.searchParams.get("url") ?? "",
          ];

          return candidates.some((candidate) =>
            candidate.toLowerCase().includes(websiteDomain)
          );

        } catch {

          return false;
        }
      }) || combined.toLowerCase().includes(websiteDomain);

      // Samma telefonnummer eller e-post som på webbplatsen.
      const digits = combined.replace(/\D/g, "");
      const lowerCombined = combined.toLowerCase();

      let contact = "";

      if (sitePhoneKeys.some((key) => digits.includes(key))) {
        contact = "telefonnummer";
      } else if (siteEmails.some((mail) => lowerCombined.includes(mail))) {
        contact = "e-postadress";
      }

      const normalizedCombined = normalizeName(combined);

      const nameMentioned = companyNameCandidates.some(
        (candidate) =>
          candidate.length >= 6 &&
          normalizedCombined.includes(candidate)
      );

      return {
        readable: true,
        httpStatus,
        name,
        backlink,
        contact,
        nameMentioned,
      };

    } catch {

      return empty;
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
  //
  // En länk från företagets egen webbplats är i sig en stark
  // indikation på att profilen tillhör företaget. Ett konto som
  // inte går att koppla får därför aldrig status "fel", utan
  // "kräver manuell verifiering". Bara en profil som bevisligen
  // inte finns (HTTP 404/410) rapporteras som fel.
  for (const [
    platform,
    socialUrl,
  ] of found) {

    try {

      // Kontrollerar att URL:en verkligen är en komplett URL.
      const socialUrlObject =
        new URL(socialUrl);

      // Delningsknappar och inbäddade flöden är inga profiler.
      if (isShareOrWidgetUrl(socialUrl)) {

        console.log(
          `- ${platform}: ${socialUrl} (delningslänk, hoppas över)`
        );

        continue;
      }

      // Hämtar alla delar av sökvägen som kan innehålla ett namn.
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

      // Steg 1: namnet i adressen liknar företagets namn.
      const urlMatches = nameSegments.some((segment) => {

        const normalizedSegment =
          normalizeName(segment);

        return companyNameCandidates.some(
          (candidate) =>
            namesMatch(normalizedSegment, candidate) ||
            namesFuzzyMatch(normalizedSegment, candidate)
        );
      });

      if (urlMatches) {

        matched.push({
          platform,
          url: socialUrl,
          reason: "namnet i adressen liknar företagets namn",
        });

        console.log(`✓ ${platform}: ${socialUrl}`);
        console.log("  ✓ Kontot matchar företaget");

        continue;
      }

      // Steg 2: öppna profilen och leta efter andra samband.
      const evidence = await readProfile(socialUrl);

      const reasons: string[] = [];

      if (evidence.backlink) {
        reasons.push("profilen länkar till webbplatsen");
      }

      if (evidence.contact) {
        reasons.push(
          `samma ${evidence.contact} som på webbplatsen`
        );
      }

      if (evidence.nameMentioned) {
        reasons.push("företagets namn nämns på profilen");
      }

      if (reasons.length > 0) {

        matched.push({
          platform,
          url: socialUrl,
          reason: reasons.join(", "),
        });

        console.log(`✓ ${platform}: ${socialUrl}`);
        console.log(`  ✓ Kontot matchar företaget (${reasons.join(", ")})`);

        continue;
      }

      // Profilen finns inte.
      if (evidence.httpStatus === 404 || evidence.httpStatus === 410) {

        failed.push({
          platform,
          url: socialUrl,
          message:
            `Profilen finns inte (HTTP ${evidence.httpStatus})`,
        });

        console.log(`✗ ${platform}: ${socialUrl}`);
        console.log(
          `  Profilen finns inte (HTTP ${evidence.httpStatus})`
        );

        continue;
      }

      // Kopplingen kan inte fastställas.
      const message = evidence.readable
        ? `Profilen${evidence.name ? ` "${evidence.name}"` : ""} ` +
          `länkar inte till webbplatsen och företagets namn nämns ` +
          "inte på den. Länken kommer från företagets egen webbplats, " +
          "men kopplingen kunde inte bekräftas automatiskt."
        : "Profilens innehåll kunde inte läsas automatiskt " +
          "(inloggningsvägg eller blockering) och namnet i adressen " +
          "skiljer sig från företagets namn.";

      unverified.push({
        platform,
        url: socialUrl,
        message,
      });

      console.log(`⚠ ${platform}: ${socialUrl}`);
      console.log(`  Kräver manuell verifiering: ${message}`);

    } catch {

      unverified.push({
        platform,
        url: socialUrl,
        message:
          "Länken kunde inte tolkas eller kontrolleras automatiskt",
      });

      console.log(
        `⚠ ${platform}: kunde inte verifieras (kräver manuell kontroll)`
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
    `Sociala medier som inte finns: ${failed.length}`
  );

  console.log(
    `Sociala medier som kräver manuell verifiering: ${unverified.length}`
  );

  // Returnerar resultaten.
  //
  // found = profiler som matchar företaget (med orsak).
  // failed = profiler som bevisligen inte finns (HTTP 404/410).
  // unverified = profiler där kopplingen till företaget inte kunde
  // fastställas automatiskt. De kräver manuell verifiering och räknas
  // inte som fel.
  return {
    found: matched,

    failed,

    unverified,
  };
}
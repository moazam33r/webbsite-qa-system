import "dotenv/config";

// =========================================================
// GRÄNSER FÖR PERFORMANCE-SCORE
// =========================================================

// Lägsta score som räknas som godkänd (PASS).
const DESKTOP_PASS_SCORE = 90;
const MOBILE_PASS_SCORE = 90;

// Under detta värde räknas resultatet som FAIL.
// Mellan FAIL-gränsen och PASS-gränsen blir det WARNING.
const FAIL_SCORE = 50;

// true  = ett dåligt Core Web Vital (t.ex. LCP över 4 s) ger FAIL
//         även om score är över gränsen.
// false = endast score avgör om resultatet är PASS/WARNING/FAIL.
const CORE_WEB_VITALS_CAN_OVERRIDE_SCORE = false;


// Status som används för prestandamätningar.
type PerformanceMetricStatus =
  | "PASS"
  | "WARNING"
  | "FAIL";

// En enskild Lighthouse-förbättring.
export interface PerformanceOpportunity {
  id: string;
  title: string;
  description: string;
  displayValue?: string;
  savingsMs?: number;
}

// Resultatet från en enskild PageSpeed-körning.
export interface PerformanceDeviceResult {
  score: number;

  // Core Web Vitals och andra viktiga mätvärden.
  lcp: number | null;
  cls: number | null;
  fcp: number | null;
  tbt: number | null;
  inp: number | null;

  // Status för de olika mätvärdena.
  lcpStatus: PerformanceMetricStatus | null;
  clsStatus: PerformanceMetricStatus | null;
  fcpStatus: PerformanceMetricStatus | null;
  tbtStatus: PerformanceMetricStatus | null;
  inpStatus: PerformanceMetricStatus | null;

  // Viktiga Lighthouse-förbättringar.
  opportunities: PerformanceOpportunity[];

  // Status för hela enheten.
  status: "PASS" | "WARNING" | "FAIL";
}

// Hjälpfunktion som bestämmer status för LCP.
// LCP under 2,5 sekunder räknas som bra.
function getLcpStatus(
  value: number | null
): PerformanceMetricStatus | null {

  if (value === null) {
    return null;
  }

  // 2500 ms = 2,5 sekunder.
  if (value <= 2500) {
    return "PASS";
  }

  // 4000 ms = 4 sekunder.
  if (value <= 4000) {
    return "WARNING";
  }

  return "FAIL";
}

// Hjälpfunktion som bestämmer status för CLS.
function getClsStatus(
  value: number | null
): PerformanceMetricStatus | null {

  if (value === null) {
    return null;
  }

  // CLS under 0,1 räknas som bra.
  if (value <= 0.1) {
    return "PASS";
  }

  // CLS upp till 0,25 behöver förbättras.
  if (value <= 0.25) {
    return "WARNING";
  }

  return "FAIL";
}

// Hjälpfunktion som bestämmer status för FCP.
function getFcpStatus(
  value: number | null
): PerformanceMetricStatus | null {

  if (value === null) {
    return null;
  }

  // 1800 ms = 1,8 sekunder.
  if (value <= 1800) {
    return "PASS";
  }

  // 3000 ms = 3 sekunder.
  if (value <= 3000) {
    return "WARNING";
  }

  return "FAIL";
}

// Hjälpfunktion som bestämmer status för TBT.
function getTbtStatus(
  value: number | null
): PerformanceMetricStatus | null {

  if (value === null) {
    return null;
  }

  // TBT under 200 ms räknas som bra.
  if (value <= 200) {
    return "PASS";
  }

  // TBT upp till 600 ms behöver förbättras.
  if (value <= 600) {
    return "WARNING";
  }

  return "FAIL";
}

// Hjälpfunktion som bestämmer status för INP.
function getInpStatus(
  value: number | null
): PerformanceMetricStatus | null {

  if (value === null) {
    return null;
  }

  // INP under 200 ms räknas som bra.
  if (value <= 200) {
    return "PASS";
  }

  // INP upp till 500 ms behöver förbättras.
  if (value <= 500) {
    return "WARNING";
  }

  return "FAIL";
}

// Hämtar ett numeriskt värde från en Lighthouse-audit.
function getNumericValue(
  audit: any
): number | null {

  if (
    audit &&
    typeof audit.numericValue === "number"
  ) {
    return audit.numericValue;
  }

  return null;
}

// Hämtar användarvänlig text från en Lighthouse-audit.
function getAuditDescription(
  audit: any
): string {

  if (
    audit &&
    typeof audit.description === "string"
  ) {
    return audit.description;
  }

  return "";
}

// Kontrollerar webbplatsens prestanda med Google PageSpeed Insights.
export async function checkPerformance(
  url: string
) {

  console.log("\n--- PRESTANDA ---");

  try {

    // Hämtar API-nyckeln från .env.
    const apiKey =
      process.env.PAGESPEED_API_KEY;

    // Om API-nyckeln saknas kan testet inte köras.
    if (!apiKey) {

      console.log(
        "⚠ PAGESPEED_API_KEY saknas i .env"
      );

      return {
        desktop: null,
        mobile: null,
        status: "WARNING" as const,
      };
    }

    // Kör PageSpeed för desktop eller mobile.
    const runPageSpeed = async (
      strategy: "desktop" | "mobile"
    ): Promise<PerformanceDeviceResult | null> => {

      // Skapar URL till PageSpeed API.
      const apiUrl =
        `https://www.googleapis.com/pagespeedonline/v5/runPagespeed` +
        `?url=${encodeURIComponent(url)}` +
        `&category=performance` +
        `&strategy=${strategy}` +
        `&key=${encodeURIComponent(apiKey)}`;

      // Skickar förfrågan till PageSpeed.
      const response =
        await fetch(apiUrl);

      // PageSpeed har nått sin rate limit.
      if (response.status === 429) {

        console.log(
          `⚠ PageSpeed ${strategy} kunde inte genomföras: API rate limit (429)`
        );

        return null;
      }

      // Kontrollerar om API-anropet misslyckades.
      if (!response.ok) {

        console.log(
          `⚠ PageSpeed ${strategy} kunde inte genomföras (${response.status})`
        );

        return null;
      }

      // Hämtar resultatet från API:t.
      const data =
        await response.json();

      // Hämtar Lighthouse-resultatet.
      const lighthouseResult =
        data?.lighthouseResult;

      // Hämtar Performance-score.
      const performanceScore =
        lighthouseResult
          ?.categories
          ?.performance
          ?.score;

      // Om ingen score hittades kan testet inte fortsätta.
      if (
        typeof performanceScore !==
        "number"
      ) {

        console.log(
          `⚠ Ingen PageSpeed Performance-score hittades för ${strategy}`
        );

        return null;
      }

      // Gör om score från exempelvis 0.95 till 95.
      const score =
        Math.round(
          performanceScore * 100
        );

      // Hämtar alla Lighthouse-audits.
      const audits =
        lighthouseResult?.audits ?? {};

      // ==============================
      // VIKTIGA MÄTVÄRDEN
      // ==============================

      // Hämtar Largest Contentful Paint.
      const lcp =
        getNumericValue(
          audits["largest-contentful-paint"]
        );

      // Hämtar Cumulative Layout Shift.
      const cls =
        getNumericValue(
          audits["cumulative-layout-shift"]
        );

      // Hämtar First Contentful Paint.
      const fcp =
        getNumericValue(
          audits["first-contentful-paint"]
        );

      // Hämtar Total Blocking Time.
      const tbt =
        getNumericValue(
          audits["total-blocking-time"]
        );

      // Hämtar Interaction to Next Paint om Lighthouse
      // har tillgängligt resultat för sidan.
      const inp =
        getNumericValue(
          audits["interaction-to-next-paint"]
        );

      // Bestämmer status för varje mätvärde.
      const lcpStatus =
        getLcpStatus(lcp);

      const clsStatus =
        getClsStatus(cls);

      const fcpStatus =
        getFcpStatus(fcp);

      const tbtStatus =
        getTbtStatus(tbt);

      const inpStatus =
        getInpStatus(inp);

      // ==============================
      // VIKTIGA LIGHTHOUSE-FYND
      // ==============================

      const opportunities:
        PerformanceOpportunity[] = [];

      // Går igenom Lighthouse-audits.
      for (
        const [id, audit] of
        Object.entries<any>(audits)
      ) {

        // Hoppar över audits som inte är
        // förbättringsmöjligheter.
        if (
          audit?.details?.type !==
          "opportunity"
        ) {
          continue;
        }

        // Hoppar över audits som inte har
        // någon besparing att visa.
        const savingsMs =
          typeof audit.numericValue ===
          "number"
            ? audit.numericValue
            : undefined;

        // Hämtar titel.
        const title =
          typeof audit.title ===
          "string"
            ? audit.title
            : id;

        // Hämtar beskrivning.
        const description =
          getAuditDescription(audit);

        // Hämtar visningsvärde från Lighthouse.
        const displayValue =
          typeof audit.displayValue ===
          "string"
            ? audit.displayValue
            : undefined;

        opportunities.push({
          id,
          title,
          description,
          displayValue,
          savingsMs,
        });
      }

      // Sorterar förbättringsmöjligheterna efter
      // uppskattad tidsbesparing.
      opportunities.sort(
        (a, b) =>
          (b.savingsMs ?? 0) -
          (a.savingsMs ?? 0)
      );

      // Begränsar listan så PDF-rapporten inte
      // blir onödigt lång.
      const importantOpportunities =
        opportunities.slice(0, 5);

      // ==============================
      // STATUS
      // ==============================

      // Desktop: 90+ = PASS. Mobile: 75+ = PASS.
      // Mellan 50 och PASS-gränsen = WARNING.
      // Under 50 = FAIL.
      const passScore =
        strategy === "mobile"
          ? MOBILE_PASS_SCORE
          : DESKTOP_PASS_SCORE;

      let status:
        | "PASS"
        | "WARNING"
        | "FAIL";

      if (score >= passScore) {

        status = "PASS";

      } else if (score >= FAIL_SCORE) {

        status = "WARNING";

      } else {

        status = "FAIL";
      }

      // Om ett kritiskt Core Web Vital-värde
      // är dåligt ska resultatet inte döljas
      // bakom ett relativt högt score.
      if (!CORE_WEB_VITALS_CAN_OVERRIDE_SCORE) {

        // Endast score avgör status.

      } else if (
        lcpStatus === "FAIL" ||
        clsStatus === "FAIL" ||
        tbtStatus === "FAIL" ||
        inpStatus === "FAIL"
      ) {

        status = "FAIL";

      } else if (
        lcpStatus === "WARNING" ||
        clsStatus === "WARNING" ||
        tbtStatus === "WARNING" ||
        inpStatus === "WARNING"
      ) {

        // Ändrar bara PASS till WARNING.
        // Ett redan existerande FAIL påverkas inte.
        if (status === "PASS") {
          status = "WARNING";
        }
      }

      // Returnerar det kompletta resultatet.
      return {
        score,

        lcp,
        cls,
        fcp,
        tbt,
        inp,

        lcpStatus,
        clsStatus,
        fcpStatus,
        tbtStatus,
        inpStatus,

        opportunities:
          importantOpportunities,

        status,
      };
    };

    // ==============================
    // DESKTOP
    // ==============================

    console.log("\nDesktop:");

    // Kör PageSpeed-test för desktop.
    const desktop =
      await runPageSpeed(
        "desktop"
      );

    if (desktop) {

      console.log(
        `Performance score: ${desktop.score}/100`
      );

      // Visar LCP.
      if (
        typeof desktop.lcp ===
        "number"
      ) {

        console.log(
          `LCP: ${(desktop.lcp / 1000).toFixed(2)} s`
        );
      }

      // Visar CLS.
      if (
        typeof desktop.cls ===
        "number"
      ) {

        console.log(
          `CLS: ${desktop.cls.toFixed(2)}`
        );
      }

      // Visar FCP.
      if (
        typeof desktop.fcp ===
        "number"
      ) {

        console.log(
          `FCP: ${(desktop.fcp / 1000).toFixed(2)} s`
        );
      }

      // Visar TBT.
      if (
        typeof desktop.tbt ===
        "number"
      ) {

        console.log(
          `TBT: ${Math.round(desktop.tbt)} ms`
        );
      }

      // Visar INP om Lighthouse har värdet.
      if (
        typeof desktop.inp ===
        "number"
      ) {

        console.log(
          `INP: ${Math.round(desktop.inp)} ms`
        );
      }

      // Visar status.
      if (
        desktop.status ===
        "PASS"
      ) {

        console.log(
          "✓ Desktop Performance är godkänd"
        );

      } else if (
        desktop.status ===
        "WARNING"
      ) {

        console.log(
          "⚠ Desktop Performance kan förbättras"
        );

      } else {

        console.log(
          "✗ Låg Desktop Performance"
        );
      }

      // Visar de viktigaste förbättringarna.
      if (
        desktop.opportunities.length >
        0
      ) {

        console.log(
          "\nViktigaste Desktop-fynd:"
        );

        for (
          const opportunity of
          desktop.opportunities
        ) {

          console.log(
            `- ${opportunity.title}` +
            (
              opportunity.displayValue
                ? ` (${opportunity.displayValue})`
                : ""
            )
          );
        }
      }
    }

    // ==============================
    // MOBILE
    // ==============================

    console.log("\nMobile:");

    // Kör PageSpeed-test för mobile.
    const mobile =
      await runPageSpeed(
        "mobile"
      );

    if (mobile) {

      console.log(
        `Performance score: ${mobile.score}/100`
      );

      // Visar LCP.
      if (
        typeof mobile.lcp ===
        "number"
      ) {

        console.log(
          `LCP: ${(mobile.lcp / 1000).toFixed(2)} s`
        );
      }

      // Visar CLS.
      if (
        typeof mobile.cls ===
        "number"
      ) {

        console.log(
          `CLS: ${mobile.cls.toFixed(2)}`
        );
      }

      // Visar FCP.
      if (
        typeof mobile.fcp ===
        "number"
      ) {

        console.log(
          `FCP: ${(mobile.fcp / 1000).toFixed(2)} s`
        );
      }

      // Visar TBT.
      if (
        typeof mobile.tbt ===
        "number"
      ) {

        console.log(
          `TBT: ${Math.round(mobile.tbt)} ms`
        );
      }

      // Visar INP om Lighthouse har värdet.
      if (
        typeof mobile.inp ===
        "number"
      ) {

        console.log(
          `INP: ${Math.round(mobile.inp)} ms`
        );
      }

      // Visar status.
      if (
        mobile.status ===
        "PASS"
      ) {

        console.log(
          "✓ Mobile Performance är godkänd"
        );

      } else if (
        mobile.status ===
        "WARNING"
      ) {

        console.log(
          "⚠ Mobile Performance kan förbättras"
        );

      } else {

        console.log(
          "✗ Låg Mobile Performance"
        );
      }

      // Visar de viktigaste förbättringarna.
      if (
        mobile.opportunities.length >
        0
      ) {

        console.log(
          "\nViktigaste Mobile-fynd:"
        );

        for (
          const opportunity of
          mobile.opportunities
        ) {

          console.log(
            `- ${opportunity.title}` +
            (
              opportunity.displayValue
                ? ` (${opportunity.displayValue})`
                : ""
            )
          );
        }
      }
    }

    // Om någon av testerna inte kunde genomföras
    // kan systemet inte ge ett komplett resultat.
    if (
      !desktop ||
      !mobile
    ) {

      return {
        desktop,
        mobile,
        status:
          "WARNING" as const,
      };
    }

    // ==============================
    // TOTAL STATUS
    // ==============================

    let status:
      | "PASS"
      | "WARNING"
      | "FAIL";

    // FAIL om någon enhet har FAIL.
    if (
      desktop.status === "FAIL" ||
      mobile.status === "FAIL"
    ) {

      status = "FAIL";

    // WARNING om någon enhet har WARNING.
    } else if (
      desktop.status === "WARNING" ||
      mobile.status === "WARNING"
    ) {

      status = "WARNING";

    // Annars PASS.
    } else {

      status = "PASS";
    }

    // Returnerar desktop-, mobile- och totalresultatet.
    return {
      desktop,
      mobile,
      status,
    };

  } catch (error) {

    // Hanterar fel om PageSpeed-testet inte kan genomföras.
    console.log(
      "⚠ PageSpeed-kontrollen kunde inte genomföras"
    );

    return {
      desktop: null,
      mobile: null,
      status:
        "WARNING" as const,
    };
  }
}